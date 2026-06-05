const {
  sequelize,
  Product,
  ProductVariation,
  ProductImage,
  Category,
  Brand,
  Tag,
  Question,
  Answer,
  User,
} = require("../../models");
const { Op, Sequelize } = require("sequelize");
const recommendationProxy = require("../recommendationProxy");
const {
  RecommendationUpstreamError,
  RecommendationAdapterError,
  BASE,
} = recommendationProxy;

function throwHttp(status, message, payload) {
  const err = new Error(message);
  err.status = status;
  if (payload) err.payload = payload;
  throw err;
}


const parseIdList = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((x) => Number(x)).filter(Boolean);
  return String(input)
    .split(",")
    .map((x) => Number(x.trim()))
    .filter(Boolean);
};

const parseStringList = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((x) => String(x).trim()).filter(Boolean);
  return String(input)
    .split(",")
    .map((x) => String(x).trim())
    .filter(Boolean);
};


async function getFacets() {
  try {
    const distinctVariationField = async (field) => {
      const rows = await ProductVariation.findAll({
        attributes: [[Sequelize.fn("DISTINCT", Sequelize.col(field)), "value"]],
        where: {
          [Op.and]: [
            Sequelize.where(Sequelize.col(field), { [Op.ne]: null }),
            Sequelize.where(Sequelize.col(field), { [Op.ne]: "" }),
          ],
        },
        raw: true,
      });
      return rows
        .map((r) => r.value)
        .filter(Boolean)
        .map((v) => String(v))
        .sort((a, b) => a.localeCompare(b));
    };

    const [processors, rams, storages, gpus, screens] = await Promise.all([
      distinctVariationField("processor"),
      distinctVariationField("ram"),
      distinctVariationField("storage"),
      distinctVariationField("graphics_card"),
      distinctVariationField("screen_size"),
    ]);

    let weights = [];
    try {
      const [rows] = await sequelize.query(
        `SELECT DISTINCT (specs->>'weight') AS value
         FROM products
         WHERE specs ? 'weight'
           AND (specs->>'weight') IS NOT NULL
           AND (specs->>'weight') <> ''
         LIMIT 200;`
      );
      weights = (rows || [])
        .map((r) => r.value)
        .filter(Boolean)
        .map((v) => String(v))
        .sort((a, b) => a.localeCompare(b));
    } catch (_) {
      weights = [];
    }

    return {
      facets: {
        processor: processors,
        ram: rams,
        storage: storages,
        graphics_card: gpus,
        screen_size: screens,
        weight: weights,
      },
    };
  } catch (error) {
    throw error;
  }
}

async function listProductsV2(query) {
  try {
    const page = Math.max(1, Number.parseInt(query.page ?? 1));
    const limit = Math.max(1, Number.parseInt(query.limit ?? 12));
    const offset = (page - 1) * limit;

    const categoryIds = parseIdList(query.category_id || query["category_id[]"]);
    const brandIds = parseIdList(query.brand_id || query["brand_id[]"]);

    const minPrice = query.min_price != null ? Number(query.min_price) : undefined;
    const maxPrice = query.max_price != null ? Number(query.max_price) : undefined;

    const processors = parseStringList(query.processor || query.cpu);
    const rams = parseStringList(query.ram);
    const storages = parseStringList(query.storage || query.ssd);
    const gpus = parseStringList(query.graphics_card || query.gpu);
    const screens = parseStringList(query.screen_size || query.screenSize);

    const minWeight = query.min_weight != null ? Number(query.min_weight) : undefined;
    const maxWeight = query.max_weight != null ? Number(query.max_weight) : undefined;

    const search = (query.search || "").trim();
    const sortBy = String(query.sort_by ?? query.sortBy ?? "")
      .trim()
      .toLowerCase();

    const where = {};
    if (categoryIds.length === 1) where.category_id = categoryIds[0];
    else if (categoryIds.length > 1) where.category_id = { [Op.in]: categoryIds };

    if (brandIds.length === 1) where.brand_id = brandIds[0];
    else if (brandIds.length > 1) where.brand_id = { [Op.in]: brandIds };

    if (search) where.product_name = { [Op.iLike]: `%${search}%` };

    if (minPrice != null || maxPrice != null) {
      where.base_price = {};
      if (minPrice != null) where.base_price[Op.gte] = minPrice;
      if (maxPrice != null) where.base_price[Op.lte] = maxPrice;
    }

    if (minWeight != null || maxWeight != null) {
      const weightExpr = Sequelize.literal(
        `NULLIF(REGEXP_REPLACE("Product"."specs"->>'weight','[^0-9\\.]','','g'),'')::numeric`
      );
      const ands = where[Op.and] ? [...where[Op.and]] : [];
      if (minWeight != null) ands.push(Sequelize.where(weightExpr, { [Op.gte]: minWeight }));
      if (maxWeight != null) ands.push(Sequelize.where(weightExpr, { [Op.lte]: maxWeight }));
      if (ands.length) where[Op.and] = ands;
    }

    const variationWhere = {};
    if (processors.length) variationWhere.processor = { [Op.in]: processors };
    if (rams.length) variationWhere.ram = { [Op.in]: rams };
    if (storages.length) variationWhere.storage = { [Op.in]: storages };
    if (gpus.length) variationWhere.graphics_card = { [Op.in]: gpus };
    if (screens.length) variationWhere.screen_size = { [Op.in]: screens };

    const soldQtyExpr = Sequelize.literal(
      `(
        SELECT COALESCE(SUM(oi.quantity), 0)
        FROM order_items oi
        JOIN orders o ON o.order_id = oi.order_id
        JOIN product_variations pv ON pv.variation_id = oi.variation_id
        WHERE pv.product_id = "Product"."product_id"
          AND o.status IN ('confirmed','processing','shipping','delivered','PAID')
      )`
    );

    const attributes = sortBy === "best_selling" ? { include: [[soldQtyExpr, "sold_qty"]] } : undefined;
    const orderClause = (() => {
      if (sortBy === "price_asc") return [["base_price", "ASC"]];
      if (sortBy === "price_desc") return [["base_price", "DESC"]];
      if (sortBy === "newest") return [["created_at", "DESC"]];
      if (sortBy === "best_selling") return [[Sequelize.literal('"sold_qty"'), "DESC"], ["created_at", "DESC"]];
      return [["created_at", "DESC"]];
    })();

    const { count, rows } = await Product.findAndCountAll({
      where,
      attributes,
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["category_id", "category_name", "slug"],
        },
        {
          model: Brand,
          as: "brand",
          attributes: ["brand_id", "brand_name", "slug", "logo_url"],
        },
        {
          model: ProductVariation,
          as: "variations",
          attributes: ["variation_id", "price", "stock_quantity", "is_primary", "processor", "ram", "storage", "graphics_card", "screen_size"],
          ...(Object.keys(variationWhere).length
            ? { where: variationWhere, required: true }
            : {}),
        },
        {
          model: ProductImage,
          as: "images",
          where: { is_primary: true },
          required: false,
          attributes: ["image_url"],
        },
      ],
      limit,
      offset,
      order: orderClause,
      distinct: true,
    });

    return {
      products: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
      total: count,
      totalPages: Math.ceil(count / limit),
    };
  } catch (error) {
    throw error;
  }
}

async function listProductsLegacy(query) {
  try {
    // Ép kiểu và giá trị mặc định cho phân trang và sắp xếp
    const page = Math.max(1, Number.parseInt(query.page ?? 1));
    const limit = Math.max(1, Number.parseInt(query.limit ?? 12)); 
    const offset = (page - 1) * limit;

    // Whitelist sort/order để chống SQL Injection
    const allowedSort = new Set([
      "created_at",
      "base_price",
      "rating_average",
      "view_count",
      "product_name",
    ]);
    const allowedOrder = new Set(["ASC", "DESC"]);
    const sort = allowedSort.has(query.sort)
      ? query.sort
      : "created_at";
    const order = allowedOrder.has((query.order ?? "").toUpperCase())
      ? query.order.toUpperCase()
      : "DESC";

    // Lấy các tham số lọc
    const categoryIds = parseIdList(
      query.category_id || query["category_id[]"]
    );
    const brandIds = parseIdList(query.brand_id || query["brand_id[]"]);

    const minPrice =
      query.min_price != null ? Number(query.min_price) : undefined;
    const maxPrice =
      query.max_price != null ? Number(query.max_price) : undefined;

    // ĐỌC THAM SỐ TÌM KIẾM TỪ HEADER (search query)
    const search = (query.search || "").trim();

    const where = { is_active: true };

    // Lọc theo Danh mục
    if (categoryIds.length === 1) where.category_id = categoryIds[0];
    else if (categoryIds.length > 1)
      where.category_id = { [Op.in]: categoryIds };

    // Lọc theo Thương hiệu
    if (brandIds.length === 1) where.brand_id = brandIds[0];
    else if (brandIds.length > 1) where.brand_id = { [Op.in]: brandIds };

    // LỌC THEO TỪ KHÓA TÌM KIẾM
    if (search) {
      // Sử dụng Op.iLike (case-insensitive LIKE cho PostgreSQL) để tìm kiếm
      where.product_name = { [Op.iLike]: `%${search}%` };
    }

    // Lọc theo khoảng giá
    if (minPrice != null || maxPrice != null) {
      where.base_price = {};
      if (minPrice != null) where.base_price[Op.gte] = minPrice;
      if (maxPrice != null) where.base_price[Op.lte] = maxPrice;
    }

    const { count, rows } = await Product.findAndCountAll({
      where, // Áp dụng tất cả các điều kiện lọc (bao gồm tìm kiếm)
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["category_id", "category_name", "slug"],
        },
        {
          model: Brand,
          as: "brand",
          attributes: ["brand_id", "brand_name", "slug", "logo_url"],
        },
        {
          model: ProductVariation,
          as: "variations",
          attributes: ["variation_id", "price", "stock_quantity"],
        },
        {
          model: ProductImage,
          as: "images",
          where: { is_primary: true },
          required: false,
          attributes: ["image_url"],
        },
      ],
      limit,
      offset,
      order: [[sort, order]],
      distinct: true,
    });

    return {
      products: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
      total: count,
      totalPages: Math.ceil(count / limit),
    };
  } catch (error) {
    throw error;
  }
}

async function getProductDetail(idOrSlug) {
  try {
    const id = idOrSlug;
    const whereKey = isNaN(Number(id)) ? { slug: id } : { product_id: id };

    const product = await Product.findOne({
      where: { ...whereKey },
      attributes: { include: ["specs", "is_active"] },

      include: [
        { model: Category, as: "category" },
        { model: Brand, as: "brand" },

        // ✔ variations: chọn các cột cần thiết + sắp xếp hợp lý
        {
          model: ProductVariation,
          as: "variations",
          required: false,
          // Nếu muốn chỉ trả về cấu hình còn bán, bật dòng dưới:
          // where: { is_available: true },
          attributes: [
            "variation_id",
            "price",
            "stock_quantity",
            "is_available",
            "is_primary",
            "processor",
            "ram",
            "storage",
            "graphics_card",
            "screen_size",
            "color",
          ],
        },

        // Ảnh: lấy theo thứ tự display_order
        {
          model: ProductImage,
          as: "images",
        },

        { model: Tag, through: { attributes: [] } },
        // trong include: [...]
        {
          model: Question,
          as: "questions",
          attributes: [
            "question_id",
            "question_text",
            "is_answered",
            "created_at",
            "parent_question_id",
          ],
          where: { parent_question_id: null }, 
          required: false,
          include: [
            {
              model: User,
              as: "user",
              attributes: ["user_id", "username", "full_name"],
            },
            {
              model: Answer,
              as: "answers",
              attributes: ["answer_id", "answer_text", "created_at"],
              include: [
                {
                  model: User,
                  as: "user",
                  attributes: ["user_id", "username", "full_name"],
                },
              ],
            },
            {
              model: Question, 
              as: "children",
              attributes: [
                "question_id",
                "question_text",
                "is_answered",
                "created_at",
                "parent_question_id",
              ],
              include: [
                {
                  model: User,
                  as: "user",
                  attributes: ["user_id", "username", "full_name"],
                },
                {
                  model: Answer,
                  as: "answers",
                  attributes: ["answer_id", "answer_text", "created_at"],
                  include: [
                    {
                      model: User,
                      as: "user",
                      attributes: ["user_id", "username", "full_name"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],

      // ✔ sắp xếp: ảnh theo display_order, hỏi đáp theo thời gian,
      //   variations mình sẽ sort ở FE theo is_primary/stock/price nếu muốn
      order: [
        [{ model: ProductImage, as: "images" }, "display_order", "ASC"],
        [{ model: Question, as: "questions" }, "created_at", "DESC"], // gốc mới trước
        // câu trả lời của gốc
        [
          { model: Question, as: "questions" },
          { model: Answer, as: "answers" },
          "created_at",
          "ASC",
        ],
        // follow-up: cũ trước (thường chỉ 1)
        [
          { model: Question, as: "questions" },
          { model: Question, as: "children" },
          "created_at",
          "ASC",
        ],
        // trả lời của follow-up
        [
          { model: Question, as: "questions" },
          { model: Question, as: "children" },
          { model: Answer, as: "answers" },
          "created_at",
          "ASC",
        ],
      ],
    });

    if (!product) throwHttp(404, "Product not found");

    // Tăng view count (best-effort)
    product.increment("view_count").catch(() => {});

    // Chuẩn hóa JSON trả ra
    const json = product.toJSON();
    if (json.specs == null) json.specs = {};

    // ✔ Phòng trường hợp subquery không tìm được primaryVariationId
    if (!json.primaryVariationId && Array.isArray(json.variations) && json.variations.length) {
      const sorted = [...json.variations].sort((a, b) => {
        // is_primary DESC, stock DESC, price ASC
        if (+b.is_primary !== +a.is_primary) return (+b.is_primary) - (+a.is_primary);
        if ((b.stock_quantity ?? 0) !== (a.stock_quantity ?? 0)) return (b.stock_quantity ?? 0) - (a.stock_quantity ?? 0);
        return (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER);
      });
      json.primaryVariationId = sorted[0]?.variation_id;
    }

    return { body: { product: json } };
  } catch (error) {
    throw error;
  }
}

async function getSearchSuggestions(q) {
  try {
    const search = (q || "").trim();
    if (search.length < 2) {
      return { products: [] };
    }

    const products = await Product.findAll({
      where: {
        is_active: true,
        product_name: { [Op.iLike]: `%${search}%` },
      },
      attributes: [
        "product_id",
        "product_name",
        "slug",
        "thumbnail_url",
        "base_price",
        "discount_percentage",
      ],
      include: [
        {
          model: ProductVariation,
          as: "variations",
          attributes: ["price"],
          limit: 1, // Lấy variation đầu tiên để tính giá
        },
        {
          model: ProductImage,
          as: "images",
          where: { is_primary: true },
          required: false,
          attributes: ["image_url"],
        },
      ],
      limit: 5, // Chỉ giới hạn 5 kết quả gợi ý
    });

    return { products };
  } catch (error) {
    throw error;
  }
}

async function fetchProductMeta(productIds = []) {
  if (!productIds.length) return {};

  const rows = await Product.findAll({
    where: { product_id: { [Op.in]: productIds } },
    attributes: [
      "product_id",
      // đổi "product_name" thành "name" nếu model của bạn map field -> name
      "product_name",
      "slug",
      "rating_average",
      "thumbnail_url",
    ],
    include: [
      {
        model: ProductImage,
        as: "images",
        required: false,
        attributes: ["image_url", "is_primary", "display_order"],
      },
    ],
    order: [
      [{ model: ProductImage, as: "images" }, "is_primary", "DESC"],
      [{ model: ProductImage, as: "images" }, "display_order", "ASC"],
    ],
  });

  const map = {};
  for (const r of rows) {
    const j = r.toJSON();
    const img = j.images?.[0];
    map[j.product_id] = {
      product_name: j.product_name,              // hoặc j.name nếu model đặt alias
      slug: j.slug,
      thumbnail_url: j.thumbnail_url || null,    // ← ưu tiên thumbnail_url từ products
      image: j.thumbnail_url || img?.image_url || null, // fallback sang ảnh primary
      rating_average: j.rating_average || null,
    };
  }
  return map;
}

async function getRecommendationsByVariation(variationId) {
  const vid = Number(variationId);
  if (!vid) return { statusCode: 400, body: { products: [], error: "invalid variation_id" } };

  try {
    const payload = await recommendationProxy.getRecommendations(vid);

    // ---- HỖ TRỢ NHIỀU KIỂU SHAPE ----
    // 1) Chuẩn: { items: [...] }
    // 2) Debug mode bạn đang có: { debug: [...] }
    // 3) Hiếm gặp: payload là một mảng luôn
    let raw = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.debug)
      ? payload.debug
      : Array.isArray(payload)
      ? payload
      : [];

    // (tuỳ chọn) Gộp trùng theo product_id → giữ biến thể có score cao nhất
    // score mặc định lấy performance_score nếu có, rơi về 0
    const bestByProduct = new Map();
    for (const it of raw) {
      const pid = it.product_id ?? it.id;
      const score =
        it.score ??
        it.performance_score ??
        it.rank_score ??
        0;

      const prev = bestByProduct.get(pid);
      if (!prev || score > prev._score) {
        bestByProduct.set(pid, { ...it, _score: score });
      }
    }
    raw = Array.from(bestByProduct.values());

    // Lấy meta từ DB cho các product_id (ảnh, slug, name)
    const productIds = raw.map((x) => x.product_id).filter(Boolean);
    const metaMap = await fetchProductMeta(productIds);

    // Map về shape FE cần
    const products = raw.map((it) => {
      const meta = metaMap[it.product_id] || {};
      return {
        id: it.product_id,                    // FE card link theo product
        variation_id: it.variation_id,        // để deep-link ?v= nếu muốn
        name: meta.product_name || it.product_name,   // ưu tiên DB -> rơi về từ Flask
        image: meta.thumbnail_url,                    // ưu tiên ảnh DB (ổn định)
        slug: meta.slug,
        price: it.price,
        score: it.score ?? it.performance_score ?? null,
        rating_average: meta.rating_average,
        // (tuỳ) thêm nguồn giải thích:
        explain: {
          source: it.source,                  // "fresh" / "indexed"
          score_source: it.score_source,      // "fresh:benchmark", ...
          cpu_source: it.cpu_source,
          gpu_source: it.gpu_source,
        },
      };
    });

    // Sắp xếp theo score giảm dần (nếu có)
    products.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    return {
      statusCode: 200,
      body: {
        products,
        basedOn: { variationId: vid },
        generated_at: payload.generated_at || new Date().toISOString(),
        source: "knn",
      },
    };
  } catch (e) {
    console.error("getRecommendedByVariation EX:", e);

    if (e instanceof RecommendationUpstreamError) {
      return {
        statusCode: 502,
        body: {
          products: [],
          basedOn: { variationId: vid },
          source: "knn",
          error: `upstream_${e.upstreamStatus}`,
          upstream: e.upstream,
        },
      };
    }

    if (e instanceof RecommendationAdapterError) {
      return {
        statusCode: 502,
        body: {
          products: [],
          basedOn: { variationId: vid },
          source: "knn",
          error: "adapter_exception",
          detail: { message: e.message, code: e.code, base: e.base ?? BASE },
        },
      };
    }

    return {
      statusCode: 502,
      body: {
        products: [],
        basedOn: { variationId: vid },
        source: "knn",
        error: "adapter_exception",
        detail: { message: e.message, code: e.code, base: BASE },
      },
    };
  }
}

async function listCategories() {
  try {
    const categories = await Category.findAll({
      order: [["display_order", "ASC"]],
    });

    return { categories };
  } catch (error) {
    throw error;
  }
}

async function listBrands() {
  try {
    const brands = await Brand.findAll({
      order: [["brand_name", "ASC"]],
    });

    return { brands };
  } catch (error) {
    throw error;
  }
}

async function compareProducts(ids) {
  try {
    if (!ids || !ids.length) {
      throwHttp(400, "ids is required (array or comma-separated)");
    }

    const products = await Product.findAll({
      where: { product_id: { [Op.in]: ids } },
      attributes: [
        "product_id",
        "product_name",
        "thumbnail_url",
        "base_price",
        "discount_percentage",
        "specs",
      ],
      include: [],
    });

    // Chuẩn hoá: hợp nhất danh sách group và label → tạo khung ma trận
    const allGroups = new Set();
    const labelsByGroup = {}; // { group: Set<label> }

    for (const p of products) {
      const specs = p.specs || {};
      Object.keys(specs).forEach((group) => {
        allGroups.add(group);
        if (!labelsByGroup[group]) labelsByGroup[group] = new Set();
        specs[group].forEach((row) => labelsByGroup[group].add(row.label));
      });
    }

    // Biến Set -> Array & sắp xếp nhẹ cho ổn định
    const groups = [...allGroups];
    const normalized = groups.map((group) => {
      const labels = [...(labelsByGroup[group] || [])];
      return {
        group,
        rows: labels.map((label) => ({
          label,
          values: products.map((p) => {
            const list = p.specs?.[group] || [];
            const found = list.find((r) => r.label === label);
            return found?.value || "—";
          }),
        })),
      };
    });

    return {
      products: products.map((p) => ({
        id: p.product_id,
        name: p.product_name,
        thumbnail_url: p.thumbnail_url,
        base_price: p.base_price,
        discount_percentage: p.discount_percentage,
      })),
      compare: normalized,
    };
  } catch (err) {
    throw err;
  }
}

module.exports = {
  getFacets,
  listProductsLegacy,
  listProductsV2,
  getProductDetail,
  getSearchSuggestions,
  getRecommendationsByVariation,
  listCategories,
  listBrands,
  compareProducts,
  parseIdList,
  parseStringList,
};

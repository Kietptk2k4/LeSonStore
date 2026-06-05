const { Op } = require("sequelize");
const { Product, ProductImage } = require("../../models");
const recommendationProxy = require("../recommendationProxy");
const {
  RecommendationUpstreamError,
  RecommendationAdapterError,
  BASE,
} = recommendationProxy;

function parseUpstreamPayload(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.debug)) return payload.debug;
  if (Array.isArray(payload)) return payload;
  return [];
}

function dedupeByProductId(raw) {
  const bestByProduct = new Map();
  for (const it of raw) {
    const pid = it.product_id ?? it.id;
    const score =
      it.score ?? it.performance_score ?? it.rank_score ?? 0;

    const prev = bestByProduct.get(pid);
    if (!prev || score > prev._score) {
      bestByProduct.set(pid, { ...it, _score: score });
    }
  }
  return Array.from(bestByProduct.values());
}

async function fetchProductMeta(productIds = []) {
  if (!productIds.length) return {};

  const rows = await Product.findAll({
    where: { product_id: { [Op.in]: productIds } },
    attributes: [
      "product_id",
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
      product_name: j.product_name,
      slug: j.slug,
      thumbnail_url: j.thumbnail_url || null,
      image: j.thumbnail_url || img?.image_url || null,
      rating_average: j.rating_average || null,
    };
  }
  return map;
}

function mapToFrontendProducts(raw, metaMap) {
  return raw.map((it) => {
    const meta = metaMap[it.product_id] || {};
    return {
      id: it.product_id,
      variation_id: it.variation_id,
      name: meta.product_name || it.product_name,
      image: meta.thumbnail_url,
      slug: meta.slug,
      price: it.price,
      score: it.score ?? it.performance_score ?? null,
      rating_average: meta.rating_average,
      explain: {
        source: it.source,
        score_source: it.score_source,
        cpu_source: it.cpu_source,
        gpu_source: it.gpu_source,
      },
    };
  });
}

function sortByScore(products) {
  products.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return products;
}

async function getByVariation(variationId) {
  const vid = Number(variationId);
  if (!vid) {
    return {
      statusCode: 400,
      body: { products: [], error: "invalid variation_id" },
    };
  }

  try {
    const payload = await recommendationProxy.getRecommendations(vid);

    let raw = parseUpstreamPayload(payload);
    raw = dedupeByProductId(raw);

    const productIds = raw.map((x) => x.product_id).filter(Boolean);
    const metaMap = await fetchProductMeta(productIds);
    const products = sortByScore(mapToFrontendProducts(raw, metaMap));

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

module.exports = {
  getByVariation,
  parseUpstreamPayload,
  dedupeByProductId,
  fetchProductMeta,
  mapToFrontendProducts,
};

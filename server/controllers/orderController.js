const {
  Order,
  OrderItem,
  Cart,
  CartItem,
  ProductVariation,
  Payment,
  Product,
  User,
} = require("../models");
const sequelize = require("../config/database");
const { Op } = require("sequelize");
const { quoteShipping } = require("../services/shippingService");
const orderFacade = require("../services/order/orderFacade");
const vnpayStrategy = require("../services/payment/vnpayStrategy");
const { emitOrderEvent } = require("../events/orderEventBus");
const { getIO } = require("../config/socket")
const toVnd = (x) => Math.max(0, Math.round(Number(x) || 0));

function handleFacadeError(error, res, next) {
  if (error.status) {
    const payload = { message: error.message };
    if (error.detail !== undefined) payload.detail = error.detail;
    return res.status(error.status).json(payload);
  }
  return next(error);
}

// Create order from cart
exports.createOrder = async (req, res, next) => {
  if (!req.user || !req.user.user_id) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const result = await orderFacade.createFromCart({
      userId: req.user.user_id,
      user: req.user,
      body: req.body,
      req,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return handleFacadeError(error, res, next);
  }
};

exports.getUserOrdersV2 = async (req, res, next) => {
  try {
    const {
      tab = "all",
      page = 1,
      limit = 10,
      q = "",
      sort = "created_at:desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * perPage;

    const [, sortDirRaw] = String(sort).split(":");
    const sortDir =
      (sortDirRaw || "desc").toUpperCase() === "ASC" ? "ASC" : "DESC";
    const orderBy = [["created_at", sortDir]];

    const where = { user_id: req.userId };

    let paymentInclude = {
      model: Payment,
      as: "payment",
      required: false,
    };

    switch (tab) {
      case "awaiting_payment":
        where.status = "AWAITING_PAYMENT";
        paymentInclude = {
          model: Payment,
          as: "payment",
          required: true,
          where: { provider: "VNPAY", payment_status: "pending" },
        };
        break;

      case "to_ship":
        where.status = "processing";
        paymentInclude = {
          model: Payment,
          as: "payment",
          required: true,
          where: {
            [Op.or]: [
              { provider: "COD", payment_status: "pending" },
              { provider: "VNPAY", payment_status: "completed" },
            ],
          },
        };
        break;

      case "shipping":
        where.status = "shipping";
        paymentInclude = {
          model: Payment,
          as: "payment",
          required: true,
          where: {
            [Op.or]: [
              { provider: "COD", payment_status: "pending" },
              { provider: "VNPAY", payment_status: "completed" },
            ],
          },
        };
        break;

      case "completed":
        where.status = "delivered";
        paymentInclude = {
          model: Payment,
          as: "payment",
          required: true,
          where: { payment_status: "completed" },
        };
        break;

      case "cancelled":
        where.status = { [Op.in]: ["cancelled", "FAILED"] };
        break;

      case "failed":
        where.status = "FAILED";
        break;

      case "all":
      default:
        break;
    }

    const query = String(q || "").trim();
    if (query) {
      where[Op.or] = [
        { order_code: { [Op.iLike]: `%${query}%` } },
        { "$items.variation.product.product_name$": { [Op.iLike]: `%${query}%` } },
      ];
    }

    const { count, rows } = await Order.findAndCountAll({
      where,
      include: [
        {
          model: OrderItem,
          as: "items",
          required: true,
          include: [
            {
              model: ProductVariation,
              as: "variation",
              include: [{ model: Product, as: "product" }],
            },
          ],
        },
        paymentInclude,
      ],
      limit: perPage,
      offset,
      order: orderBy,
      distinct: true,
      subQuery: false,
    });

    const orders = rows.map((o) => {
      const j = o.toJSON();
      const preview = (j.items || []).slice(0, 2).map((it) => ({
        variation_id: it.variation_id,
        quantity: it.quantity,
        product_name: it.variation?.product?.product_name || null,
        thumbnail_url:
          it.variation?.product?.images?.[0]?.image_url ||
          it.variation?.product?.thumbnail_url ||
          null,
      }));

      return {
        order_id: j.order_id,
        order_code: j.order_code,
        status: j.status,
        final_amount: Number(j.final_amount || 0),
        shipping_fee: Number(j.shipping_fee || 0),
        created_at: j.created_at,
        reserve_expires_at: j.reserve_expires_at,
        payment: j.payment
          ? {
              provider: j.payment.provider,
              payment_method: j.payment.payment_method,
              payment_status: j.payment.payment_status,
              txn_ref: j.payment.txn_ref,
            }
          : null,
        items_preview: preview,
        items_count: (j.items || []).length,
      };
    });

    return res.json({
      orders,
      pagination: {
        total: count,
        page: pageNum,
        limit: perPage,
        totalPages: Math.ceil(count / perPage),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get user orders
// controllers/orderController.js
exports.getUserOrders = async (req, res, next) => {
  try {
    const {
      tab = "all",
      page = 1,
      limit = 10,
      q = "",
      sort = "created_at:desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * perPage;

    // sort: "created_at:desc" | "created_at:asc"
    const [sortField, sortDirRaw] = String(sort).split(":");
    const sortDir =
      (sortDirRaw || "desc").toUpperCase() === "ASC" ? "ASC" : "DESC";
    const orderBy = [["created_at", sortDir]]; // chỉ cho phép created_at để tránh SQLi

    // base filter (đơn của user hiện tại)
    const where = { user_id: req.userId };

    // lọc theo tab: ánh xạ đúng logic bạn yêu cầu
    // - AWAITING_PAYMENT: VNPAY -> order.AWAITING_PAYMENT + payment.pending
    // - TO_SHIP: order.processing (COD: payment.pending | VNPAY: payment.completed)
    // - SHIPPING: order.shipping (COD pending | VNPAY completed)
    // - COMPLETED: order.delivered + payment.completed
    // - CANCELLED: COD order.cancelled + payment.failed  | VNPAY order.FAILED + payment.failed
    // - FAILED: (để tách riêng trường hợp thất bại có thể thanh toán lại)
    const paymentWhere = {}; // sẽ tinh chỉnh sau khi switch tab

    switch (tab) {
      case "awaiting_payment":
        where.status = "AWAITING_PAYMENT";
        paymentWhere.provider = "VNPAY";
        paymentWhere.payment_status = "pending";
        break;

      case "to_ship":
        where.status = "processing";
        // (COD + pending) OR (VNPAY + completed) — ta không thể OR ngay trong include duy nhất,
        // nên để include rộng rồi lọc sau bằng JS (hoặc dùng subQuery phức tạp).
        // Ở đây: chỉ include tất cả, sau map sẽ filter theo điều kiện nhìn/hiển thị ở FE.
        break;

      case "shipping":
        where.status = "shipping";
        break;

      case "completed":
        where.status = "delivered";
        paymentWhere.payment_status = "completed";
        break;

      case "cancelled":
        // Gom cả "cancelled" và "FAILED"
        where.status = { [Op.in]: ["cancelled", "FAILED"] };
        break;

      case "failed":
        // Tab tách riêng để “thanh toán lại”: ví dụ order.FAILED (hoặc pending + failed ipn tuỳ bạn),
        // ở đây dùng order.FAILED cho rõ ràng:
        where.status = "FAILED";
        break;

      case "all":
      default:
        // không thêm gì
        break;
    }

    // Tìm kiếm theo q (order_code hoặc tên sản phẩm)
    // Cách đơn giản: q trên order_code ở SQL; phần tìm theo tên sp filter ở FE (hoặc viết subquery).
    if (q) {
      where.order_code = { [Op.iLike]: `%${q}%` }; // dùng iLike trên Postgres
    }

    const { count, rows } = await Order.findAndCountAll({
      where,
      include: [
        // items -> variation -> product (để preview)
        {
          model: OrderItem,
          as: "items",
          include: [
            {
              model: ProductVariation,
              as: "variation",
              include: [{ model: Product, as: "product" }],
            },
          ],
        },
        // payment
        {
          model: Payment,
          as: "payment",
          // nếu paymentWhere rỗng thì đừng ép where (để không loại mất case OR như "to_ship")
          ...(Object.keys(paymentWhere).length ? { where: paymentWhere } : {}),
          required: false,
        },
      ],
      limit: perPage,
      offset,
      order: orderBy,
      distinct: true, // để count đúng khi có join
    });

    // Chuẩn hoá response: items_preview (tối đa 2), items_count
    const orders = rows.map((o) => {
      const j = o.toJSON();
      const preview = (j.items || []).slice(0, 2).map((it) => ({
        variation_id: it.variation_id,
        quantity: it.quantity,
        product_name: it.variation?.product?.product_name || null,
        thumbnail_url:
          it.variation?.product?.images?.[0]?.image_url ||
          it.variation?.product?.thumbnail_url ||
          null,
      }));

      return {
        order_id: j.order_id,
        order_code: j.order_code,
        status: j.status,
        final_amount: Number(j.final_amount || 0),
        shipping_fee: Number(j.shipping_fee || 0),
        created_at: j.created_at,
        reserve_expires_at: j.reserve_expires_at,
        payment: j.payment
          ? {
              provider: j.payment.provider,
              payment_method: j.payment.payment_method,
              payment_status: j.payment.payment_status,
              txn_ref: j.payment.txn_ref,
            }
          : null,
        items_preview: preview,
        items_count: (j.items || []).length,
      };
    });

    return res.json({
      orders,
      pagination: {
        total: count,
        page: pageNum,
        limit: perPage,
        totalPages: Math.ceil(count / perPage),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get order detail
exports.getOrderDetail = async (req, res, next) => {
  try {
    const { order_id } = req.params;

    const order = await Order.findOne({
      where: {
        order_id,
        user_id: req.user.user_id,
      },
      include: [
        {
          model: OrderItem,
          as: "items",
          include: [
            {
              model: ProductVariation,
              as: "variation",
              include: [{ model: Product, as: "product" }], // ✅ alias đúng
            },
          ],
        },
        {
          model: Payment,
          as: "payment",
        },
      ],
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ order });
  } catch (error) {
    next(error);
  }
};

// Cancel order
exports.cancelOrder = async (req, res, next) => {
  try {
    const result = await orderFacade.cancelOrder({
      userId: req.user.user_id,
      orderId: req.params.order_id,
      reason: req.body?.reason,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return handleFacadeError(error, res, next);
  }
};


// controllers/orderController.js (thêm vào file bạn đang có)
exports.previewOrder = async (req, res, next) => {
  try {
    const { items = [], province_id, ward_id } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "No items" });
    }
    if (!province_id) {
      return res.status(400).json({ message: "Missing province_id" });
    }

    const rows = [];
    for (const it of items) {
      const v = await ProductVariation.findByPk(it.variation_id, {
        include: [{ model: Product, as: "product" }], // ✅ alias đúng
      });
      if (!v)
        return res
          .status(400)
          .json({ message: `Variation ${it.variation_id} not found` });
      rows.push({ v, qty: Math.max(1, Number(it.quantity || 1)) });
    }

    let total_amount = 0; // tổng gốc
    let discount_amount = 0; // tổng giảm (tiền)
    const stock_warnings = [];

    const items_breakdown = rows.map(({ v, qty }) => {
      const available = Number(v.stock_quantity || 0);
      if (!v.is_available || available < qty) {
        stock_warnings.push({
          variation_id: v.variation_id,
          message: `Only ${available} left in stock`,
        });
      }

      const unit_price = Number(v.price);
      const unit_discount_amount = Math.max(
        0,
        Math.round(
          Number((unit_price * v.product?.discount_percentage) / 100 || 0)
        )
      );
      const unit_final_price = Math.max(
        0,
        Math.round(unit_price - unit_discount_amount)
      );

      const item_total = Math.round(unit_price * qty);
      const item_discount = Math.round(unit_discount_amount * qty);
      const item_subtotal_after_discount = Math.max(
        0,
        Math.round(unit_final_price * qty)
      );

      total_amount += item_total;
      discount_amount += item_discount;

      return {
        variation_id: v.variation_id,
        product_name: v.product?.product_name || null,
        quantity: qty,

        unit_price: Math.round(unit_price),
        unit_discount_amount, // tiền giảm / unit
        unit_final_price, // giá sau giảm / unit

        item_total, // gốc * qty
        item_discount, // giảm * qty
        item_subtotal_after_discount, // sau giảm * qty

        thumbnail_url: v.product?.thumbnail_url || null,
        slug: v.product?.slug || null,
      };
    });

    const subtotal_after_discount = Math.max(
      0,
      Math.round(total_amount - discount_amount)
    );

    const { shipping_fee, reason } = await quoteShipping({
      province_id: Number(province_id),
      ward_id: ward_id ? Number(ward_id) : null,
      subtotal: subtotal_after_discount,
    });

    const final_amount = subtotal_after_discount + Number(shipping_fee || 0);

    return res.json({
      total_amount,
      discount_amount,
      subtotal_after_discount,
      shipping_fee,
      shipping_reason: reason || null,
      final_amount,
      items_breakdown,
      stock_warnings,
    });
  } catch (error) {
    next(error);
  }
};

exports.getOrderDetailSlim = async (req, res, next) => {
  try {
    const { order_id } = req.params;

    const orderRow = await Order.findOne({
      where: { order_id, user_id: req.user.user_id },
      include: [
        {
          model: OrderItem,
          as: "items",
          include: [
            {
              model: ProductVariation,
              as: "variation",
              include: [{ model: Product, as: "product" }],
            },
          ],
        },
        { model: Payment, as: "payment" },
      ],
      order: [[{ model: OrderItem, as: "items" }, "order_item_id", "ASC"]],
    });

    if (!orderRow) return res.status(404).json({ message: "Order not found" });

    const o = orderRow.toJSON();

    // Chuẩn hóa items
    const items = (o.items || []).map((it) => {
      const p = it.variation?.product || {};
      // thumbnail ưu tiên ảnh primary nếu bạn có; ở đây lấy thumbnail_url đã có
      const thumb = p.images?.[0]?.image_url || p.thumbnail_url || null;

      return {
        order_item_id: it.order_item_id,
        variation_id: it.variation_id,
        quantity: Number(it.quantity || 0),
        price: Number(it.price || 0),
        discount_amount: Number(it.discount_amount || 0),
        subtotal: Number(it.subtotal || 0),
        product: {
          product_id: p.product_id || null,
          product_name: p.product_name || null,
          thumbnail_url: thumb,
          slug: p.slug || null,
        },
      };
    });

    // Chuẩn hóa payment
    const pay = o.payment
      ? {
          provider: o.payment.provider,
          payment_method: o.payment.payment_method,
          payment_status: o.payment.payment_status,
          amount: Number(o.payment.amount || 0),
          txn_ref: o.payment.txn_ref,
          paid_at: o.payment.paid_at,
        }
      : null;

    const payload = {
      order: {
        order_id: o.order_id,
        order_code: o.order_code,
        status: o.status,
        total_amount: Number(o.total_amount || 0),
        discount_amount: Number(o.discount_amount || 0),
        final_amount: Number(o.final_amount || 0),
        shipping_fee: Number(o.shipping_fee || 0),
        shipping_name: o.shipping_name,
        shipping_phone: o.shipping_phone,
        shipping_address: o.shipping_address,
        province_id: o.province_id,
        ward_id: o.ward_id,
        geo_lat: o.geo_lat ? Number(o.geo_lat) : null,
        geo_lng: o.geo_lng ? Number(o.geo_lng) : null,
        created_at: o.created_at,
        payment: pay,
        items,
      },
    };

    return res.json(payload);
  } catch (err) {
    next(err);
  }
};

exports.retryVnpayPayment = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { order_id } = req.params;
    const { method = "VNPAYQR" } = req.body || {}; // VNPAYQR | VNBANK | INTCARD

    // 1) Lấy order & payment
    const order = await Order.findOne({
      where: { order_id, user_id: req.user.user_id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!order) {
      await t.rollback();
      return res.status(404).json({ message: "Order not found" });
    }

    const payment = await Payment.findOne({
      where: { order_id: order.order_id, provider: "VNPAY" },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!payment) {
      await t.rollback();
      return res
        .status(400)
        .json({ message: "Payment record not found or not VNPAY" });
    }

    // 2) Điều kiện cho phép retry
    const allow =
      payment.payment_status === "pending" &&
      (order.status === "AWAITING_PAYMENT" || order.status === "FAILED");

    if (!allow) {
      await t.rollback();
      return res
        .status(400)
        .json({ message: "Order not eligible for retry payment" });
    }

    // 3) Tạo txn_ref mới (khuyến nghị tạo mới)
    const newTxnRef = vnpayStrategy.buildTxnRef(order.order_id);
    await payment.update({ txn_ref: newTxnRef }, { transaction: t });

    // 4) Build URL thanh toán
    const redirect = await vnpayStrategy.buildRetryPaymentUrl({
      order,
      payment,
      method,
      req,
    });

    // (tuỳ chọn) set thời hạn link để FE hiển thị
    const expires_at = new Date(Date.now() + 15 * 60 * 1000); // 15 phút

    await t.commit();
    return res.json({
      redirect,
      order_id: order.order_id,
      txn_ref: newTxnRef,
      expires_at: expires_at.toISOString(),
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

exports.getOrderCounters = async (req, res, next) => {
  try {
    const rows = await Order.findAll({
      where: { user_id: req.user.user_id },
      include: [{ model: Payment, as: "payment", required: false }],
      attributes: ["order_id", "status"], // tối giản select
    });

    const counters = {
      all: 0,
      awaiting_payment: 0,
      processing: 0, // BE native
      to_ship: 0, // thêm để FE map trực tiếp tab "to_ship"
      shipping: 0,
      delivered: 0,
      cancelled: 0,
      failed: 0,
    };

    for (const o of rows) {
      counters.all += 1;
      const p = o.payment;

      if (
        o.status === "AWAITING_PAYMENT" &&
        p?.provider === "VNPAY" &&
        p?.payment_status === "pending"
      ) {
        counters.awaiting_payment += 1;
      }

      if (o.status === "processing") {
        counters.processing += 1;
        counters.to_ship += 1; // alias cho FE tab "to_ship"
      }

      if (o.status === "shipping") counters.shipping += 1;

      if (o.status === "delivered" && p?.payment_status === "completed") {
        counters.delivered += 1;
      }

      if (o.status === "cancelled" || o.status === "FAILED") {
        counters.cancelled += 1;
      }

      if (o.status === "FAILED") counters.failed += 1;
    }

    return res.json(counters);
  } catch (err) {
    next(err);
  }
};

exports.getOrderCountersV2 = async (req, res, next) => {
  try {
    const rows = await Order.findAll({
      where: { user_id: req.user.user_id },
      include: [{ model: Payment, as: "payment", required: false }],
      attributes: ["order_id", "status"],
    });

    const counters = {
      all: 0,
      awaiting_payment: 0,
      processing: 0,
      to_ship: 0,
      shipping: 0,
      delivered: 0,
      cancelled: 0,
      failed: 0,
    };

    for (const o of rows) {
      counters.all += 1;
      const p = o.payment;
      const prov = p?.provider;
      const pstatus = p?.payment_status;

      if (
        o.status === "AWAITING_PAYMENT" &&
        prov === "VNPAY" &&
        pstatus === "pending"
      ) {
        counters.awaiting_payment += 1;
      }

      if (o.status === "processing") {
        counters.processing += 1;
        if (
          (prov === "COD" && pstatus === "pending") ||
          (prov === "VNPAY" && pstatus === "completed")
        ) {
          counters.to_ship += 1;
        }
      }

      if (
        o.status === "shipping" &&
        ((prov === "COD" && pstatus === "pending") ||
          (prov === "VNPAY" && pstatus === "completed"))
      ) {
        counters.shipping += 1;
      }

      if (o.status === "delivered" && pstatus === "completed") {
        counters.delivered += 1;
      }

      if (o.status === "cancelled" || o.status === "FAILED") {
        counters.cancelled += 1;
      }

      if (o.status === "FAILED") counters.failed += 1;
    }

    return res.json(counters);
  } catch (err) {
    next(err);
  }
};

exports.changePaymentMethod = async (req, res, next) => {
  try {
    const { provider, method } = req.body || {};
    const result = await orderFacade.changePaymentMethod({
      userId: req.user.user_id,
      orderId: req.params.order_id,
      provider,
      method,
      req,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return handleFacadeError(error, res, next);
  }
};

exports.updateShippingAddress = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { order_id } = req.params;
    const {
      shipping_name,
      shipping_phone,
      shipping_address,
      province_id,
      ward_id,
      geo_lat,
      geo_lng,
    } = req.body || {};

    const order = await Order.findOne({
      where: { order_id, user_id: req.user.user_id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!order) {
      await t.rollback();
      return res.status(404).json({ message: "Order not found" });
    }

    if (["shipping", "delivered", "cancelled"].includes(order.status)) {
      await t.rollback();
      return res.status(400).json({ message: "Cannot change shipping address in current state." });
    }

    const payment = await Payment.findOne({
      where: { order_id: order.order_id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    // Tính lại phí ship nếu có province/ward mới (nếu không truyền, dùng cũ)
    const newProvinceId = province_id ?? order.province_id;
    const newWardId = ward_id ?? order.ward_id;

    if (!newProvinceId) {
      await t.rollback();
      return res.status(400).json({ message: "province_id is required (current or new)" });
    }

    const subtotal = Math.max(
      0,
      Number(order.total_amount || 0) - Number(order.discount_amount || 0)
    );

    const { shipping_fee: newShipFee } = await quoteShipping({
      province_id: Number(newProvinceId),
      ward_id: newWardId ? Number(newWardId) : null,
      subtotal,
    });

    const oldShipFee = Number(order.shipping_fee || 0);
    const willChangeAmount = Number(newShipFee) !== oldShipFee;

    console.log('updateShippingAddress debug:', {
      orderId: order.order_id,
      paymentProvider: payment?.provider,
      paymentStatus: payment?.payment_status,
      oldShipFee,
      newShipFee,
      willChangeAmount
    });

    if (payment?.provider === "VNPAY" && payment?.payment_status === "completed" && willChangeAmount) {
      await t.rollback();
      return res.status(400).json({
        message: "Cập nhật địa chỉ thất bại. Đơn hàng đã thanh toán VNPAY và phí ship sẽ thay đổi. Liên hệ hỗ trợ để xử lý hoàn tiền/phụ thu.",
      });
    }

    const oldData = {
      shipping_name: order.shipping_name,
      shipping_phone: order.shipping_phone,
      shipping_address: order.shipping_address,
    };

    // Cập nhật đơn
    const patch = {
      shipping_name: shipping_name ?? order.shipping_name,
      shipping_phone: shipping_phone ?? order.shipping_phone,
      shipping_address: shipping_address ?? order.shipping_address,
      province_id: newProvinceId,
      ward_id: newWardId,
      geo_lat: geo_lat ?? order.geo_lat,
      geo_lng: geo_lng ?? order.geo_lng,
      shipping_fee: newShipFee,
      final_amount: Math.max(0, subtotal + Number(newShipFee || 0)),
    };

    await order.update(patch, { transaction: t });

    // Đồng bộ số tiền ở Payment nếu chưa paid (pending/failed/refunded)
    if (payment && payment.payment_status !== "completed") {
      console.log('Updating payment amount to:', Number(order.final_amount || patch.final_amount || 0));
      await payment.update(
        { amount: Number(order.final_amount || patch.final_amount || 0) },
        { transaction: t }
      );
    }

    await t.commit();

    const newData = {
      shipping_name: order.shipping_name,
      shipping_phone: order.shipping_phone,
      shipping_address: order.shipping_address,
    };
    emitOrderEvent("order.shipping_address.changed", {
      order,
      oldData,
      newData,
      userId: order.user_id,
    });

    console.log('updateShippingAddress success for order:', order.order_id);
    return res.json({
      message: "Shipping address updated",
      order: {
        order_id: order.order_id,
        shipping_name: order.shipping_name,
        shipping_phone: order.shipping_phone,
        shipping_address: order.shipping_address,
        province_id: order.province_id,
        ward_id: order.ward_id,
        geo_lat: order.geo_lat,
        geo_lng: order.geo_lng,
        shipping_fee: Number(order.shipping_fee || newShipFee || 0),
        final_amount: Number(order.final_amount || patch.final_amount || 0),
      },
    });
  } catch (err) {
    await t.rollback();
    console.error('updateShippingAddress error:', err.message);
    next(err);
  }
};

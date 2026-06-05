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
const orderFacade = require("../services/order/orderFacade");
const orderQueryService = require("../services/order/orderQueryService");
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
    const result = await orderQueryService.listUserOrdersV2({
      userId: req.userId,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getUserOrders = async (req, res, next) => {
  try {
    const result = await orderQueryService.listUserOrders({
      userId: req.userId,
      query: req.query,
    });
    return res.json(result);
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


exports.previewOrder = async (req, res, next) => {
  try {
    const result = await orderFacade.previewOrder({ body: req.body });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return handleFacadeError(error, res, next);
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
  try {
    const result = await orderFacade.retryVnpayPayment({
      userId: req.user.user_id,
      orderId: req.params.order_id,
      method: req.body?.method,
      req,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return handleFacadeError(error, res, next);
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
  try {
    const result = await orderFacade.updateShippingAddress({
      userId: req.user.user_id,
      orderId: req.params.order_id,
      body: req.body,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return handleFacadeError(error, res, next);
  }
};

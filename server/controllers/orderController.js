const {
  Order,
  Payment,
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

exports.getOrderDetail = async (req, res, next) => {
  try {
    const order = await orderQueryService.getOrderDetailById({
      userId: req.user.user_id,
      orderId: req.params.order_id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.json({ order });
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
    const result = await orderQueryService.getOrderDetailSlim({
      userId: req.user.user_id,
      orderId: req.params.order_id,
    });

    if (!result) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.json(result);
  } catch (error) {
    next(error);
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

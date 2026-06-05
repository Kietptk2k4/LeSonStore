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
    const counters = await orderQueryService.getOrderCounters({
      userId: req.user.user_id,
    });
    return res.json(counters);
  } catch (err) {
    next(err);
  }
};

exports.getOrderCountersV2 = async (req, res, next) => {
  try {
    const counters = await orderQueryService.getOrderCountersV2({
      userId: req.user.user_id,
    });
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

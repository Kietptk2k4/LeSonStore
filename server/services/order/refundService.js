const { Order, Payment } = require("../../models");
const { emitOrderEvent } = require("../../events/orderEventBus");

function throwHttp(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

/**
 * Admin xác nhận hoàn tiền thủ công (VNPay + cancelled).
 * POST /api/admin/orders/:order_id/refund
 */
async function processAdminRefund({ orderId }) {
  const order = await Order.findByPk(orderId, {
    include: [{ model: Payment, as: "payment" }],
  });

  if (!order) {
    throwHttp(404, "Order not found");
  }

  if (order.status !== "cancelled") {
    throwHttp(400, "Order must be cancelled to refund");
  }

  if (order.payment?.provider !== "VNPAY") {
    throwHttp(400, "Only VNPAY orders can be refunded through admin");
  }

  if (order.payment) {
    await order.payment.update({ payment_status: "refunded" });
  }

  emitOrderEvent("order.refunded", {
    order,
    payment: order.payment,
  });

  return {
    message: "Order refunded successfully",
    order,
  };
}

module.exports = { processAdminRefund };

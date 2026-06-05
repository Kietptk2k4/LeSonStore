const { Payment } = require("../../models");

/**
 * VNPay return failed / invalid hash — mark payment failed only.
 * Does NOT load Order (test: Order.findByPk not called on failure).
 */
async function markPaymentFailedByOrderId(orderId) {
  const payment = await Payment.findOne({ where: { order_id: orderId } });
  if (!payment) {
    return { updated: false };
  }
  payment.payment_status = "failed";
  await payment.save();
  return { updated: true, payment };
}

module.exports = { markPaymentFailedByOrderId };

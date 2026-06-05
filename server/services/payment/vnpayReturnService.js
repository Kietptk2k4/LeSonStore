const { Order, Payment } = require("../../models");
const vnpayGateway = require("../gateways/vnpayGateway");
const vnpayStrategy = require("./vnpayStrategy");
const { emitOrderEvent } = require("../../events/orderEventBus");
const { markPaymentFailedByOrderId } = require("./paymentFailedService");

function parseOrderIdFromTxnRef(txnRef) {
  const ref = txnRef || "";
  const orderId = ref.split("-")[0];
  return orderId || null;
}

/**
 * Handle VNPay Return URL query params.
 * @returns {{ redirectStatus: 'success'|'failed', orderId: string }}
 */
async function handleVnpayReturn(query) {
  const { isSuccess, vnp_Params } = vnpayGateway.verifyCallback({ ...query });

  const txnRef = vnp_Params["vnp_TxnRef"] || "";
  const orderId = parseOrderIdFromTxnRef(txnRef);

  if (!orderId) {
    return { redirectStatus: "failed", orderId: "unknown" };
  }

  if (isSuccess) {
    const order = await Order.findByPk(orderId);
    const payment = await Payment.findOne({ where: { order_id: orderId } });

    if (order && payment) {
      const { updated } = await vnpayStrategy.applySuccessfulReturn({
        order,
        payment,
        txnRef,
        vnp_Params,
      });

      if (updated) {
        emitOrderEvent("payment.completed", { order, payment });
      }
    }

    return { redirectStatus: "success", orderId };
  }

  await markPaymentFailedByOrderId(orderId);
  return { redirectStatus: "failed", orderId };
}

module.exports = { handleVnpayReturn, parseOrderIdFromTxnRef };

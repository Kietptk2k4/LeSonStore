const { COD_METHODS } = require("./paymentConstants");

const provider = "COD";

function validateMethod(method, context = "createOrder") {
  if (!method || !COD_METHODS.includes(method)) {
    const err = new Error(
      context === "changePayment"
        ? `Invalid method for provider ${provider}`
        : `Invalid payment_method for provider ${provider}`
    );
    err.status = 400;
    throw err;
  }
}

function getInitialOrderStatus() {
  return "processing";
}

function getReserveHoldMs() {
  return 0;
}

function buildTxnRef() {
  return null;
}

function buildPaymentRecord({ order_id, payment_method, amount, txnRef }) {
  return {
    order_id,
    provider,
    payment_method,
    payment_status: "pending",
    amount,
    txn_ref: txnRef,
  };
}

async function afterOrderCreated() {
  return { redirect: null };
}

async function applyChangePayment({ order, payment, transaction }) {
  await payment.update(
    {
      provider: "COD",
      payment_method: "COD",
      payment_status: "pending",
      amount: Number(order.final_amount || 0),
      transaction_id: null,
      txn_ref: null,
      raw_return: null,
      raw_ipn: null,
      paid_at: null,
    },
    { transaction }
  );

  await order.update({ status: "processing" }, { transaction });

  return { redirect: null };
}

function buildRetryPaymentUrl() {
  const err = new Error("Payment record not found or not VNPAY");
  err.status = 400;
  throw err;
}

async function applySuccessfulReturn() {
  return { updated: false };
}

module.exports = {
  provider,
  allowedMethods: COD_METHODS,
  validateMethod,
  getInitialOrderStatus,
  getReserveHoldMs,
  buildTxnRef,
  buildPaymentRecord,
  afterOrderCreated,
  applyChangePayment,
  buildRetryPaymentUrl,
  applySuccessfulReturn,
};

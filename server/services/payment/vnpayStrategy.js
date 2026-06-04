const vnpayGateway = require("../gateways/vnpayGateway");
const {
  VNPAY_METHODS,
  VNPAY_REQUIRED_ENV,
  VNPAY_RESERVE_HOLD_MS,
} = require("./paymentConstants");

const provider = "VNPAY";

function validateMethod(method, context = "createOrder") {
  if (!method || !VNPAY_METHODS.includes(method)) {
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
  return "AWAITING_PAYMENT";
}

function getReserveHoldMs() {
  return VNPAY_RESERVE_HOLD_MS;
}

function buildTxnRef(orderId) {
  return `${orderId}-${Date.now()}`;
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

function assertVnpayConfig() {
  if (typeof vnpayGateway.createPaymentUrl !== "function") {
    throw new Error("vnpayService.getPaymentUrl not found");
  }
  const missing = VNPAY_REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error("Missing ENV: " + missing.join(", "));
  }
}

async function buildPaymentRedirect({ method, amount, txnRef, order, req, requireEnv = true }) {
  if (requireEnv) {
    assertVnpayConfig();
  }
  const redirect = await vnpayGateway.createPaymentUrl({
    method,
    amount,
    txnRef,
    orderDesc: `Thanh toan don hang ${order.order_code}`,
    ipAddr: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
  });
  return redirect;
}

async function afterOrderCreated({ order, payment_method, amount, txnRef, req }) {
  const redirect = await buildPaymentRedirect({
    method: payment_method,
    amount,
    txnRef,
    order,
    req,
  });
  return { redirect };
}

async function applyChangePayment({ order, payment, method, req, transaction }) {
  const newTxnRef = buildTxnRef(order.order_id);

  await payment.update(
    {
      provider: "VNPAY",
      payment_method: method,
      payment_status: "pending",
      amount: Number(order.final_amount || 0),
      transaction_id: null,
      txn_ref: newTxnRef,
      raw_return: null,
      raw_ipn: null,
      paid_at: null,
    },
    { transaction }
  );

  await order.update({ status: "AWAITING_PAYMENT" }, { transaction });

  const redirect = await buildPaymentRedirect({
    method,
    amount: Number(payment.amount || order.final_amount || 0),
    txnRef: newTxnRef,
    order,
    req,
  });

  return { redirect };
}

async function buildRetryPaymentUrl({ order, payment, method, req }) {
  validateMethod(method, "createOrder");
  return buildPaymentRedirect({
    method,
    amount: Number(payment.amount || order.final_amount || 0),
    txnRef: payment.txn_ref,
    order,
    req,
    requireEnv: false,
  });
}

async function applySuccessfulReturn({ order, payment, txnRef, vnp_Params }) {
  if (payment.payment_status === "completed") {
    return { updated: false };
  }

  payment.payment_status = "completed";
  payment.txn_ref = txnRef;
  payment.transaction_id = vnp_Params["vnp_TransactionNo"] || null;
  payment.paid_at = new Date();
  await payment.save();

  order.status = "processing";
  await order.save();

  return { updated: true };
}

module.exports = {
  provider,
  allowedMethods: VNPAY_METHODS,
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

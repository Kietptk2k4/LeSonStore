const vnpayGateway = require("../gateways/vnpayGateway");

function parseClientIp(req) {
  const ipAddrRaw =
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1";
  return Array.isArray(ipAddrRaw)
    ? ipAddrRaw[0]
    : String(ipAddrRaw).split(",")[0].trim();
}

async function createAdhocPaymentUrl({ orderId, amount, ipAddr }) {
  const txnRef = `${orderId}-${Date.now()}`;
  const url = await vnpayGateway.createPaymentUrl({
    amount,
    txnRef,
    orderDesc: `Thanh toan don hang #${orderId}`,
    ipAddr,
  });
  return { url };
}

module.exports = { createAdhocPaymentUrl, parseClientIp };

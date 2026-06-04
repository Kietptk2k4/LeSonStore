const vnpay = require("../vnpayService");

/** Thin wrapper — HMAC/sort logic stays in vnpayService.js */
const createPaymentUrl = (params) => vnpay.getPaymentUrl(params);
const verifyCallback = (query) => vnpay.verifyReturnUrl(query);

module.exports = { createPaymentUrl, verifyCallback };

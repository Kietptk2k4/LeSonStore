/** Allowed payment methods per provider — single source of truth (Step 2). */
module.exports = {
  COD_METHODS: ["COD"],
  VNPAY_METHODS: ["VNPAYQR", "VNBANK", "INTCARD", "INSTALLMENT"],
  VNPAY_REQUIRED_ENV: [
    "VNP_TMN_CODE",
    "VNP_HASHSECRET",
    "VNP_RETURNURL",
    "VNP_PAYURL",
  ],
  VNPAY_RESERVE_HOLD_MS: 24 * 60 * 60 * 1000,
};

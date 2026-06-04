const strategies = {
  COD: require("./codStrategy"),
  VNPAY: require("./vnpayStrategy"),
};

function getStrategy(provider) {
  const s = strategies[provider];
  if (!s) {
    const err = new Error(`Unsupported provider: ${provider}`);
    err.status = 400;
    throw err;
  }
  return s;
}

module.exports = { getStrategy };

let registered = false;

function registerOrderListeners() {
  if (registered) return;
  registered = true;
  require("./orderCreatedListener");
  require("./orderEmailListener");
  require("./orderPaymentCompletedListener");
}

module.exports = { registerOrderListeners };

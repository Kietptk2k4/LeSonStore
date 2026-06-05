let registered = false;

function registerOrderListeners() {
  if (registered) return;
  registered = true;
  require("./orderCreatedListener");
  require("./orderPaymentMethodChangedListener");
  require("./orderStatusChangedListener");
}

module.exports = { registerOrderListeners };

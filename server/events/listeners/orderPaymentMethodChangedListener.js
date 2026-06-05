const { User } = require("../../models");
const { bus } = require("../orderEventBus");

bus.on("order.payment_method.changed", async (payload) => {
  const { order, user, oldData, newData } = payload;

  try {
    const { sendOrderUpdateEmail } = require("../../services/emailService");
    const buyer =
      user || (order?.user_id ? await User.findByPk(order.user_id) : null);

    if (buyer) {
      sendOrderUpdateEmail({
        order,
        changeType: "PAYMENT_METHOD",
        oldData,
        newData,
        user: buyer,
      }).catch((err) =>
        console.error("Payment method update email failed:", err)
      );
    }
  } catch (emailError) {
    console.error("Failed to queue payment method update email:", emailError);
  }
});

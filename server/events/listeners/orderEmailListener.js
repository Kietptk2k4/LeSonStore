const { User } = require("../../models");
const { bus } = require("../orderEventBus");

bus.on("order.created", async (payload) => {
  const { order, items_breakdown, payment_provider, payment_method } = payload;

  try {
    const { sendOrderConfirmationEmail } = require("../../services/emailService");
    sendOrderConfirmationEmail({
      order,
      items_breakdown,
      payment_provider,
      payment_method,
    }).catch((err) => console.error("Email send failed:", err));
  } catch (emailError) {
    console.error("Failed to queue order confirmation email:", emailError);
  }
});

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

bus.on("order.status.changed", async ({ order, oldStatus, newStatus, context }) => {
  try {
    const user = order?.user_id ? await User.findByPk(order.user_id) : null;
    if (!user) return;

    const { sendOrderUpdateEmail } = require("../../services/emailService");
    sendOrderUpdateEmail({
      order,
      changeType: "ORDER_STATUS",
      oldData: { status: oldStatus },
      newData: { status: newStatus },
      user,
      context,
    }).catch((err) => console.error("Order status update email failed:", err));
  } catch (emailError) {
    console.error("Failed to queue order status update email:", emailError);
  }
});

bus.on("order.refunded", async ({ order, payment }) => {
  try {
    const user = order?.user_id ? await User.findByPk(order.user_id) : null;
    if (!user) return;

    const { sendOrderUpdateEmail } = require("../../services/emailService");
    sendOrderUpdateEmail({
      order,
      changeType: "ORDER_REFUND",
      oldData: {},
      newData: {
        amount: order.final_amount,
        provider: payment?.provider,
      },
      user,
    }).catch((err) => console.error("Order refund email failed:", err));
  } catch (emailError) {
    console.error("Failed to queue order refund email:", emailError);
  }
});

bus.on(
  "order.shipping_address.changed",
  async ({ order, oldData, newData, userId }) => {
    try {
      const user = userId ? await User.findByPk(userId) : null;
      if (!user) return;

      const { sendOrderUpdateEmail } = require("../../services/emailService");
      sendOrderUpdateEmail({
        order,
        changeType: "SHIPPING_ADDRESS",
        oldData,
        newData,
        user,
      }).catch((err) =>
        console.error("Shipping address update email failed:", err)
      );
    } catch (emailError) {
      console.error("Failed to queue shipping address update email:", emailError);
    }
  }
);

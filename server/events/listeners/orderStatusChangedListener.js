const { User } = require("../../models");
const { bus } = require("../orderEventBus");

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

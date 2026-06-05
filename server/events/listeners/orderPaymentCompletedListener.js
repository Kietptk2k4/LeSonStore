const { User, Role } = require("../../models");
const notificationService = require("../../services/notificationService");
const { bus } = require("../orderEventBus");

bus.on("payment.completed", async ({ order, payment }) => {
  if (!order) return;

  const orderId = order.order_id;
  const orderCode = order.order_code || orderId;

  if (order.user_id) {
    try {
      await notificationService.createNotification({
        userId: order.user_id,
        title: "Thanh toán thành công!",
        message: `Đơn hàng #${orderCode} đã được thanh toán thành công.`,
        type: "payment_success",
        relatedType: "order",
        relatedId: order.order_id,
      });
    } catch (err) {
      console.error("Lỗi thông báo cho User:", err);
    }
  }

  try {
    const staffUsers = await User.findAll({
      attributes: ["user_id"],
      include: [
        {
          model: Role,
          as: "Roles",
          where: { role_name: ["admin", "staff", "Admin", "Staff"] },
          required: true,
        },
      ],
    });

    if (staffUsers.length > 0) {
      const amountVal = payment?.amount || order.final_amount || 0;
      const amountStr = Number(amountVal).toLocaleString("vi-VN");

      const notiPromises = staffUsers.map((staff) =>
        notificationService.createNotification({
          userId: staff.user_id,
          title: "Nhận thanh toán VNPAY",
          message: `Đơn hàng #${orderCode} đã thanh toán ${amountStr}đ`,
          type: "payment_received",
          relatedType: "order",
          relatedId: order.order_id,
        })
      );

      await Promise.all(notiPromises);
      console.log(
        `>>> [DEBUG] Đã gửi thông báo thanh toán cho ${staffUsers.length} Admin.`
      );
    }
  } catch (notifError) {
    console.error(">>> [DEBUG] Lỗi gửi thông báo Admin:", notifError);
  }
});

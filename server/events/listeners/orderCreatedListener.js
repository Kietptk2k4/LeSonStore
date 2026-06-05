const { User, Role } = require("../../models");
const notificationService = require("../../services/notificationService");
const { bus } = require("../orderEventBus");

bus.on("order.created", async (payload) => {
  const { order, items_breakdown, payment_provider, payment_method, user } =
    payload;

  try {
    console.log(">>> [DEBUG] Bắt đầu quy trình thông báo đơn hàng mới...");

    const staffUsers = await User.findAll({
      attributes: ["user_id"],
      include: [
        {
          model: Role,
          as: "Roles",
          where: {
            role_name: ["admin", "staff", "Admin", "Staff"],
          },
          required: true,
        },
      ],
    });

    console.log(
      `>>> [DEBUG] Tìm thấy ${staffUsers.length} người dùng cần thông báo.`
    );

    if (staffUsers.length > 0) {
      const buyerName = user?.full_name || user?.username || "Khách hàng";

      const notiPromises = staffUsers.map((staff) =>
        notificationService.createNotification({
          userId: staff.user_id,
          title: "Đơn hàng mới!",
          message: `Khách hàng ${buyerName} vừa đặt đơn #${order.order_code}`,
          type: "new_order",
          relatedType: "order",
          relatedId: order.order_id,
        })
      );

      await Promise.all(notiPromises);
      console.log(
        `>>> [DEBUG] Đã gửi thông báo thành công tới ${staffUsers.length} tài khoản.`
      );
    } else {
      console.log(
        ">>> [DEBUG] Cảnh báo: Không tìm thấy Admin/Staff nào trong DB."
      );
    }
  } catch (notifError) {
    console.error(">>> [DEBUG] Lỗi CHẾT thông báo đơn hàng:", notifError);
  }

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

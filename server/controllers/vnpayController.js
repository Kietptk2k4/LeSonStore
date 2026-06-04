const { Payment, Order, User, Role } = require("../models");
const vnpayGateway = require("../services/gateways/vnpayGateway");
const vnpayStrategy = require("../services/payment/vnpayStrategy");

const notificationService = require("../services/notificationService");

// 1. Tạo link thanh toán
exports.createPayment = async (req, res) => {
  try {
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({ message: "Thiếu orderId hoặc amount" });
    }

    // Lấy IP thật của user (ưu tiên x-forwarded-for nếu có proxy)
    const ipAddrRaw = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
    const ipAddr = Array.isArray(ipAddrRaw) ? ipAddrRaw[0] : String(ipAddrRaw).split(",")[0].trim();

    // TxnRef nên unique (orderId-timestamp)
    const txnRef = `${orderId}-${Date.now()}`;

    const url = await vnpayGateway.createPaymentUrl({
      amount,
      txnRef,
      orderDesc: `Thanh toan don hang #${orderId}`,
      ipAddr,
      // method: req.body.method, // (không khuyến nghị) - để VNPAY cho chọn
    });

    return res.json({ url });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Lỗi tạo link thanh toán" });
  }
};

// 2. Xử lý khi user quay lại từ VNPAY (Return URL)
exports.vnpayReturn = async (req, res) => {
  try {
    const { isSuccess, vnp_Params } = vnpayGateway.verifyCallback({ ...req.query });

    // Lấy Order ID từ txnRef (format: orderId-timestamp)
    const txnRef = vnp_Params["vnp_TxnRef"] || "";
    const orderId = txnRef.split("-")[0];

    const frontendUrl = process.env.FE_APP_URL || "http://localhost:3000";

    if (!orderId) {
      return res.redirect(`${frontendUrl}/checkout/vnpay-return?status=failed&orderId=unknown`);
    }

    if (isSuccess) {
      // --- LOGIC CẬP NHẬT DB ---
      const order = await Order.findByPk(orderId);
      const payment = await Payment.findOne({ where: { order_id: orderId } });

      if (order && payment) {
        const { updated } = await vnpayStrategy.applySuccessfulReturn({
          order,
          payment,
          txnRef,
          vnp_Params,
        });

        if (updated) {
           // =========================================================
          // 3. GỬI THÔNG BÁO (NOTIFICATION SERVICE) - UPDATED
          // =========================================================
          
          // A. Báo cho Khách hàng: "Thanh toán thành công"
          if (order.user_id) {
            try {
                await notificationService.createNotification({
                    userId: order.user_id,
                    title: "Thanh toán thành công!",
                    message: `Đơn hàng #${order.order_code || orderId} đã được thanh toán thành công.`,
                    type: "payment_success",
                    relatedType: "order",
                    relatedId: order.order_id
                });
            } catch (err) {
                console.error("Lỗi thông báo cho User:", err);
            }
          }

          // B. Báo cho Admin: "Nhận được tiền" 
          try {
              // Tìm tất cả Admin/Staff
              const staffUsers = await User.findAll({
                  attributes: ['user_id'],
                  include: [{
                      model: Role,
                      as: 'Roles',
                      where: { role_name: ['admin', 'staff', 'Admin', 'Staff'] }, // Cover cả hoa/thường
                      required: true
                  }]
              });

              if (staffUsers.length > 0) {
                  // Lấy số tiền từ payment hoặc order để hiển thị
                  const amountVal = payment.amount || order.final_amount || 0;
                  const amountStr = Number(amountVal).toLocaleString('vi-VN');

                  const notiPromises = staffUsers.map(staff => {
                      return notificationService.createNotification({
                          userId: staff.user_id, // Gửi đích danh ID để socket chạy
                          title: "Nhận thanh toán VNPAY",
                          message: `Đơn hàng #${order.order_code || orderId} đã thanh toán ${amountStr}đ`,
                          type: "payment_received",
                          relatedType: "order",
                          relatedId: order.order_id
                      });
                  });

                  await Promise.all(notiPromises);
                  console.log(`>>> [DEBUG] Đã gửi thông báo thanh toán cho ${staffUsers.length} Admin.`);
              }
          } catch (notifError) {
              console.error(">>> [DEBUG] Lỗi gửi thông báo Admin:", notifError);
          }
        }
      }

      return res.redirect(
        `${frontendUrl}/checkout/vnpay-return?status=success&orderId=${encodeURIComponent(orderId)}`
      );
    } else {
      const payment = await Payment.findOne({ where: { order_id: orderId } });
      if (payment) {
        payment.payment_status = "failed";
        await payment.save();
      }

      return res.redirect(
        `${frontendUrl}/checkout/vnpay-return?status=failed&orderId=${encodeURIComponent(orderId)}`
      );
    }
  } catch (error) {
    console.error("VNPAY Return Error:", error);
    const frontendUrl = process.env.FE_APP_URL || "http://localhost:3000";
    return res.redirect(`${frontendUrl}/orders?error=unknown`);
  }
};

const vnpayReturnService = require("../services/payment/vnpayReturnService");
const vnpayPaymentService = require("../services/payment/vnpayPaymentService");

// 1. Tạo link thanh toán
exports.createPayment = async (req, res) => {
  try {
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({ message: "Thiếu orderId hoặc amount" });
    }

    const ipAddr = vnpayPaymentService.parseClientIp(req);
    const { url } = await vnpayPaymentService.createAdhocPaymentUrl({
      orderId,
      amount,
      ipAddr,
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
    const frontendUrl = process.env.FE_APP_URL || "http://localhost:3000";
    const { redirectStatus, orderId } =
      await vnpayReturnService.handleVnpayReturn(req.query);

    if (orderId === "unknown") {
      return res.redirect(
        `${frontendUrl}/checkout/vnpay-return?status=failed&orderId=unknown`
      );
    }

    return res.redirect(
      `${frontendUrl}/checkout/vnpay-return?status=${redirectStatus}&orderId=${encodeURIComponent(orderId)}`
    );
  } catch (error) {
    console.error("VNPAY Return Error:", error);
    const frontendUrl = process.env.FE_APP_URL || "http://localhost:3000";
    return res.redirect(`${frontendUrl}/orders?error=unknown`);
  }
};

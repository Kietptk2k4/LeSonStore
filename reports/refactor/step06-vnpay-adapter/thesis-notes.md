# Ghi chú báo cáo — Bước 6 Adapter VNPay

---

## Đoạn copy vào Word (tiếng Việt)

> Hệ thống LeSonStore tích hợp cổng **VNPay** qua thư viện nội bộ `vnpayService.js`, trong đó chứa logic ký **HMAC-SHA512**, sắp xếp tham số và ghép URL sandbox. Nếu để Strategy đặt hàng và Controller gọi trực tiếp `getPaymentUrl` / `verifyReturnUrl`, tầng nghiệp vụ sẽ **phụ thuộc chi tiết SDK VNPay** — khó thay cổng, khó test mock, và dễ lẫn trách nhiệm “đặt hàng” với “ký giao dịch”.
>
> **Adapter pattern** được áp dụng qua `vnpayGateway.js`: lớp này implement hợp đồng `PaymentGateway` (`createPaymentUrl`, `verifyCallback`) và ủy quyền sang Adaptee `vnpayService`. `vnpayStrategy` (Client Strategy từ Bước 2) và `vnpayController` chỉ biết gateway, **không import crypto**. Khi mở rộng **MoMo**, chỉ cần `momoGateway.js` cùng contract — Facade và luồng đặt hàng không đổi.
>
> **Lợi ích:** tách biệt domain thanh toán và giao thức cổng; một điểm thay đổi khi VNPay đổi tên API nội bộ; kiểm thử Strategy mock gateway thay vì mock HMAC. File chính: `server/services/gateways/vnpayGateway.js`, `server/services/vnpayService.js`.

---

## Vấn đề → Pattern → Lợi ích

| Vấn đề | Pattern | Lợi ích |
|--------|---------|---------|
| Strategy/Controller import `vnpayService` | **Adapter** (`vnpayGateway`) | Client chỉ biết `PaymentGateway` |
| HMAC VNPay không thuộc domain order | Adaptee tách riêng | Đổi cổng không sửa Facade |
| Tên hàm `getPaymentUrl` gắn vendor | `createPaymentUrl` / `verifyCallback` | Contract trung lập |

---

## File tham chiếu

| File | Vai trò |
|------|---------|
| `gateways/vnpayGateway.js` | Adapter |
| `vnpayService.js` | Adaptee |
| `payment/vnpayStrategy.js` | Client Strategy |
| `controllers/vnpayController.js` | HTTP entry |

---

## Diagram

[diagrams/vnpay-adapter-class.puml](./diagrams/vnpay-adapter-class.puml)

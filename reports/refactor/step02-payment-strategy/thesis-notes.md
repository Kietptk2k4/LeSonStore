# Ghi chú báo cáo — Bước 2 Strategy (Payment)

---

## Đoạn copy vào Word (tiếng Việt)

> **Repository che Sequelize; Strategy che luồng thanh toán.** Sau Bước 1, truy cập DB đơn hàng đã nằm trong `orderRepository`. Bước 2 áp dụng **Strategy** cho hai cổng **COD** và **VNPAY**: mỗi cổng là một object (`codStrategy`, `vnpayStrategy`) với cùng hợp đồng — `validateMethod`, `getInitialOrderStatus`, `buildPaymentRecord`, `afterOrderCreated`, `applyChangePayment`, v.v. Controller gọi `getStrategy(payment_provider)` thay vì `if (provider === "COD")`. Logic ký HMAC VNPay vẫn trong `vnpayService.js`, được bọc qua `vnpayGateway.js`; strategy không import crypto trực tiếp.
>
> **Mở rộng:** thêm **MoMo** chỉ cần file `momoStrategy.js` và một dòng trong registry — **không** cần sửa Facade (Bước 3). Kiểm thử hồi quy 55 test case (đặt hàng, đổi PT, retry, return URL) pass mà không đổi route hay JSON response.

---

## Vấn đề → Pattern

| Vấn đề | Strategy |
|--------|----------|
| `if (COD) … else (VNPAY)` lặp ở createOrder, changePaymentMethod | Một interface, nhiều implementation |
| VALID methods duplicate | `paymentConstants.js` |
| vnpayController + orderController cùng biết chi tiết VNPAY | `vnpayStrategy.applySuccessfulReturn`, `afterOrderCreated` |

---

## Lộ trình

| Bước | Nội dung |
|------|----------|
| 0 | Pattern hiện hữu |
| 1 | Repository |
| **2** | **Payment Strategy** ← đây |
| 3 | Facade (orderFacade) — chưa làm |

---

## Diagram

[diagrams/payment-strategy-class.puml](./diagrams/payment-strategy-class.puml)

Export PNG: PlantUML extension / plantuml.com

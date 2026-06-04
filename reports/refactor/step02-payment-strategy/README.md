# Bước 2 — Payment Strategy (COD / VNPAY)

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành — 55 tests pass (createOrder, vnpay create, changePaymentMethod, retry, vnpayReturn)

---

## Mục đích

Tách logic thanh toán **COD** vs **VNPAY** khỏi `orderController.js` và `vnpayController.js` (phần status, redirect, payment fields) sang **Strategy pattern**. API JSON, HTTP status và message giữ nguyên.

## Phụ thuộc

- **Bước 1:** `server/services/order/orderRepository.js` (vẫn dùng `createPaymentRecord`)

## File thay đổi / mới

| File | Vai trò |
|------|---------|
| `server/services/payment/paymentStrategy.js` | Registry `getStrategy(provider)` |
| `server/services/payment/codStrategy.js` | Strategy COD |
| `server/services/payment/vnpayStrategy.js` | Strategy VNPAY |
| `server/services/payment/paymentConstants.js` | `allowedMethods`, ENV keys |
| `server/services/gateways/vnpayGateway.js` | Bọc `vnpayService` (HMAC không đổi) |
| `server/controllers/orderController.js` | `createOrder`, `changePaymentMethod`, `retryVnpayPayment` |
| `server/controllers/vnpayController.js` | `vnpayReturn`, `createPayment` |

## Không nằm trong bước này

| Module | Bước |
|--------|------|
| **orderFacade** | **Bước 3** |
| orderStateMachine | Chưa |
| orderEventBus / Observer email | Giữ trong controller |
| adminController | Không refactor |

## MoMo / cổng mới

Thêm file `momoStrategy.js` + đăng ký trong `paymentStrategy.js` — **không** sửa Facade (chưa có).

## Kiểm tra

```bash
cd server
npm test -- __tests__/orders/createOrder.test.js __tests__/orders/vnpayPaymentInCreateOrder.test.js __tests__/orders/changePaymentMethod.test.js __tests__/orders/retryVnpayPayment.test.js __tests__/payment/vnpayReturn.test.js
```

## Tài liệu

- [strategy-contract.md](./strategy-contract.md)
- [before-after.md](./before-after.md)
- [thesis-notes.md](./thesis-notes.md)
- [diagrams/payment-strategy-class.puml](./diagrams/payment-strategy-class.puml)

## Liên quan

- [Bước 1 — Repository](../step01-repository/README.md)
- [Bước 0 — Pattern hiện hữu](../../already_done/design-patterns-step0.md)

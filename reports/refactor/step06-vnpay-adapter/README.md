# Bước 6 — Adapter VNPay

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành (formalize) — code adapter đã có từ [Bước 2](../step02-payment-strategy/README.md); Bước 6 ghi nhận pattern + contract cho báo cáo đồ án

---

## Mục đích

Áp dụng **Adapter pattern** để tách **Client** (Strategy, Controller) khỏi **Adaptee** (`vnpayService.js` — HMAC SHA512, sort params, URL sandbox VNPay). `vnpayGateway.js` cung cấp interface `PaymentGateway` thống nhất (`createPaymentUrl`, `verifyCallback`) mà không đổi logic ký/verify hiện có.

## Phụ thuộc

- **Bước 2 — Payment Strategy:** `vnpayStrategy.js` là Client chính; gateway được tạo lần đầu trong Bước 2
- **Bước 3 — Order Facade:** `orderFacade` → `vnpayStrategy` → `vnpayGateway` (không import crypto)
- `vnpayService.js` — Adaptee giữ nguyên HMAC/sort

## File liên quan

| File | Vai trò |
|------|---------|
| `server/services/vnpayService.js` | **Adaptee** — `getPaymentUrl`, `verifyReturnUrl`, HMAC/sort |
| `server/services/gateways/vnpayGateway.js` | **Adapter** — `createPaymentUrl` → `getPaymentUrl`; `verifyCallback` → `verifyReturnUrl` |
| `server/services/gateways/paymentGatewayContract.js` | JSDoc `@typedef PaymentGateway` (tài liệu hóa contract, không runtime) |
| `server/services/payment/vnpayStrategy.js` | **Client** Strategy — chỉ `require` gateway, không crypto |
| `server/controllers/vnpayController.js` | HTTP — `createPayment`, `vnpayReturn` qua gateway + strategy |

## Audit import `vnpayService` (production)

Chỉ **`vnpayGateway.js`** import trực tiếp `vnpayService` trong luồng runtime:

```
vnpayStrategy / vnpayController → vnpayGateway → vnpayService
```

Ngoại lệ hợp lệ: `__tests__/`, `scripts/` (mock hoặc báo cáo unit test).

## Không nằm trong bước này

- Sửa HMAC, ENV keys, sandbox URL trong `vnpayService.js`
- `momoGateway.js` (chỉ mô tả mở rộng trong contract)
- Refactor Facade / Observer (Bước 3–5)

## Kiểm tra

```bash
cd server
npm test -- __tests__/payment/vnpayReturn.test.js __tests__/payment/vnpayService.getPaymentUrl.test.js __tests__/payment/verifyReturnUrl.test.js __tests__/orders/vnpayPaymentInCreateOrder.test.js
```

## Tài liệu

- [adapter-contract.md](./adapter-contract.md)
- [before-after.md](./before-after.md)
- [thesis-notes.md](./thesis-notes.md)
- [diagrams/vnpay-adapter-class.puml](./diagrams/vnpay-adapter-class.puml)

## Liên quan

- [Bước 2 — Payment Strategy](../step02-payment-strategy/README.md) (gateway lần đầu)
- [Bước 3 — Order Facade](../step03-order-facade/README.md)

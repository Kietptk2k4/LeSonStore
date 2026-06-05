# Bước 10 — VNPay Return Service (D2)

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành — vnpayReturn, createVNPayPaymentUrl tests

---

## Mục đích

Rút gọn `vnpayController` thành thin HTTP layer; orchestration chuyển sang Application Services.

## File

| File | Vai trò |
|------|---------|
| `vnpayReturnService.js` | `handleVnpayReturn` — gateway verify, strategy success, emit |
| `paymentFailedService.js` | `markPaymentFailedByOrderId` — chỉ Payment, không Order |
| `vnpayPaymentService.js` | `createAdhocPaymentUrl`, `parseClientIp` |
| `vnpayController.js` | JSON / redirect only |
| `vnpayGateway.js` | Adapter (Bước 6) |
| `vnpayStrategy.js` | `applySuccessfulReturn` + State |

## Luồng

| Nhánh | Adapter | Strategy/State | Observer |
|-------|---------|----------------|----------|
| Success | `verifyCallback` | `applySuccessfulReturn` | `payment.completed` if `updated` |
| Failed | `verifyCallback` | — | — |

`registerOrderListeners()` chỉ trong `server.js` — **không** gọi từ `vnpayController`.

## Kiểm tra

```bash
cd server
npm test -- __tests__/payment/vnpayReturn.test.js __tests__/payment/createVNPayPaymentUrl.test.js
```

## Liên quan

- [Bước 6 — Adapter VNPay](../step06-vnpay-adapter/README.md)
- [Bước 5 — Observer](../step05-observer/README.md)

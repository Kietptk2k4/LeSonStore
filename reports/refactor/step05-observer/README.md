# Bước 5 — Observer (email / notification) — hoàn thiện

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành — 89 tests pass (vnpayReturn, admin status/ship/deliver, createOrder, changePaymentMethod, updateOrderShippingAddress)

---

## Mục đích

Hoàn thiện **Observer** cho side-effect email và notification: controller/facade chỉ `emitOrderEvent` sau commit; listener gọi `emailService` / `notificationService`.

## Đã có từ Bước 3–4 (giữ nguyên)

| Thành phần | Vai trò |
|------------|---------|
| `orderEventBus.js` | `bus`, `emitOrderEvent` |
| `orderFacade.js` | Emit `order.created`, `order.cancelled`, `order.payment_method.changed` sau commit |
| `orderStateMachine.js` | `emitStatusChanged` → `order.status.changed` |
| `adminController` | ship/deliver/updateOrderStatus — FSM, không email inline |
| `orderCreatedListener.js` | `order.created` → thông báo staff |

## Thêm / đổi Bước 5

| File | Vai trò |
|------|---------|
| `orderEmailListener.js` | Gom email: `order.created`, `order.payment_method.changed`, `order.status.changed`, `order.refunded`, `order.shipping_address.changed` |
| `orderPaymentCompletedListener.js` | `payment.completed` → notification user + staff |
| `vnpayController.js` | Emit `payment.completed` khi `updated`; bỏ notification inline |
| `adminController.refundOrder` | Emit `order.refunded` |
| `orderController.updateShippingAddress` | Emit `order.shipping_address.changed` sau commit |

**Đã xóa (merge vào orderEmailListener):** `orderPaymentMethodChangedListener.js`, `orderStatusChangedListener.js`

## Đăng ký listener (`index.js`)

1. `orderCreatedListener` — notification only  
2. `orderEmailListener` — tất cả email đơn hàng  
3. `orderPaymentCompletedListener` — VNPAY payment success  

`registerOrderListeners()` idempotent; gọi từ `server.js`, `orderFacade`, `adminController`, `vnpayController`.

## Kiểm tra grep (controllers)

- `adminController.js` — không `emailService` / `sendOrderUpdateEmail`
- `orderController.js` — không `sendOrder*` trong luồng đơn
- `vnpayController.js` — không `notificationService` trong `vnpayReturn`

## Kiểm tra

```bash
cd server
npm test -- __tests__/payment/vnpayReturn.test.js __tests__/admin/adminShipOrder.test.js __tests__/admin/adminDeliverOrder.test.js __tests__/admin/adminUpdateOrderStatus.test.js __tests__/orders/createOrder.test.js __tests__/orders/changePaymentMethod.test.js __tests__/orders/updateOrderShippingAddress.test.js
```

## Tài liệu

- [event-catalog.md](./event-catalog.md)
- [before-after.md](./before-after.md)
- [thesis-notes.md](./thesis-notes.md)
- [diagrams/observer-sequence.puml](./diagrams/observer-sequence.puml)

## Liên quan

- [Bước 3 — Order Facade](../step03-order-facade/README.md)
- [Bước 4 — Order State Machine](../step04-order-state-machine/README.md)

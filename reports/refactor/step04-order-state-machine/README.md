# Bước 4 — Order State Machine

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành — 58 tests pass (admin status/ship/deliver, cancelOrder, vnpayReturn)

---

## Mục đích

Tập trung mọi thay đổi `order.status` qua **State pattern** (`orderStateMachine.js`). Email admin khi đổi trạng thái tách khỏi controller → listener `order.status.changed` (Observer).

## Tiền đề (Bước 1–3)

- `orderRepository.js`, `paymentStrategy` / COD / VNPAY
- `orderEventBus`, listeners `order.created`, `order.payment_method.changed`
- `orderFacade.js` (cancelOrder — không tạo facade mới)

## File mới / đổi

| File | Vai trò |
|------|---------|
| `server/services/order/orderStateMachine.js` | `ALLOWED`, `assertTransition`, `applyTransition`, `emitStatusChanged` |
| `server/events/listeners/orderStatusChangedListener.js` | `order.status.changed` → `sendOrderUpdateEmail` ORDER_STATUS |
| `server/events/listeners/index.js` | Đăng ký listener status |
| `server/controllers/adminController.js` | `updateOrderStatus`, `shipOrder`, `deliverOrder` dùng FSM |
| `server/services/order/orderFacade.js` | `cancelOrder` → `applyTransition` + emit sau commit |
| `server/services/payment/vnpayStrategy.js` | `applySuccessfulReturn` → AWAITING_PAYMENT → processing |

## Thay đổi có chủ đích so với BR-01 (no FSM)

Trước đây admin `PUT .../status` cho phép **processing → delivered** trực tiếp (BR-01). Với FSM, transition này **bị cấm** (400 `Invalid transition: processing → delivered`). Admin phải đi **processing → shipping → delivered** (ship + deliver) hoặc chỉ dùng `updateOrderStatus` cho các cạnh trong [transitions.md](./transitions.md).

## Quy tắc emit

`applyTransition` **không** emit event. Caller gọi `emitStatusChanged` **sau khi transaction commit** (cancel trong facade, admin/vnpay không transaction).

## Không làm trong bước này

- Facade mới / mở rộng facade cho admin
- Refactor catalog / admin product
- Đổi URL route
- FSM cho `payment.status`

## Kiểm tra

```bash
cd server
npm test -- __tests__/admin/adminUpdateOrderStatus.test.js __tests__/admin/adminShipOrder.test.js __tests__/admin/adminDeliverOrder.test.js __tests__/orders/cancelOrder.test.js __tests__/payment/vnpayReturn.test.js
```

## Tài liệu

- [transitions.md](./transitions.md)
- [before-after.md](./before-after.md)
- [thesis-notes.md](./thesis-notes.md)
- [diagrams/order-state-machine.puml](./diagrams/order-state-machine.puml)

## Liên quan

- [Bước 1 — Repository](../step01-repository/README.md)
- [Bước 2 — Payment Strategy](../step02-payment-strategy/README.md)
- [Bước 3 — Order Facade](../step03-order-facade/README.md)

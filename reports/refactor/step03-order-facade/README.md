# Bước 3 — Order Facade

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành — 48 tests pass (createOrder, vnpay create, changePaymentMethod, cancelOrder)

---

## Mục đích

Áp dụng **Facade pattern** gom orchestration đặt/hủy/đổi PT thanh toán vào `orderFacade.js`. Controller chỉ parse HTTP → gọi facade → `res.status().json()`. Side-effect email/notification chuyển sang **event listeners** (Observer qua EventEmitter).

## Tiền đề (Bước 1–2)

- `orderRepository.js` — stock, payment record, order bundle
- `paymentStrategy.js`, `codStrategy.js`, `vnpayStrategy.js`
- `vnpayGateway.js`

## File mới / đổi

| File | Vai trò |
|------|---------|
| `server/services/order/orderFacade.js` | Facade: `createFromCart`, `cancelOrder`, `changePaymentMethod` |
| `server/events/orderEventBus.js` | EventEmitter singleton |
| `server/events/listeners/orderCreatedListener.js` | `order.created` → notification + email |
| `server/events/listeners/orderPaymentMethodChangedListener.js` | `order.payment_method.changed` → email |
| `server/events/listeners/index.js` | `registerOrderListeners()` |
| `server/server.js` | Gọi `registerOrderListeners()` sau dotenv |
| `server/controllers/orderController.js` | 3 handler mỏng; GET/list handlers **giữ nguyên** |

## Phạm vi controller sau refactor

`orderController.js` **vẫn dài** (~900+ dòng) do các handler không đưa vào facade:

- `getUserOrdersV2`, `getOrderDetail`, `previewOrder`, `retryVnpayPayment`, `updateShippingAddress`, …

Chỉ **createOrder**, **cancelOrder**, **changePaymentMethod** gọi facade.

## Không làm trong bước này

- orderStateMachine
- Refactor adminController / vnpayController (logic return VNPAY giữ nguyên)
- Đưa retryVnpayPayment, previewOrder, getUserOrders vào facade
- Payment strategy mới (MoMo)

## Kiểm tra

```bash
cd server
npm test -- __tests__/orders/createOrder.test.js __tests__/orders/vnpayPaymentInCreateOrder.test.js __tests__/orders/changePaymentMethod.test.js __tests__/orders/cancelOrder.test.js
```

## Tài liệu

- [facade-api.md](./facade-api.md)
- [before-after.md](./before-after.md)
- [thesis-notes.md](./thesis-notes.md)
- [diagrams/facade-class.puml](./diagrams/facade-class.puml)
- [diagrams/facade-create-order-sequence.puml](./diagrams/facade-create-order-sequence.puml)

## Liên quan

- [Bước 1 — Repository](../step01-repository/README.md)
- [Bước 2 — Payment Strategy](../step02-payment-strategy/README.md)

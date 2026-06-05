# Event catalog — Order Observer

| Event | Emitter | Listener file | Side-effect |
|-------|---------|---------------|-------------|
| `order.created` | `orderFacade.createFromCart` | `orderCreatedListener` | Staff `createNotification` (new_order) |
| `order.created` | same | `orderEmailListener` | `sendOrderConfirmationEmail` |
| `order.payment_method.changed` | `orderFacade.changePaymentMethod` | `orderEmailListener` | `sendOrderUpdateEmail` PAYMENT_METHOD |
| `order.status.changed` | `orderStateMachine.emitStatusChanged` (admin, cancel, vnpay) | `orderEmailListener` | `sendOrderUpdateEmail` ORDER_STATUS |
| `order.cancelled` | `orderFacade.cancelOrder` | *(chưa có listener — reserved)* | — |
| `order.refunded` | `adminController.refundOrder` | `orderEmailListener` | `sendOrderUpdateEmail` ORDER_REFUND |
| `order.shipping_address.changed` | `orderFacade.updateShippingAddress` (sau commit) | `orderEmailListener` | `sendOrderUpdateEmail` SHIPPING_ADDRESS |
| `payment.completed` | `vnpayController.vnpayReturn` (khi `updated === true`) | `orderPaymentCompletedListener` | User `payment_success` + staff `payment_received` |

## Quy tắc

- Mỗi event **email** chỉ subscribe một lần trong `orderEmailListener.js`.
- Emit **sau** `transaction.commit()` (hoặc sau `order.update` không transaction).
- Listener **không throw** — `.catch` / try-catch + log.

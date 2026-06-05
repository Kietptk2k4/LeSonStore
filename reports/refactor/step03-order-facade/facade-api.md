# orderFacade — API Reference

**Module:** `server/services/order/orderFacade.js`

Facade che orchestration phức tạp; **không** gọi `res.json`. Lỗi nghiệp vụ: `throw Error` với `.status` (400, 404, 502) và `.detail` (VNPAY config).

---

## `createFromCart({ userId, user, body, req })`

Luồng tương đương `POST /api/orders` (logic cũ `createOrder`).

| Bước | Hành vi |
|------|---------|
| Validate | geo, `getStrategy`, `validateMethod` |
| Items | body `items` hoặc cart |
| Pricing | stock check, `quoteShipping`, `Order.create` |
| Persist | `reserveVariationStock`, `OrderItem.create`, `createPaymentRecord` |
| Cart | clear selected / full cart |
| Payment | `strategy.afterOrderCreated` → redirect |
| Commit | `sequelize.transaction` |
| Event | `emitOrderEvent("order.created", …)` |

**Return:**

```js
{
  statusCode: 201,
  body: {
    message: "Order created successfully",
    order: { order_id, order_code, total_amount, discount_amount, final_amount, status, shipping_fee, items_breakdown },
    redirect
  }
}
```

---

## `cancelOrder({ userId, orderId, reason })`

Luồng `POST /api/orders/:order_id/cancel`.

| Bước | Hành vi |
|------|---------|
| Load | `findOrderWithItemsAndPayment(..., lockOrder: true)` |
| Guard | isAwaitingVnpay / isToShipCOD / isToShipVNPAY |
| Stock | `releaseVariationStock` loop |
| Update | order cancelled + payment branches |
| Event | `emitOrderEvent("order.cancelled", …)` (optional, no listener) |

**Return:**

```js
{
  statusCode: 200,
  body: {
    message: "Order cancelled successfully",
    order: { order_id, status: "cancelled", payment_status }
  }
}
```

---

## `changePaymentMethod({ userId, orderId, provider, method, req })`

Luồng `POST /api/orders/:order_id/payment-method`.

| Bước | Hành vi |
|------|---------|
| Strategy | `getStrategy`, `validateMethod("changePayment")` |
| Lock | `Order.findOne`, `Payment.findOne` |
| Snapshot | `oldData` provider/method **trước** `applyChangePayment` |
| Apply | `strategy.applyChangePayment` |
| Event | `emitOrderEvent("order.payment_method.changed", { oldData, newData, … })` |

**Return:**

```js
{
  statusCode: 200,
  body: {
    message: "Payment method updated",
    order: { order_id, status },
    payment: { provider, method, status: "pending" },
    redirect
  }
}
```

---

## Helpers (private trong facade)

- `generateOrderCode()` — `ORD-{timestamp}-{random}`
- `appendNote(oldNote, reason)` — ghi chú hủy đơn

---

## Event bus

| Event | Listener | Side-effect |
|-------|----------|-------------|
| `order.created` | `orderCreatedListener.js` | Staff notification + `sendOrderConfirmationEmail` |
| `order.payment_method.changed` | `orderPaymentMethodChangedListener.js` | `sendOrderUpdateEmail` |
| `order.cancelled` | — | Emit only (mở rộng sau) |

Đăng ký: `registerOrderListeners()` trong `server.js` và khi load `orderFacade.js` (idempotent).

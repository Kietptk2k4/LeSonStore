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
| Pricing | `buildOrderPricing` (strict), `quoteShipping`, `Order.create` |
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

## `previewOrder({ body })`

Luồng `POST /api/orders/preview` — **read-only**, không transaction, không `emitOrderEvent`.

| Bước | Hành vi |
|------|---------|
| Validate | `items` không rỗng, `province_id` bắt buộc |
| Load | `ProductVariation.findByPk` + `product` |
| Pricing | `buildOrderPricing(lines, { stockMode: 'warn', includeCatalogFields: true })` |
| Shipping | `quoteShipping` → `final_amount` |

**Return:**

```js
{
  statusCode: 200,
  body: {
    total_amount,
    discount_amount,
    subtotal_after_discount,
    shipping_fee,
    shipping_reason,
    final_amount,
    items_breakdown,  // có thumbnail_url, slug
    stock_warnings
  }
}
```

---

## `updateShippingAddress({ userId, orderId, body })`

Luồng `PUT /api/orders/:order_id/shipping-address`.

| Bước | Hành vi |
|------|---------|
| Lock | transaction + `LOCK.UPDATE` |
| Validate | status không ∈ shipping/delivered/cancelled; `province_id` |
| Ship | `quoteShipping` → có thể chặn VNPAY completed + đổi phí |
| Persist | `order.update`, `payment.update` nếu chưa completed |
| Event | `emitOrderEvent("order.shipping_address.changed")` **sau commit** |

**Return:** `{ statusCode: 200, body: { message, order: { … } } }`

---

## `retryVnpayPayment({ userId, orderId, method, req })`

Luồng `POST /api/orders/:order_id/payments/retry` — VNPAY only.

| Bước | Hành vi |
|------|---------|
| Strategy | `getStrategy("VNPAY")`, `validateMethod`, `applyRetryPayment` |
| Lock | transaction + `LOCK.UPDATE` |
| Eligible | `payment_status === pending` AND `order.status` IN (`AWAITING_PAYMENT`, `FAILED`) |
| Persist | Chỉ `payment.update({ txn_ref })` — **không** `order.update`, không emit |

**Return:**

```js
{
  statusCode: 200,
  body: { redirect, order_id, txn_ref, expires_at }  // expires_at = now + 15 phút ISO
}
```

---

## Domain Service — `orderPricing.js`

| Hàm | Mô tả |
|-----|--------|
| `buildOrderPricing(lines, options)` | Tổng hợp giá + stock |
| `computeLineBreakdown(line, options)` | Một dòng breakdown |

`stockMode: 'strict'` → throw 400 hết hàng (create).  
`stockMode: 'warn'` → `stock_warnings` (preview).

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

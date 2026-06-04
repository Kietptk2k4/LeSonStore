# Before / After — Bước 1 Repository

So sánh `orderController.js` trước và sau khi tách Repository. Hành vi HTTP **không đổi**.

---

## createOrder — Reserve stock

### Trước (inline trong controller)

```javascript
const v = await ProductVariation.findOne({
  where: { variation_id: it.variation_id },
  transaction: t,
  lock: t.LOCK.UPDATE,
  skipLocked: true,
});
if (!v) {
  await t.rollback();
  return res.status(400).json({
    message: `Variation ${it.variation_id} not found during reserve`,
  });
}
if (Number(v.stock_quantity || 0) < it.quantity) {
  await t.rollback();
  return res.status(400).json({
    message: `Out of stock during reserve for ${it.variation_id}`,
  });
}
await v.decrement("stock_quantity", { by: it.quantity, transaction: t });
```

### Sau (gọi repository)

```javascript
const reserveResult = await orderRepository.reserveVariationStock(
  it.variation_id,
  it.quantity,
  t
);
if (!reserveResult.ok) {
  await t.rollback();
  return res
    .status(reserveResult.status)
    .json({ message: reserveResult.message });
}
```

**Giữ nguyên:** message lỗi, status 400, rollback trước response.

---

## createOrder — Payment record

### Trước

```javascript
await Payment.create(
  {
    order_id: order.order_id,
    provider: payment_provider,
    payment_method,
    payment_status: "pending",
    amount: finalAmount,
    txn_ref: txnRef,
  },
  { transaction: t }
);
```

### Sau

```javascript
await orderRepository.createPaymentRecord(
  {
    order_id: order.order_id,
    provider: payment_provider,
    payment_method,
    payment_status: "pending",
    amount: finalAmount,
    txn_ref: txnRef,
  },
  t
);
```

**Giữ nguyên:** payload `Payment.create`; test vẫn mock `Payment.create` (gọi qua repository).

---

## cancelOrder — Load order bundle

### Trước (~25 dòng)

```javascript
const order = await Order.findOne({
  where: { order_id, user_id: req.user.user_id },
  transaction: t,
  lock: t.LOCK.UPDATE,
  skipLocked: true,
});
if (!order) { /* 404 */ }

const payment = await Payment.findOne({ where: { order_id: order.order_id }, transaction: t });
const items = await OrderItem.findAll({ where: { order_id: order.order_id }, transaction: t });
```

### Sau

```javascript
const orderBundle = await orderRepository.findOrderWithItemsAndPayment(order_id, {
  userId: req.user.user_id,
  transaction: t,
  lockOrder: true,
});
if (!orderBundle) { /* 404 — message giữ nguyên */ }
const { order, payment, items } = orderBundle;
```

**Giữ nguyên:** 404 `{ message: "Order not found" }`, lock strategy trên bảng `orders` only.

---

## cancelOrder — Release stock

### Trước

```javascript
for (const it of items) {
  const v = await ProductVariation.findOne({
    where: { variation_id: it.variation_id },
    transaction: t,
    lock: t.LOCK.UPDATE,
    skipLocked: true,
  });
  if (!v) continue;
  await v.increment("stock_quantity", { by: it.quantity, transaction: t });
}
```

### Sau

```javascript
for (const it of items) {
  await orderRepository.releaseVariationStock(it.variation_id, it.quantity, t);
}
```

**Giữ nguyên:** skip khi variation không tìm thấy; increment cùng tham số transaction.

---

## Không thay đổi trong bước 1

| Phần controller | Lý do |
|-----------------|-------|
| Validate payment_provider / method | Orchestration — Facade (Bước 3) |
| Chuẩn bị `itemsForOrder` từ cart/body | Orchestration |
| Tính tiền, `quoteShipping`, `Order.create` | Orchestration |
| VNPAY redirect, notification, email | Side-effect |
| Logic hủy đơn (isAwaitingVnpay, …) | State rules — State Machine bước sau |
| `OrderItem.create` trong createOrder | Chưa tách repository (chỉ 4 hàm theo yêu cầu) |

---

## Số dòng

`createOrder` **không** rút còn ~15 dòng (theo yêu cầu). Chỉ thay ~40 dòng DB inline bằng gọi repository; phần orchestration giữ nguyên (~400 dòng).

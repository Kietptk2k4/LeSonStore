# Before / After — Observer hoàn thiện

## vnpayReturn (success, updated)

**Trước**

```
vnpayReturn
  → applySuccessfulReturn
  → notificationService.createNotification (user)
  → User.findAll staff → createNotification (payment_received)
  → redirect FE
```

**Sau**

```
vnpayReturn
  → applySuccessfulReturn
  → emitOrderEvent("payment.completed", { order, payment })
  → redirect FE

orderPaymentCompletedListener
  → notificationService (user + staff)
```

## refundOrder

**Trước:** `payment.update` + inline `sendOrderUpdateEmail` ORDER_REFUND  

**Sau:** `payment.update` + `emitOrderEvent("order.refunded")` → `orderEmailListener`

## updateShippingAddress

**Trước:** `commit` + inline email SHIPPING_ADDRESS (dùng `_previousDataValues`)  

**Sau:** snapshot `oldData` trước `order.update` → `commit` → `emit order.shipping_address.changed`

## Cấu trúc listener

**Trước Bước 5:** file riêng `orderPaymentMethodChangedListener`, `orderStatusChangedListener` + email trong `orderCreatedListener`

**Sau:** `orderEmailListener` (gom email) + `orderCreatedListener` (chỉ notification) + `orderPaymentCompletedListener`

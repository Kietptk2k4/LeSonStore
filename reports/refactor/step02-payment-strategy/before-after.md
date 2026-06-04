# Before / After — Bước 2 Payment Strategy

---

## createOrder — validate + status + redirect

### Trước

```javascript
const VALID = {
  COD: ["COD"],
  VNPAY: ["VNPAYQR", "VNBANK", "INTCARD", "INSTALLMENT"],
};
if (!payment_provider || !VALID[payment_provider]) { /* 400 */ }
if (!payment_method || !VALID[payment_provider].includes(payment_method)) { /* 400 */ }

const isVnpay = payment_provider === "VNPAY";
const holdMs = isVnpay ? 24 * 60 * 60 * 1000 : 0;
// Order.create status: isVnpay ? "AWAITING_PAYMENT" : "processing"
// txnRef = isVnpay ? `${order.order_id}-${Date.now()}` : null
// if (isVnpay) { getPaymentUrl(...); redirect = ... }
```

### Sau

```javascript
strategy = getStrategy(payment_provider);
strategy.validateMethod(payment_method, "createOrder");

const holdMs = strategy.getReserveHoldMs();
// Order.create status: strategy.getInitialOrderStatus()
txnRef = strategy.buildTxnRef(order.order_id);

await orderRepository.createPaymentRecord(
  strategy.buildPaymentRecord({ order_id, payment_method, amount: finalAmount, txnRef }),
  t
);

const { redirect } = await strategy.afterOrderCreated({ order, payment_method, amount: finalAmount, txnRef, req });
```

**Giữ nguyên:** message lỗi (map `Unsupported provider` → `Unsupported payment_provider` cho createOrder), 502 VNPAY config.

---

## changePaymentMethod — nhánh COD / VNPAY

### Trước

```javascript
if (provider === "COD") {
  await payment.update({ provider: "COD", payment_method: "COD", ... }, { transaction: t });
  await order.update({ status: "processing" }, { transaction: t });
} else {
  const newTxnRef = `${order.order_id}-${Date.now()}`;
  await payment.update({ provider: "VNPAY", payment_method: method, txn_ref: newTxnRef, ... });
  await order.update({ status: "AWAITING_PAYMENT" }, { transaction: t });
  redirect = await getPaymentUrl({ ... });
}
```

### Sau

```javascript
strategy = getStrategy(provider);
strategy.validateMethod(method, "changePayment");

const { redirect } = await strategy.applyChangePayment({
  order, payment, method, req, transaction: t,
});
```

**Giữ nguyên:** email `sendOrderUpdateEmail`, response JSON `{ message, order, payment, redirect }`.

---

## vnpayReturn — cập nhật DB khi success

### Trước (inline ~58–66)

```javascript
payment.payment_status = "completed";
payment.txn_ref = txnRef;
payment.transaction_id = vnp_Params["vnp_TransactionNo"] || null;
payment.paid_at = new Date();
await payment.save();
order.status = "processing";
await order.save();
```

### Sau

```javascript
const { updated } = await vnpayStrategy.applySuccessfulReturn({ order, payment, txnRef, vnp_Params });
if (updated) { /* notificationService — không đổi */ }
```

Verify: `vnpayGateway.verifyCallback` thay `verifyReturnUrl` trực tiếp.

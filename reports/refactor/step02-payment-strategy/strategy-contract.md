# Payment Strategy — Hợp đồng (contract)

Mỗi strategy là **object JS** export từ `codStrategy.js` hoặc `vnpayStrategy.js`. Registry: `getStrategy(provider)` trong `paymentStrategy.js`.

---

## Registry

### `getStrategy(provider)`

| Input | `"COD"` \| `"VNPAY"` |
| Output | Strategy object |
| Lỗi | `Error` với `.status = 400`, message `Unsupported provider: ${provider}` |

---

## Thuộc tính

| Field | COD | VNPAY |
|-------|-----|-------|
| `provider` | `"COD"` | `"VNPAY"` |
| `allowedMethods` | `["COD"]` | `["VNPAYQR","VNBANK","INTCARD","INSTALLMENT"]` |

Nguồn: `paymentConstants.js` — **một lần**, không duplicate `VALID` trong controller.

---

## Phương thức

### `validateMethod(method, context?)`

- `context`: `"createOrder"` (default) \| `"changePayment"`
- Throw `Error` `.status = 400`:
  - createOrder: `Invalid payment_method for provider ${provider}`
  - changePayment: `Invalid method for provider ${provider}`

### `getInitialOrderStatus()`

| COD | `"processing"` |
| VNPAY | `"AWAITING_PAYMENT"` |

### `getReserveHoldMs()`

| COD | `0` |
| VNPAY | `86400000` (24h) |

### `buildTxnRef(orderId)`

| COD | `null` |
| VNPAY | `` `${orderId}-${Date.now()}` `` |

### `buildPaymentRecord({ order_id, payment_method, amount, txnRef })`

Object cho `orderRepository.createPaymentRecord`:

```js
{ order_id, provider, payment_method, payment_status: "pending", amount, txn_ref: txnRef }
```

### `afterOrderCreated({ order, payment_method, amount, txnRef, req })`

| COD | `{ redirect: null }` |
| VNPAY | Kiểm ENV `VNP_*`, gọi `vnpayGateway.createPaymentUrl` → `{ redirect }` |

Lỗi config: throw `Error` (controller map → 502 `VNPAY configuration error`).

### `applyChangePayment({ order, payment, method, req, transaction })`

Logic copy từ `changePaymentMethod` nhánh COD/VNPAY. Return `{ redirect }` (`null` cho COD).

### `buildRetryPaymentUrl({ order, payment, method, req })`

| VNPAY | URL redirect (không kiểm ENV — giữ hành vi `retryVnpayPayment` cũ) |
| COD | throw 400 nếu gọi nhầm |

### `applyRetryPayment({ order, payment, method, req, transaction })` (VNPAY only)

| Bước | Hành vi |
|------|---------|
| 1 | `validateMethod(method, "createOrder")` |
| 2 | `buildTxnRef` + `payment.update({ txn_ref })` |
| 3 | `buildRetryPaymentUrl` → `{ redirect, txn_ref }` |

Gọi từ `orderFacade.retryVnpayPayment` (C2). **Không** đổi `order.status`, **không** emit event.

### `applySuccessfulReturn({ order, payment, txnRef, vnp_Params })`

Chỉ VNPAY (COD no-op `{ updated: false }`). Cập nhật:

- `payment`: `completed`, `txn_ref`, `transaction_id`, `paid_at`
- `order.status`: `"processing"`
- Return `{ updated: true \| false }` (false nếu đã `completed` — idempotent)

---

## Gateway

### `vnpayGateway.js`

| Hàm | Ủy quyền |
|-----|----------|
| `createPaymentUrl(params)` | `vnpayService.getPaymentUrl` |
| `verifyCallback(query)` | `vnpayService.verifyReturnUrl` |

Strategy VNPAY **không** import `crypto` trực tiếp.

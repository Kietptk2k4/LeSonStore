# Adapter contract — PaymentGateway

Interface logic mà mọi cổng thanh toán HTTP (VNPay, MoMo, …) nên implement. Định nghĩa JSDoc tại `server/services/gateways/paymentGatewayContract.js`.

---

## `PaymentGateway`

### `createPaymentUrl(params)`

```javascript
/**
 * @param {object} params
 * @param {string} [params.method]     - VNPAYQR | VNBANK | INTCARD | INSTALLMENT (tùy cổng)
 * @param {number} params.amount       - Số tiền VND (chưa nhân 100)
 * @param {string} params.txnRef       - Mã giao dịch unique
 * @param {string} params.orderDesc    - Mô tả đơn
 * @param {string} params.ipAddr       - IP khách
 * @returns {Promise<string>}          - URL redirect sang cổng
 */
```

### `verifyCallback(query)`

```javascript
/**
 * @param {object} query - Query string callback (req.query)
 * @returns {{ isSuccess: boolean, vnp_Params: object }}
 *   isSuccess: chữ ký hợp lệ VÀ response code thành công (VNPay: "00")
 *   vnp_Params: params đã chuẩn hóa (tên field giữ theo VNPay cho tương thích test)
 */
```

---

## Mapping — `vnpayGateway` → `vnpayService`

| Gateway (Adapter) | Adaptee (`vnpayService`) | Ghi chú |
|-------------------|--------------------------|---------|
| `createPaymentUrl(params)` | `getPaymentUrl(params)` | Cùng shape params |
| `verifyCallback(query)` | `verifyReturnUrl(query)` | Đổi tên cho domain “callback” |

Implementation hiện tại (`vnpayGateway.js`):

```javascript
const createPaymentUrl = (params) => vnpay.getPaymentUrl(params);
const verifyCallback = (query) => vnpay.verifyReturnUrl(query);
```

---

## Client sử dụng gateway

| Client | Cách dùng |
|--------|-----------|
| `vnpayStrategy.js` | `vnpayGateway.createPaymentUrl` trong `buildPaymentRedirect`, `afterOrderCreated`, `applyChangePayment`, `buildRetryPaymentUrl` |
| `vnpayController.js` | `createPayment` → `createPaymentUrl`; `vnpayReturn` → `verifyCallback` |

Strategy **không** `require("../vnpayService")`.

---

## Mở rộng MoMo (tương lai)

Tạo `server/services/gateways/momoGateway.js`:

```javascript
// Ví dụ — chưa implement
const momo = require("../momoService");
module.exports = {
  createPaymentUrl: (params) => momo.createPayUrl(params),
  verifyCallback: (query) => momo.verifyIpn(query),
};
```

`momoStrategy.js` import `momoGateway` giống `vnpayStrategy` — **không** sửa `orderFacade` hay registry Strategy ngoài thêm provider.

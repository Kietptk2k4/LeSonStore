# Before / After — Bước 6 Adapter VNPay

*Bước 6 formalize pattern đã triển khai trong Bước 2; phần “Trước” mô tả trạng thái trước khi có gateway.*

---

## Tạo URL thanh toán

### Trước (trước Bước 2)

```javascript
// orderController / vnpayStrategy — import trực tiếp
const { getPaymentUrl } = require("../services/vnpayService");

const redirect = await getPaymentUrl({
  method: payment_method,
  amount: finalAmount,
  txnRef,
  orderDesc: `Thanh toan don hang ${order.order_code}`,
  ipAddr: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
});
```

Client biết tên hàm VNPay (`getPaymentUrl`) và phụ thuộc module chứa HMAC.

### Sau (Bước 2 + formalize Bước 6)

```javascript
// vnpayStrategy.js
const vnpayGateway = require("../gateways/vnpayGateway");

const redirect = await vnpayGateway.createPaymentUrl({
  method, amount, txnRef, orderDesc, ipAddr,
});
```

```javascript
// vnpayGateway.js — Adapter
const vnpay = require("../vnpayService");
const createPaymentUrl = (params) => vnpay.getPaymentUrl(params);
```

---

## Verify callback return URL

### Trước

```javascript
// vnpayController.js
const { verifyReturnUrl } = require("../services/vnpayService");
const { isSuccess, vnp_Params } = verifyReturnUrl({ ...req.query });
```

### Sau

```javascript
// vnpayController.js
const vnpayGateway = require("../services/gateways/vnpayGateway");
const { isSuccess, vnp_Params } = vnpayGateway.verifyCallback({ ...req.query });
```

---

## Chuỗi phụ thuộc

| Trước | Sau |
|-------|-----|
| `Controller/Strategy` → `vnpayService` (crypto) | `Controller` → `Strategy` → `vnpayGateway` → `vnpayService` |

HMAC, `sortObject`, `VNPAY_SECRET_KEY` **chỉ** trong `vnpayService.js` — không đổi.

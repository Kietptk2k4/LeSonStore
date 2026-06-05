# Before / After — Bước 3 Order Facade

---

## createOrder — controller

### Trước (~380 dòng)

Controller chứa toàn bộ: validate, cart, pricing, transaction, repository, strategy, commit, notification staff, `sendOrderConfirmationEmail`, `res.status(201).json(...)`.

### Sau (~15 dòng)

```javascript
exports.createOrder = async (req, res, next) => {
  if (!req.user || !req.user.user_id) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const result = await orderFacade.createFromCart({
      userId: req.user.user_id,
      user: req.user,
      body: req.body,
      req,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return handleFacadeError(error, res, next);
  }
};
```

Orchestration + emit → `orderFacade.createFromCart`. Email/notification → `orderCreatedListener`.

---

## cancelOrder / changePaymentMethod

Tương tự: facade trả `{ statusCode, body }`; controller map lỗi `.status` → HTTP.

Side-effect email đổi PT → listener `order.payment_method.changed` (oldData lưu **trước** `applyChangePayment`).

---

## Kiến trúc sau Bước 3

```
HTTP Request
  → orderController (thin)
  → orderFacade (orchestration)
      → paymentStrategy
      → orderRepository
      → Sequelize models
  → emitOrderEvent
  → listeners (async side-effects)
```

GET handlers (`getUserOrdersV2`, …) **không** đi qua facade — controller vẫn dài, ghi rõ trong README.

# orderRepository — API Reference

**Module:** `server/services/order/orderRepository.js`  
**Pattern:** Repository (GoF — abstraction over data access)

---

## Tổng quan

Repository đóng gói các truy vấn Sequelize lặp lại trong `createOrder` và `cancelOrder`. Controller giữ orchestration (validate, tính tiền, email, response); repository chỉ thao tác DB trong transaction.

---

## `reserveVariationStock(variationId, quantity, transaction)`

**Nguồn:** logic reserve kho trong `createOrder` (bước 4).

Khóa row `product_variations` (`LOCK.UPDATE`, `skipLocked`), kiểm tra `stock_quantity`, gọi `decrement`.

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `variationId` | number | PK variation |
| `quantity` | number | Số lượng cần trừ |
| `transaction` | Sequelize Transaction | Transaction hiện tại |

**Trả về:**

```javascript
// Thành công
{ ok: true, variation: ProductVariation }

// Lỗi nghiệp vụ (controller map → 400)
{ ok: false, status: 400, message: "Variation X not found during reserve" }
{ ok: false, status: 400, message: "Out of stock during reserve for X" }
```

**Controller:** rollback + `res.status(result.status).json({ message })` khi `!ok`.

---

## `createPaymentRecord(data, transaction)`

**Nguồn:** `Payment.create(...)` trong `createOrder` (bước 5).

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `data` | object | `{ order_id, provider, payment_method, payment_status, amount, txn_ref }` |
| `transaction` | Sequelize Transaction | Transaction hiện tại |

**Trả về:** instance `Payment` (Sequelize model).

---

## `findOrderWithItemsAndPayment(orderId, options)`

**Nguồn:** truy vấn order + payment + items trong `cancelOrder`.

| Option | Kiểu | Mặc định | Mô tả |
|--------|------|----------|-------|
| `userId` | number | — | Lọc `user_id` (chủ đơn) |
| `transaction` | Transaction | — | Transaction hiện tại |
| `lockOrder` | boolean | `false` | `true` → `Order.findOne` với `lock: UPDATE`, `skipLocked` |

**Trả về:**

```javascript
// Tìm thấy
{ order, payment, items }

// Không tìm thấy order
null
```

**Ghi chú:** Payment và OrderItem được load bằng truy vấn riêng (không include lock) — giữ nguyên thiết kế gốc tránh lock outer join.

---

## `releaseVariationStock(variationId, quantity, transaction)`

**Nguồn:** hoàn kho trong `cancelOrder`.

Khóa variation, `increment("stock_quantity", { by: quantity })`. Nếu variation không tồn tại → `return null` (bỏ qua, giống `continue` cũ).

**Trả về:** instance `ProductVariation` hoặc `null`.

---

## Export

```javascript
module.exports = {
  reserveVariationStock,
  createPaymentRecord,
  findOrderWithItemsAndPayment,
  releaseVariationStock,
};
```

## Mở rộng (bước sau)

- Bước 2–3 có thể thêm `createOrderRecord`, `createOrderItems` vào repository.
- **Facade (Bước 3)** sẽ gọi repository + services; repository **không** gọi Facade.

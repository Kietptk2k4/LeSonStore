# Bước 9 — Refund Service (D1)

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành — `adminRefundOrder.test.js`

---

## Mục đích

Tách logic admin hoàn tiền VNPAY thủ công khỏi `adminController` sang **Application Service** `refundService.js`. Email qua **Observer** (`order.refunded` → `orderEmailListener`).

## File

| File | Vai trò |
|------|---------|
| `server/services/order/refundService.js` | `processAdminRefund` — validate, `payment.update`, emit |
| `server/controllers/adminController.js` | Thin handler |
| `server/events/listeners/orderEmailListener.js` | *(không đổi)* ORDER_REFUND email |

## Luồng

```
POST /api/admin/orders/:id/refund
  → adminController.refundOrder
  → refundService.processAdminRefund
  → payment.update({ payment_status: 'refunded' })
  → emitOrderEvent('order.refunded')
  → orderEmailListener → sendOrderUpdateEmail
```

## Không làm

- VNPay refund API (BR-01)
- Đổi `order.status`
- State machine
- Facade

## Kiểm tra

```bash
cd server
npm test -- __tests__/admin/adminRefundOrder.test.js
```

## Liên quan

- [Bước 5 — Observer](../step05-observer/README.md)
- [FR_AdminRefundOrder](../../../docs/feature_requirements/admin/order/FR_AdminRefundOrder.md)

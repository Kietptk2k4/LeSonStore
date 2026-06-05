# Bước 8 — Order Query Service (CQRS-lite)

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành — tests list + detail (`viewUserOrders`, `viewOrderDetail`, `viewOrderDetailSlim`, `orderPaymentCountdownBe`)

---

## Mục đích

Tách **read** (danh sách đơn) khỏi **write** (`orderFacade`). Module `orderQueryService.js` — Query Service + DTO mapper, không transaction, không Observer.

## CQRS-lite

| Loại | Module | Ví dụ |
|------|--------|--------|
| **Command** | `orderFacade.js` | create, cancel, change payment, preview, retry, update shipping |
| **Query** | `orderQueryService.js` | `listUserOrdersV2`, `listUserOrders` |

**Không** đưa list API vào Facade.

## File

| File | Vai trò |
|------|---------|
| `server/services/order/orderQueryService.js` | `parseListQuery`, `mapOrderListRow`, `listUserOrdersV2`, `listUserOrders` |
| `server/controllers/orderController.js` | Thin handlers → `req.userId` |

## API

### List (C4)

- Production: `GET /api/orders` → `getUserOrdersV2` → `listUserOrdersV2`
- Legacy: `getUserOrders` → `listUserOrders` (export giữ, không mount route)

### Detail (C5)

| Method | Route | Trả về |
|--------|-------|--------|
| `getOrderDetailById` | `GET /api/orders/:order_id` | Entity Sequelize raw (`{ order }`) |
| `getOrderDetailSlim` | `GET /api/orders/:order_id/slim` | DTO `mapOrderDetailSlim` — không `reserve_expires_at`, không `note` |

Helper: `buildOrderDetailIncludes({ sortItems })` — includes items→variation→product + payment.

## Khác biệt V2 vs Legacy

| | V2 | Legacy |
|---|-----|--------|
| Tab to_ship/shipping | `paymentInclude` + `Op.or` | Chỉ `order.status` |
| Search `q` | order_code OR product_name | Chỉ order_code |
| Items | `required: true` | Không required |
| `subQuery` | `false` | (không set) |

## Kiểm tra

```bash
cd server
npm test -- __tests__/orders/viewUserOrders.test.js __tests__/orders/viewOrderDetail.test.js __tests__/orders/viewOrderDetailSlim.test.js __tests__/orders/orderPaymentCountdownBe.test.js
```

## Liên quan

- [Bước 3 — Order Facade](../step03-order-facade/README.md) (commands)

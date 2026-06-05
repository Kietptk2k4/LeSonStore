# Bước 13 — Admin Product + Analytics Services (E4)

**Dự án:** LeSonStore  
**Ngày:** 06/06/2026  
**Trạng thái:** Hoàn thành — admin product tests + full `__tests__/admin/`

---

## Mục đích

Tách CRUD sản phẩm/biến thể và dashboard analytics khỏi `adminController` (~1290 dòng).

| Service | Vai trò |
|---------|---------|
| `adminProductService.js` | create/update/delete product, variations sync (transaction) |
| `analyticsService.js` | `getDashboard`, `getSales` (aggregates + raw SQL) |

Order, user, category, brand, role **giữ** trong `adminController`.

## Pattern

- **Service Layer** + **CQRS-lite** (write vs read analytics)
- **Transaction Script** — `sequelize.transaction()` trong product service
- Upload middleware vẫn trên controller: `[uploadProductFiles, handler]`

## Kiểm tra

```bash
cd server
npm test -- __tests__/admin/adminCreateProductWithImages.test.js
npm test -- __tests__/admin/adminUpdateProductWithVariations.test.js
npm test -- __tests__/admin/adminDeleteProduct.test.js
npm test -- __tests__/admin/adminCreateVariationEndpoint.test.js
npm test -- __tests__/admin/adminUpdateVariationEndpoint.test.js
npm test -- __tests__/admin/
```

Smoke analytics (admin token):

- `GET /api/admin/analytics/dashboard?period=30`
- `GET /api/admin/analytics/sales?period=30`

# Bước 12 — Product Services (E3)

**Dự án:** LeSonStore  
**Ngày:** 06/06/2026  
**Trạng thái:** Hoàn thành — catalog + qa + recommendations tests

---

## Mục đích

Tách `productController` (~1457 dòng) thành **Service Layer** theo subdomain:

| Service | Vai trò |
|---------|---------|
| `catalogService.js` | Đọc SP, lọc, facets, compare, KNN proxy |
| `qaService.js` | Hỏi đáp sản phẩm + global Q&A |

Controller chỉ map `req` → service → `res`.

## Pattern

- **Service Layer** — business logic
- **Separation of Concerns** — Catalog vs Q&A
- **CQRS-lite** — catalog ≈ query; qa ≈ command + read
- **Proxy** — `recommendationProxy` (không sửa trong E3)

## Không đổi

- `productRoutes.js`, `recommendationProxy.js`, `notificationService.js`

## Kiểm tra

```bash
cd server
npm test -- __tests__/catalog/
npm test -- __tests__/qa/
npm test -- __tests__/recommendations/
```

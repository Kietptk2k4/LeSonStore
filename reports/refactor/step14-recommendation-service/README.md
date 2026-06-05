# Bước 14 — Recommendation Service (E5)

**Dự án:** LeSonStore  
**Ngày:** 06/06/2026  
**Trạng thái:** Hoàn thành — KNN tests pass

---

## Mục đích

Tách orchestration KNN (parse proxy payload → dedupe → DB enrich → map FE) khỏi `catalogService` sang **Application Service** chuyên recommendation.

## Kiến trúc 3 lớp

```
productController.getRecommendedByVariation
  → recommendationService.getByVariation
    → recommendationProxy.getRecommendations
      → Flask GET /recommend?variation_id=
```

| Lớp | Module | Vai trò |
|-----|--------|---------|
| HTTP | `productController` | `res.status(result.statusCode).json(result.body)` |
| Application | `recommendationService.js` | Adapter shapes, dedupe, `fetchProductMeta`, DTO FE |
| Infrastructure | `recommendationProxy.js` | Axios + errors (Bước 7, **không sửa E5**) |

## File

- `server/services/recommendation/recommendationService.js` — `getByVariation` + helpers
- `catalogService.js` — **không** còn import/knowledge recommendation

## Kiểm tra

```bash
cd server
npm test -- __tests__/recommendations/proxyRecommendationsFromBackend.test.js
npm test -- __tests__/catalog/viewKNNRecommendations.test.js
```

## Liên quan

- [Bước 7 — Proxy](../step07-recommendation-proxy/README.md)
- [Bước 12 — Product services](../step12-product-services/README.md)

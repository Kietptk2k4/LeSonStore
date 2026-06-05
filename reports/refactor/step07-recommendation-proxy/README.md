# Bước 7 — Proxy recommendation (ML service)

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành — 23 tests pass (`proxyRecommendationsFromBackend`, `viewKNNRecommendations`)

---

## Mục đích

Tách gọi HTTP sang **Recommendation Service** (Flask/KNN) bằng **Proxy pattern** (`recommendationProxy.js`). Enrich/map FE chuyển sang **`recommendationService`** (E5 — xem [Bước 14](../step14-recommendation-service/README.md)).

## Phân tách trách nhiệm

| Lớp | Việc |
|-----|------|
| **Proxy** (`recommendationProxy.js`) | `GET /recommend?variation_id=`, timeout, `validateStatus`, map lỗi → `RecommendationUpstreamError` / `RecommendationAdapterError` |
| **Application** (`recommendationService.js`) | Parse `items` / `debug` / array, dedupe, `fetchProductMeta`, map FE, sort, `{ statusCode, body }` |
| **Controller** (`getRecommendedByVariation`) | HTTP adapter → `recommendationService.getByVariation` |

## Phụ thuộc

- Không phụ thuộc Bước 1–5 (module catalog độc lập)
- FR nghiệp vụ: [FR_ProxyRecommendationsFromBackend](../../../docs/feature_requirements/recommendations/FR_ProxyRecommendationsFromBackend.md)

## File liên quan

| File | Vai trò |
|------|---------|
| `server/services/recommendationProxy.js` | Proxy — `getRecommendations`, error classes, `BASE`, `TIMEOUT` |
| `server/services/recommendation/recommendationService.js` | Orchestration + DB enrich (E5) |
| `server/controllers/productController.js` | HTTP — `getRecommendedByVariation` |
| `recommendation_service/` (Flask) | Real subject — KNN `/recommend` |

## Biến môi trường

| Biến | Default | Mô tả |
|------|---------|--------|
| `RECO_API_BASE` | `http://127.0.0.1:8000` | Base URL Flask |
| `RECO_TIMEOUT_MS` | `7000` | Timeout axios (ms) |

## API Node (public)

```http
GET /api/products/variations/:variation_id/recommendations
```

## Kiểm tra

```bash
cd server
npm test -- __tests__/recommendations/proxyRecommendationsFromBackend.test.js __tests__/catalog/viewKNNRecommendations.test.js
```

## Tài liệu

- [proxy-api.md](./proxy-api.md)
- [before-after.md](./before-after.md)
- [thesis-notes.md](./thesis-notes.md)
- [diagrams/recommendation-proxy-sequence.puml](./diagrams/recommendation-proxy-sequence.puml)
- [diagrams/recommendation-proxy-class.puml](./diagrams/recommendation-proxy-class.puml)

## Liên quan

- [Bước 2 — Payment Strategy](../step02-payment-strategy/README.md) (cùng phong cách tách service)
- [FR — Proxy Recommendations From Backend](../../../docs/feature_requirements/recommendations/FR_ProxyRecommendationsFromBackend.md)

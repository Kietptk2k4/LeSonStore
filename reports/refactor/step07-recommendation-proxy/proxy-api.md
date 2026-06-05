# Proxy API — `recommendationProxy.js`

---

## `getRecommendations(variationId, options?)`

```javascript
/**
 * @param {number} variationId
 * @param {{ timeout?: number, base?: string }} [options]
 * @returns {Promise<object>} body JSON từ Flask khi HTTP 2xx
 * @throws {RecommendationUpstreamError} status HTTP upstream >= 400
 * @throws {RecommendationAdapterError} lỗi mạng, timeout, axios reject
 */
```

### Request upstream (nội bộ proxy)

```http
GET ${RECO_API_BASE}/recommend?variation_id={variationId}
```

- `timeout`: `options.timeout ?? RECO_TIMEOUT_MS` (default 7000)
- `validateStatus: () => true` — đọc body cả 4xx/5xx

### Return (thành công)

Trả nguyên `resp.data` — thường là:

- `{ items: [...], generated_at?: string }`
- `{ debug: [...] }` (chế độ debug Flask)
- mảng JSON thuần `[{ product_id, variation_id, score, ... }]`

Controller tự chọn shape (không thuộc proxy).

---

## Error classes

### `RecommendationUpstreamError`

| Field | Mô tả |
|-------|--------|
| `upstreamStatus` | HTTP status từ Flask (404, 500, …) |
| `upstream` | `resp.data` |
| `variationId` | ID đã gọi |
| `base` | `RECO_API_BASE` đã dùng |

### `RecommendationAdapterError`

| Field | Mô tả |
|-------|--------|
| `message` | `err.message` (vd. `connect ECONNREFUSED`) |
| `code` | `err.code` (vd. `ECONNREFUSED`, `ECONNABORTED`) |
| `base` | Base URL |
| `variationId` | ID đã gọi |

---

## Map lỗi → HTTP response (controller)

`productController.getRecommendedByVariation` bắt exception và trả **502** (graceful degradation, `products: []`):

| Nguồn | `error` field | Body thêm |
|-------|---------------|-----------|
| `RecommendationUpstreamError` | `upstream_{status}` (vd. `upstream_404`, `upstream_500`) | `upstream: e.upstream` |
| `RecommendationAdapterError` | `adapter_exception` | `detail: { message, code, base }` |

Luôn kèm: `basedOn: { variationId }`, `source: "knn"`.

### Ví dụ 502 upstream 404

```json
{
  "products": [],
  "basedOn": { "variationId": 42 },
  "source": "knn",
  "error": "upstream_404",
  "upstream": { "error": "variation_id not found" }
}
```

### Ví dụ 502 adapter (Flask down)

```json
{
  "products": [],
  "basedOn": { "variationId": 42 },
  "source": "knn",
  "error": "adapter_exception",
  "detail": {
    "message": "connect ECONNREFUSED",
    "code": "ECONNREFUSED",
    "base": "http://127.0.0.1:8000"
  }
}
```

**Lưu ý:** `variation_id` không hợp lệ (0, NaN) → **400** tại controller, **không** gọi proxy.

---

## Export module

```javascript
module.exports = {
  getRecommendations,
  RecommendationUpstreamError,
  RecommendationAdapterError,
  BASE,
  TIMEOUT,
};
```

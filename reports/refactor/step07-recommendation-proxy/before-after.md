# Before / After — Bước 7 Proxy recommendation

---

## Gọi ML service

### Trước

```javascript
// productController.js — axios + env inline
const axios = require("axios");
const BASE = process.env.RECO_API_BASE || "http://127.0.0.1:8000";
const TIMEOUT = +(process.env.RECO_TIMEOUT_MS || 7000);

const resp = await axios.get(`${BASE}/recommend`, {
  params: { variation_id: variationId },
  timeout: TIMEOUT,
  validateStatus: () => true,
});

if (resp.status >= 400) {
  return res.status(502).json({
    products: [],
    error: `upstream_${resp.status}`,
    upstream: resp.data,
    // ...
  });
}
const payload = resp.data;
```

### Sau

```javascript
// productController.js
const payload = await recommendationProxy.getRecommendations(variationId);
// enrich: parse items/debug/array, dedupe, fetchProductMeta, map FE...
```

```javascript
// recommendationProxy.js
const resp = await axios.get(`${base}/recommend`, { params, timeout, validateStatus });
if (resp.status >= 400) throw new RecommendationUpstreamError({ ... });
return resp.data;
```

---

## Xử lý lỗi

### Trước

Một `catch` chung → `502 adapter_exception` với `detail: { message, code, base }`.

### Sau

- Proxy **phân loại** upstream 4xx/5xx vs lỗi mạng
- Controller `instanceof` → JSON 502 giữ **cùng shape** như FR (`upstream_404`, `adapter_exception`)

---

## Trách nhiệm controller (không đổi)

Sau khi có `payload`, controller vẫn:

1. Chuẩn hóa `items` / `debug` / mảng thuần  
2. Dedupe theo `product_id` (score cao nhất)  
3. `fetchProductMeta(productIds)` — PostgreSQL  
4. Map `id`, `name`, `image`, `slug`, `score`, `explain`  
5. Sort score giảm dần → `res.json({ products, basedOn, generated_at, source: "knn" })`

Proxy **không** query DB, **không** biết shape FE.

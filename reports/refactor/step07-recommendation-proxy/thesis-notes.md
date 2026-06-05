# Ghi chú báo cáo — Bước 7 Proxy recommendation

---

## Đoạn copy vào Word (tiếng Việt)

> Trang chi tiết sản phẩm cần gợi ý laptop tương tự từ mô hình **KNN** chạy trên microservice Flask (`/recommend`). Ban đầu, `productController` gọi trực tiếp `axios.get` tới `RECO_API_BASE`, xử lý timeout và lỗi upstream ngay trong handler — khiến controller **gắn chặt URL Flask**, khó đổi host/port khi triển khai Docker, và trộn lẫn logic HTTP với enrich dữ liệu từ PostgreSQL (ảnh, slug, rating).
>
> **Proxy pattern** được áp dụng qua `recommendationProxy.js`: lớp này đại diện cho dịch vụ gợi ý phía sau, che chi tiết axios, timeout (`RECO_TIMEOUT_MS`) và phân loại lỗi (`RecommendationUpstreamError` khi Flask trả ≥400, `RecommendationAdapterError` khi mạng/timeout). Controller chỉ gọi `getRecommendations(variationId)` rồi tập trung **presentation** — parse nhiều shape JSON, dedupe, `fetchProductMeta`, map field cho React.
>
> **Lợi ích:** một điểm cấu hình `RECO_API_BASE`; kiểm thử proxy độc lập; FE vẫn gọi một API Node thống nhất (BFF), không expose Flask ra browser. File: `server/services/recommendationProxy.js`, handler `getRecommendedByVariation` trong `productController.js`.

---

## Vấn đề → Pattern → Lợi ích

| Vấn đề | Pattern | Lợi ích |
|--------|---------|---------|
| Controller biết URL/timeout Flask | **Proxy** (`recommendationProxy`) | Đổi host một chỗ |
| HTTP lỗi + enrich DB cùng file | Tách Proxy / BFF | Dễ đọc, dễ test |
| FE không gọi trực tiếp ML | Node làm BFF | Bảo mật, chuẩn hóa JSON |

---

## File tham chiếu

| File | Vai trò |
|------|---------|
| `recommendationProxy.js` | Proxy — HTTP + errors |
| `productController.js` | BFF — enrich + response |
| `FR_ProxyRecommendationsFromBackend.md` | Yêu cầu chức năng |

---

## Diagram

- [recommendation-proxy-sequence.puml](./diagrams/recommendation-proxy-sequence.puml)
- [recommendation-proxy-class.puml](./diagrams/recommendation-proxy-class.puml)

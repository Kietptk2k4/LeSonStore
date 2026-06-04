# Bước 1 — Repository Pattern (Orders)

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Phạm vi:** Tách truy cập dữ liệu đơn hàng ra `orderRepository.js`; refactor `createOrder` và `cancelOrder`.

---

## Mục tiêu

Áp dụng **Repository pattern** cho các thao tác DB lặp lại / dễ test trong luồng đặt hàng và hủy đơn, **không** thay đổi hành vi API (HTTP status, message JSON, transaction).

## File thay đổi

| File | Thay đổi |
|------|----------|
| `server/services/order/orderRepository.js` | **Mới** — 4 hàm truy cập DB |
| `server/controllers/orderController.js` | `createOrder`, `cancelOrder` gọi repository |

## Không nằm trong bước này

| Pattern / module | Bước dự kiến |
|------------------|--------------|
| **Facade** (`orderFacade`) | **Bước 3** |
| Payment Strategy | Bước sau |
| Order State Machine | Bước sau |
| Event Bus / Observer | Chưa lên kế hoạch |

## Tài liệu trong thư mục

| File | Nội dung |
|------|----------|
| [repository-api.md](./repository-api.md) | API từng hàm repository |
| [before-after.md](./before-after.md) | So sánh controller trước/sau |
| [thesis-notes.md](./thesis-notes.md) | Ghi chú cho báo cáo đồ án |
| [diagrams/repository-class.puml](./diagrams/repository-class.puml) | Class diagram PlantUML (export PNG cho Word) |

## Kiểm tra

```bash
cd server
npm test -- __tests__/orders/createOrder.test.js __tests__/orders/cancelOrder.test.js
```

Kết quả mong đợi: **30 tests passed** (không đổi test file).

## Liên quan

- [Pattern hiện hữu (Bước 0)](../../already_done/design-patterns-step0.md)
- [System Architecture](../../../docs/architecture/system-architecture.md)

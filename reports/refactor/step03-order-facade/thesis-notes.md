# Ghi chú báo cáo — Bước 3 Facade

---

## Đoạn copy vào Word

> **Facade Pattern** che lớp orchestration phức tạp của module Orders. Sau Bước 1 (Repository) và Bước 2 (Payment Strategy), Bước 3 gom luồng `createOrder`, `cancelOrder`, `changePaymentMethod` vào `orderFacade.js`. Controller HTTP chỉ parse request, gọi facade và trả JSON — không còn hàng trăm dòng transaction trong controller cho ba use case này.
>
> Facade **kết hợp** Strategy (`getStrategy`, `afterOrderCreated`, `applyChangePayment`) và Repository (`reserveVariationStock`, `createPaymentRecord`, …). Side-effect gửi email và thông báo staff tách khỏi facade qua **Observer** đơn giản: `orderEventBus` (EventEmitter) + listeners (`order.created`, `order.payment_method.changed`) — tương đương pattern Observer, không cần Event Bus phức tạp.
>
> Các API GET/list (`getUserOrdersV2`, `previewOrder`, `retryVnpayPayment`) **chưa** đưa vào facade — controller vẫn dài nhưng phạm vi Facade rõ ràng cho báo cáo.

---

## So sánh 3 bước refactor

| Bước | Pattern | Trách nhiệm |
|------|---------|-------------|
| 1 | Repository | Truy cập DB (stock, payment, bundle) |
| 2 | Strategy | COD vs VNPAY |
| 3 | Facade + Observer | Orchestration + side-effect tách listener |

---

## Diagram

- [facade-class.puml](./diagrams/facade-class.puml)
- [facade-create-order-sequence.puml](./diagrams/facade-create-order-sequence.puml)

Export PNG: PlantUML extension / plantuml.com

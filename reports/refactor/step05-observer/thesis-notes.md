# Ghi chú luận văn — Observer Pattern (Bước 5)

## Pattern

**Observer** qua Node.js `EventEmitter`: subject là `orderEventBus`, observers là các file trong `server/events/listeners/`. Controller và Facade đóng vai **publisher** — chỉ phát sự kiện, không biết ai xử lý email hay push notification.

## Nguyên tắc thiết kế

1. **Emit sau commit** — tránh gửi email khi transaction rollback (đặc biệt cancel, đổi địa chỉ, đổi PT thanh toán).
2. **Tách email và notification** — `order.created`: staff notification (`orderCreatedListener`) tách khỏi email xác nhận (`orderEmailListener`); VNPAY: `payment.completed` chỉ notification.
3. **Một listener một trách nhiệm email** — gom `orderEmailListener` để tránh subscribe trùng khi thêm event mới.
4. **Fail-safe** — listener bắt lỗi, log, không làm fail HTTP response.

## Lợi ích so với code cũ

- Controller mỏng, dễ đọc luồng nghiệp vụ.
- Thêm kênh side-effect (SMS, webhook) chỉ cần `bus.on` mới, không sửa controller.
- Unit test mock `emailService` / `notificationService`; sau supertest dùng `setImmediate` cho assert async listener.

## Phạm vi chưa observer hóa

- `order.cancelled` — emit có, chưa listener email (nếu cần bổ sung sau).
- Catalog / QA notification trong `productController` — ngoài phạm vi đơn hàng.

## Sơ đồ

[diagrams/observer-sequence.puml](./diagrams/observer-sequence.puml)

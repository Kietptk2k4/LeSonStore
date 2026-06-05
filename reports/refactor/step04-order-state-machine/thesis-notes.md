# Ghi chú luận văn — State Machine đơn hàng

## Pattern

**State** (máy trạng thái hữu hạn): `orderStateMachine.js` định nghĩa tập trạng thái hợp lệ và cạnh chuyển; mọi mutation `order.status` đi qua một module.

Kết hợp **Observer** (Bước 3): `order.status.changed` tách side-effect email khỏi luồng nghiệp vụ chính.

## Cải tiến so với hệ thống cũ

1. **Admin không đổi status tùy ý** — ví dụ không nhảy `processing` → `delivered`; buộc quy trình ship rồi deliver, giảm sai sót vận hành.
2. **Một nguồn sự thật** cho rule transition — dễ mở rộng (thêm `returned`, `refunded`) và test unit `assertTransition`.
3. **Đồng nhất** cancel (facade), VNPAY (strategy), admin (controller) trên cùng FSM.
4. **Emit sau commit** — tránh email/notification khi transaction rollback.

## So sánh BR-01

| Tiêu chí | BR-01 (no FSM) | Bước 4 (FSM) |
|----------|----------------|--------------|
| Admin PUT status | Bất kỳ giá trị | Chỉ cạnh trong `ALLOWED` |
| processing → delivered | Cho phép | **Cấm** (400) |
| Email | Controller | Listener |

Ghi rõ trong báo cáo: đây là **thay đổi có chủ đích** (chất lượng quy trình), không phải regression test cũ.

## Hạn chế / hướng mở rộng

- Chưa FSM cho `payment.status`.
- `retryVnpayPayment` / đổi PT thanh toán vẫn ngoài FSM order (Bước 2–3).
- Trạng thái `FAILED` order (nếu có trong DB) chỉ có cạnh retry → `AWAITING_PAYMENT`.

## Sơ đồ

Xem [diagrams/order-state-machine.puml](./diagrams/order-state-machine.puml).

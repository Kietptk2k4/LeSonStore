# Bảng transition — `ALLOWED`

Nguồn: `server/services/order/orderStateMachine.js`

| Trạng thái hiện tại (`from`) | Trạng thái được phép (`to`) |
|------------------------------|-----------------------------|
| `AWAITING_PAYMENT` | `cancelled`, `processing` |
| `processing` | `shipping`, `cancelled` |
| `shipping` | `delivered` |
| `delivered` | *(không)* |
| `cancelled` | *(không)* |
| `FAILED` | `AWAITING_PAYMENT` |

## API / luồng gọi

| Transition | Nguồn | `context.source` (emit) |
|------------|--------|-------------------------|
| → `cancelled` | Khách hủy | `customer_cancel` |
| → `processing` | VNPAY return thành công | `vnpay_return` |
| → `*` (admin PUT status) | `updateOrderStatus` | `admin_updateOrderStatus` |
| → `shipping` | `shipOrder` hoặc admin PUT | `admin_ship` / admin PUT |
| → `delivered` | `deliverOrder` hoặc admin PUT (từ `shipping`) | `admin_deliver` / admin PUT |

## Lỗi

`assertTransition(from, to)` ném `Error` với:

- `message`: `Invalid transition: ${from} → ${to}`
- `status`: `400`

`shipOrder` / `deliverOrder` giữ message legacy khi trạng thái không đúng bước (ví dụ ship khi không phải `processing`).

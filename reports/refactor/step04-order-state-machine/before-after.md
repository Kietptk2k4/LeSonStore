# Before / After — Order State Machine

## Trước (rải rác)

```
adminController.updateOrderStatus
  → order.update({ status })  // bất kỳ status (BR-01)
  → sendOrderUpdateEmail(...)   // inline

adminController.shipOrder / deliverOrder
  → if (status !== ...) return 400
  → order.update({ status })
  → sendOrderUpdateEmail(...)

orderFacade.cancelOrder
  → order.update({ status: "cancelled", note })

vnpayStrategy.applySuccessfulReturn
  → order.status = "processing"; order.save()
```

## Sau (FSM + event)

```
* Mọi đổi status
  → assertTransition / applyTransition(order, to, { transaction?, extraOrderFields? })
  → emitStatusChanged(...)   // sau commit, không trong transaction

orderStatusChangedListener
  → sendOrderUpdateEmail(ORDER_STATUS)
```

## Hành vi API

| Endpoint | JSON response | Khác |
|----------|---------------|------|
| `PUT /api/admin/orders/:id/status` | Giữ `{ message, order }` | Transition cấm → **400** + message FSM |
| `POST .../ship`, `POST .../deliver` | Giữ như cũ | Email qua listener (async) |
| `POST cancel order` | Giữ như cũ | |
| VNPAY return redirect | Giữ như cũ | Order dùng `update` thay `save` |

## Test

- `processing → delivered` qua admin PUT: **400** (trước: 200 BR-01)
- Email assertions: `await setImmediate` sau request (listener async)
- `vnpayReturn`: mock order có `update`

const request = require("supertest")
const express = require("express")
const jwt = require("jsonwebtoken")

jest.mock("../../services/emailService", () => ({
  sendOrderUpdateEmail: jest.fn().mockResolvedValue(undefined),
}))

jest.mock("../../events/orderEventBus", () => {
  const { EventEmitter } = require("events")
  const bus = new EventEmitter()
  return {
    bus,
    emitOrderEvent: jest.fn((eventName, payload) => bus.emit(eventName, payload)),
  }
})

jest.mock("../../models", () => ({
  User: { findByPk: jest.fn() },
  Role: {},
  Order: { findByPk: jest.fn() },
  Payment: {},
}))

const { emitOrderEvent } = require("../../events/orderEventBus")
const { User, Order } = require("../../models")
const adminRoutes = require("../../routes/adminRoutes")
const errorHandler = require("../../middleware/errorHandler")

const app = express()
app.use(express.json())
app.use("/api/admin", adminRoutes)
app.use(errorHandler)

const ORDER_ID = 42
const BUYER_USER_ID = 99
const refundUrl = (id = ORDER_ID) => `/api/admin/orders/${id}/refund`

const ADMIN_USER_ID = 1

const signSessionToken = (userId = ADMIN_USER_ID) =>
  jwt.sign({ userId }, process.env.JWT_SECRET || "test-jwt-secret-for-unit-tests", {
    expiresIn: "7d",
  })

const userRecord = (overrides = {}) => ({
  user_id: ADMIN_USER_ID,
  username: "admin",
  full_name: "Quản trị viên",
  email: "admin@example.com",
  is_active: true,
  Roles: [{ role_name: "admin" }],
  ...overrides,
})

const buildPayment = (overrides = {}) => ({
  provider: "VNPAY",
  payment_status: "pending",
  update: jest.fn(async function updatePayment(data) {
    Object.assign(this, data)
    return this
  }),
  ...overrides,
})

const buildOrder = (overrides = {}) => {
  const payment = buildPayment(overrides.payment)
  const { payment: _p, ...orderOverrides } = overrides
  return {
    order_id: ORDER_ID,
    user_id: BUYER_USER_ID,
    order_code: "ORD-42",
    status: "cancelled",
    final_amount: 1_500_000,
    payment,
    ...orderOverrides,
  }
}

const postRefund = (orderId = ORDER_ID, token = signSessionToken()) => {
  const req = request(app).post(refundUrl(orderId))
  if (token) req.set("Authorization", `Bearer ${token}`)
  return req
}

describe("POST /api/admin/orders/:order_id/refund (refundOrder)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    User.findByPk.mockResolvedValue(userRecord())
  })

  it("returns 200 and updates payment to refunded for cancelled VNPAY order", async () => {
    const order = buildOrder()
    Order.findByPk.mockResolvedValue(order)

    const res = await postRefund()

    expect(res.status).toBe(200)
    expect(res.body.message).toBe("Order refunded successfully")
    expect(res.body.order.order_id).toBe(ORDER_ID)
    expect(order.payment.update).toHaveBeenCalledWith({
      payment_status: "refunded",
    })
    expect(emitOrderEvent).toHaveBeenCalledWith("order.refunded", {
      order,
      payment: order.payment,
    })
  })

  it("returns 200 on second refund when payment already refunded (BR-04 idempotent)", async () => {
    const order = buildOrder({
      payment: buildPayment({ payment_status: "refunded" }),
    })
    Order.findByPk.mockResolvedValue(order)

    const res = await postRefund()

    expect(res.status).toBe(200)
    expect(order.payment.update).toHaveBeenCalledWith({
      payment_status: "refunded",
    })
  })

  it("returns 400 when order status is not cancelled", async () => {
    Order.findByPk.mockResolvedValue(buildOrder({ status: "processing" }))

    const res = await postRefund()

    expect(res.status).toBe(400)
    expect(res.body.message).toBe("Order must be cancelled to refund")
    expect(emitOrderEvent).not.toHaveBeenCalled()
  })

  it("returns 400 when payment provider is not VNPAY", async () => {
    Order.findByPk.mockResolvedValue(
      buildOrder({ payment: buildPayment({ provider: "COD" }) })
    )

    const res = await postRefund()

    expect(res.status).toBe(400)
    expect(res.body.message).toBe(
      "Only VNPAY orders can be refunded through admin"
    )
    expect(emitOrderEvent).not.toHaveBeenCalled()
  })

  it("returns 404 when order is not found", async () => {
    Order.findByPk.mockResolvedValue(null)

    const res = await postRefund()

    expect(res.status).toBe(404)
    expect(res.body.message).toBe("Order not found")
    expect(emitOrderEvent).not.toHaveBeenCalled()
  })
})

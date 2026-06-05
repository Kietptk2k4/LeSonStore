const request = require("supertest")
const express = require("express")
const jwt = require("jsonwebtoken")

jest.mock("../../services/emailService", () => ({
  sendOrderUpdateEmail: jest.fn().mockResolvedValue(undefined),
}))

jest.mock("../../models", () => ({
  User: { findByPk: jest.fn() },
  Role: {},
  Order: { findByPk: jest.fn() },
}))

const { sendOrderUpdateEmail } = require("../../services/emailService")
const { User, Order } = require("../../models")
const adminRoutes = require("../../routes/adminRoutes")
const errorHandler = require("../../middleware/errorHandler")

const app = express()
app.use(express.json())
app.use("/api/admin", adminRoutes)
app.use(errorHandler)

const ORDER_ID = 42
const BUYER_USER_ID = 99
const statusUrl = (id = ORDER_ID) => `/api/admin/orders/${id}/status`

const ADMIN_USER_ID = 1
const MANAGER_USER_ID = 2
const CUSTOMER_USER_ID = 10
const STAFF_USER_ID = 11

const signSessionToken = (userId) =>
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

const buyerUser = {
  user_id: BUYER_USER_ID,
  email: "buyer@example.com",
  full_name: "Buyer",
}

const buildOrder = (overrides = {}) => {
  const order = {
    order_id: ORDER_ID,
    user_id: BUYER_USER_ID,
    order_code: "ORD-42",
    status: "processing",
    update: jest.fn(async function updateOrder(data) {
      Object.assign(this, data)
      return this
    }),
    ...overrides,
  }
  return order
}

const setupUserMocks = ({ buyer = buyerUser } = {}) => {
  User.findByPk.mockImplementation((id) => {
    if (id === BUYER_USER_ID) {
      return Promise.resolve(buyer)
    }
    if (id === MANAGER_USER_ID) {
      return Promise.resolve(
        userRecord({
          user_id: MANAGER_USER_ID,
          username: "manager1",
          Roles: [{ role_name: "manager" }],
        })
      )
    }
    if (id === CUSTOMER_USER_ID) {
      return Promise.resolve(
        userRecord({
          user_id: CUSTOMER_USER_ID,
          username: "buyer",
          Roles: [{ role_name: "customer" }],
        })
      )
    }
    if (id === STAFF_USER_ID) {
      return Promise.resolve(
        userRecord({
          user_id: STAFF_USER_ID,
          username: "staff1",
          Roles: [{ role_name: "staff" }],
        })
      )
    }
    return Promise.resolve(userRecord({ user_id: id }))
  })
}

const putStatus = (body, token = signSessionToken(ADMIN_USER_ID)) =>
  request(app)
    .put(statusUrl())
    .set("Authorization", `Bearer ${token}`)
    .send(body)

describe("PUT /api/admin/orders/:order_id/status (updateOrderStatus)", () => {
  let order

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || "test-jwt-secret-for-unit-tests"
    setupUserMocks()
    order = buildOrder()
    Order.findByPk.mockResolvedValue(order)
    sendOrderUpdateEmail.mockResolvedValue(undefined)
  })

  it("returns 200 and updates order status for admin", async () => {
    const res = await putStatus({ status: "shipping" })

    expect(res.status).toBe(200)
    expect(res.body.message).toBe("Order status updated successfully")
    expect(order.update).toHaveBeenCalledWith({ status: "shipping" })
    expect(order.status).toBe("shipping")
  })

  it("returns 200 for manager", async () => {
    const res = await putStatus({ status: "shipping" }, signSessionToken(MANAGER_USER_ID))

    expect(res.status).toBe(200)
    expect(res.body.message).toBe("Order status updated successfully")
    expect(order.update).toHaveBeenCalledWith({ status: "shipping" })
  })

  it("calls sendOrderUpdateEmail with ORDER_STATUS and old/new data when buyer exists", async () => {
    await putStatus({ status: "shipping" })
    await new Promise((resolve) => setImmediate(resolve))

    expect(sendOrderUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        order,
        changeType: "ORDER_STATUS",
        oldData: { status: "processing" },
        newData: { status: "shipping" },
        user: buyerUser,
      })
    )
  })

  it("returns 200 when sendOrderUpdateEmail rejects (BR-02)", async () => {
    sendOrderUpdateEmail.mockImplementation(() =>
      Promise.reject(new Error("smtp failed"))
    )

    const res = await putStatus({ status: "shipping" })
    await new Promise((resolve) => setImmediate(resolve))

    expect(res.status).toBe(200)
    expect(res.body.message).toBe("Order status updated successfully")
    expect(order.update).toHaveBeenCalledWith({ status: "shipping" })
  })

  // FSM: processing → delivered is no longer allowed (intentional vs BR-01)
  it("returns 400 Invalid transition when processing to delivered (FSM)", async () => {
    order.status = "processing"

    const res = await putStatus({ status: "delivered" })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe("Invalid transition: processing → delivered")
    expect(order.update).not.toHaveBeenCalled()
    expect(order.status).toBe("processing")
  })

  // FR: GAP-01 — no email when order owner user is null
  it("returns 200 but does not call sendOrderUpdateEmail when User.findByPk returns null for buyer (GAP-01)", async () => {
    setupUserMocks({ buyer: null })

    const res = await putStatus({ status: "shipping" })

    expect(res.status).toBe(200)
    expect(order.update).toHaveBeenCalledWith({ status: "shipping" })
    expect(sendOrderUpdateEmail).not.toHaveBeenCalled()
  })

  it("returns 404 when order is not found", async () => {
    Order.findByPk.mockResolvedValue(null)

    const res = await putStatus({ status: "shipping" })

    expect(res.status).toBe(404)
    expect(res.body.message).toBe("Order not found")
    expect(order.update).not.toHaveBeenCalled()
    expect(sendOrderUpdateEmail).not.toHaveBeenCalled()
  })

  it("returns 401 without bearer token", async () => {
    const res = await request(app).put(statusUrl()).send({ status: "shipping" })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe("Access token required")
    expect(Order.findByPk).not.toHaveBeenCalled()
  })

  it("returns 403 for customer role", async () => {
    const res = await putStatus({ status: "shipping" }, signSessionToken(CUSTOMER_USER_ID))

    expect(res.status).toBe(403)
    expect(res.body.message).toBe("Insufficient permissions")
    expect(Order.findByPk).not.toHaveBeenCalled()
  })

  it("returns 403 for staff role", async () => {
    const res = await putStatus({ status: "shipping" }, signSessionToken(STAFF_USER_ID))

    expect(res.status).toBe(403)
    expect(res.body.message).toBe("Insufficient permissions")
    expect(Order.findByPk).not.toHaveBeenCalled()
  })

  it("returns 500 when order.update throws", async () => {
    order.update.mockRejectedValue(new Error("DB update failed"))

    const res = await putStatus({ status: "shipping" })

    expect(res.status).toBe(500)
    expect(res.body.message).toBe("DB update failed")
  })
})

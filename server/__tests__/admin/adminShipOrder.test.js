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
const shipUrl = (id = ORDER_ID) => `/api/admin/orders/${id}/ship`

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

const setupUserMocks = () => {
  User.findByPk.mockImplementation((id) => {
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
    if (id === BUYER_USER_ID) {
      return Promise.resolve({
        user_id: BUYER_USER_ID,
        email: "buyer@example.com",
        full_name: "Buyer",
      })
    }
    return Promise.resolve(userRecord({ user_id: id }))
  })
}

const postShip = (id = ORDER_ID, token = signSessionToken(ADMIN_USER_ID)) =>
  request(app).post(shipUrl(id)).set("Authorization", `Bearer ${token}`).send({})

describe("POST /api/admin/orders/:order_id/ship (shipOrder)", () => {
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

  it("returns 200 and updates order to shipping for admin when status is processing", async () => {
    const res = await postShip()

    expect(res.status).toBe(200)
    expect(res.body.message).toBe("Order shipped successfully")
    expect(order.update).toHaveBeenCalledWith({ status: "shipping" })
    expect(order.status).toBe("shipping")
  })

  it("returns 200 for manager when status is processing", async () => {
    const res = await postShip(ORDER_ID, signSessionToken(MANAGER_USER_ID))

    expect(res.status).toBe(200)
    expect(res.body.message).toBe("Order shipped successfully")
    expect(order.update).toHaveBeenCalledWith({ status: "shipping" })
  })

  it("calls sendOrderUpdateEmail with old processing and new shipping status", async () => {
    await postShip()
    await new Promise((resolve) => setImmediate(resolve))

    expect(sendOrderUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        order,
        changeType: "ORDER_STATUS",
        oldData: { status: "processing" },
        newData: { status: "shipping" },
        user: expect.objectContaining({ user_id: BUYER_USER_ID }),
      })
    )
  })

  it("returns 200 when sendOrderUpdateEmail rejects", async () => {
    sendOrderUpdateEmail.mockImplementation(() =>
      Promise.reject(new Error("smtp failed"))
    )

    const res = await postShip()
    await new Promise((resolve) => setImmediate(resolve))

    expect(res.status).toBe(200)
    expect(res.body.message).toBe("Order shipped successfully")
    expect(order.update).toHaveBeenCalledWith({ status: "shipping" })
  })

  it("returns 404 when order is not found", async () => {
    Order.findByPk.mockResolvedValue(null)

    const res = await postShip()

    expect(res.status).toBe(404)
    expect(res.body.message).toBe("Order not found")
    expect(order.update).not.toHaveBeenCalled()
  })

  it.each([
    ["AWAITING_PAYMENT"],
    ["shipping"],
    ["delivered"],
    ["cancelled"],
  ])("returns 400 when order status is %s", async (status) => {
    order.status = status

    const res = await postShip()

    expect(res.status).toBe(400)
    expect(res.body.message).toBe("Order must be in processing status to ship")
    expect(order.update).not.toHaveBeenCalled()
  })

  it("returns 401 without bearer token", async () => {
    const res = await request(app).post(shipUrl()).send({})

    expect(res.status).toBe(401)
    expect(res.body.message).toBe("Access token required")
    expect(Order.findByPk).not.toHaveBeenCalled()
  })

  it("returns 403 for customer role", async () => {
    const res = await postShip(ORDER_ID, signSessionToken(CUSTOMER_USER_ID))

    expect(res.status).toBe(403)
    expect(res.body.message).toBe("Insufficient permissions")
    expect(Order.findByPk).not.toHaveBeenCalled()
  })

  it("returns 403 for staff role", async () => {
    const res = await postShip(ORDER_ID, signSessionToken(STAFF_USER_ID))

    expect(res.status).toBe(403)
    expect(res.body.message).toBe("Insufficient permissions")
    expect(Order.findByPk).not.toHaveBeenCalled()
  })

  it("returns 500 when order.update throws", async () => {
    order.update.mockRejectedValue(new Error("DB update failed"))

    const res = await postShip()

    expect(res.status).toBe(500)
    expect(res.body.message).toBe("DB update failed")
  })
})

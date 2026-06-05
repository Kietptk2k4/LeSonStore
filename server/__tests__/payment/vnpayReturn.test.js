const request = require("supertest")
const express = require("express")

jest.mock("../../services/vnpayService", () => ({
  getPaymentUrl: jest.fn(),
  verifyReturnUrl: jest.fn(),
}))

jest.mock("../../models", () => ({
  Order: { findByPk: jest.fn() },
  Payment: { findOne: jest.fn() },
  User: { findAll: jest.fn() },
  Role: {},
}))

jest.mock("../../services/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue({}),
}))

const { verifyReturnUrl } = require("../../services/vnpayService")
const { Order, Payment, User } = require("../../models")
const notificationService = require("../../services/notificationService")
const vnpayRoutes = require("../../routes/vnpayRoutes")

const app = express()
app.use(express.json())
app.use("/api", vnpayRoutes)

const FE_BASE = "http://localhost:3000"
const RETURN_URL = "/api/vnpay/return"

const successLocation = (orderId) =>
  `${FE_BASE}/checkout/vnpay-return?status=success&orderId=${encodeURIComponent(orderId)}`

const failedLocation = (orderId) =>
  `${FE_BASE}/checkout/vnpay-return?status=failed&orderId=${encodeURIComponent(orderId)}`

const createPaymentMock = (overrides = {}) => {
  const payment = {
    payment_status: "pending",
    txn_ref: null,
    transaction_id: null,
    paid_at: null,
    amount: 22530000,
    save: jest.fn().mockImplementation(async function save() {
      return payment
    }),
    ...overrides,
  }
  return payment
}

const createOrderMock = (overrides = {}) => {
  const order = {
    order_id: 42,
    user_id: null,
    order_code: "ORD-42",
    status: "AWAITING_PAYMENT",
    final_amount: 22530000,
    update: jest.fn(async function updateOrder(data) {
      Object.assign(this, data)
      return this
    }),
    save: jest.fn().mockImplementation(async function save() {
      return order
    }),
    ...overrides,
  }
  return order
}

const defaultQuery = {
  vnp_TxnRef: "42-1710000000000",
  vnp_ResponseCode: "00",
  vnp_SecureHash: "mock-hash",
}

describe("GET /api/vnpay/return (vnpayReturn)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.FE_APP_URL = FE_BASE
    User.findAll.mockResolvedValue([])
  })

  // FR: AC §14 — isSuccess true → payment completed, order processing, redirect success
  it("redirects success and updates payment completed and order processing when isSuccess is true", async () => {
    const txnRef = "42-1710000000000"
    verifyReturnUrl.mockReturnValue({
      isSuccess: true,
      vnp_Params: {
        vnp_TxnRef: txnRef,
        vnp_TransactionNo: "14091234",
        vnp_ResponseCode: "00",
      },
    })

    const payment = createPaymentMock()
    const order = createOrderMock()
    Order.findByPk.mockResolvedValue(order)
    Payment.findOne.mockResolvedValue(payment)

    const res = await request(app)
      .get(RETURN_URL)
      .query(defaultQuery)
      .redirects(0)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(successLocation("42"))
    expect(verifyReturnUrl).toHaveBeenCalledWith(
      expect.objectContaining({ vnp_TxnRef: txnRef })
    )
    expect(Order.findByPk).toHaveBeenCalledWith("42")
    expect(Payment.findOne).toHaveBeenCalledWith({ where: { order_id: "42" } })
    expect(payment.payment_status).toBe("completed")
    expect(payment.txn_ref).toBe(txnRef)
    expect(payment.transaction_id).toBe("14091234")
    expect(payment.paid_at).toBeInstanceOf(Date)
    expect(payment.save).toHaveBeenCalledTimes(1)
    expect(order.status).toBe("processing")
    expect(order.update).toHaveBeenCalledWith({ status: "processing" })
  })

  // FR: BR-04 — idempotent when payment already completed
  it("skips DB update but still redirects success when payment is already completed", async () => {
    verifyReturnUrl.mockReturnValue({
      isSuccess: true,
      vnp_Params: {
        vnp_TxnRef: "42-1710000000001",
        vnp_ResponseCode: "00",
      },
    })

    const payment = createPaymentMock({ payment_status: "completed" })
    const order = createOrderMock({ status: "processing" })
    Order.findByPk.mockResolvedValue(order)
    Payment.findOne.mockResolvedValue(payment)

    const res = await request(app)
      .get(RETURN_URL)
      .query(defaultQuery)
      .redirects(0)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(successLocation("42"))
    expect(payment.save).not.toHaveBeenCalled()
    expect(order.save).not.toHaveBeenCalled()
    expect(notificationService.createNotification).not.toHaveBeenCalled()
  })

  // FR: GAP-05 — order/payment null vẫn redirect success
  it("redirects success without DB update when order or payment is missing (GAP-05)", async () => {
    verifyReturnUrl.mockReturnValue({
      isSuccess: true,
      vnp_Params: { vnp_TxnRef: "99-1710000000000", vnp_ResponseCode: "00" },
    })
    Order.findByPk.mockResolvedValue(null)
    Payment.findOne.mockResolvedValue(null)

    const res = await request(app)
      .get(RETURN_URL)
      .query({ ...defaultQuery, vnp_TxnRef: "99-1710000000000" })
      .redirects(0)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(successLocation("99"))
    expect(Payment.findOne).toHaveBeenCalled()
  })

  // FR: §7 — isSuccess false → payment failed, redirect failed
  it("redirects failed and sets payment failed when isSuccess is false", async () => {
    verifyReturnUrl.mockReturnValue({
      isSuccess: false,
      vnp_Params: {
        vnp_TxnRef: "42-1710000000002",
        vnp_ResponseCode: "24",
      },
    })

    const payment = createPaymentMock()
    Payment.findOne.mockResolvedValue(payment)

    const res = await request(app)
      .get(RETURN_URL)
      .query({ ...defaultQuery, vnp_ResponseCode: "24" })
      .redirects(0)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(failedLocation("42"))
    expect(payment.payment_status).toBe("failed")
    expect(payment.save).toHaveBeenCalledTimes(1)
    expect(Order.findByPk).not.toHaveBeenCalled()
  })

  // FR: §7 / BR-08 — bad hash → isSuccess false (via verifyReturnUrl)
  it("treats invalid secure hash as failure (isSuccess false from verifyReturnUrl)", async () => {
    verifyReturnUrl.mockReturnValue({
      isSuccess: false,
      vnp_Params: {
        vnp_TxnRef: "42-1710000000003",
        vnp_ResponseCode: "00",
      },
    })

    const payment = createPaymentMock()
    Payment.findOne.mockResolvedValue(payment)

    const res = await request(app)
      .get(RETURN_URL)
      .query({ ...defaultQuery, vnp_SecureHash: "bad-hash" })
      .redirects(0)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(failedLocation("42"))
    expect(payment.payment_status).toBe("failed")
    expect(payment.save).toHaveBeenCalled()
  })

  // FR: §9 — empty txnRef → orderId=unknown
  it("redirects failed with orderId=unknown when txnRef is empty", async () => {
    verifyReturnUrl.mockReturnValue({
      isSuccess: true,
      vnp_Params: {},
    })

    const res = await request(app).get(RETURN_URL).query({}).redirects(0)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(
      `${FE_BASE}/checkout/vnpay-return?status=failed&orderId=unknown`
    )
    expect(Order.findByPk).not.toHaveBeenCalled()
    expect(Payment.findOne).not.toHaveBeenCalled()
  })

  // FR: §8 — verifyReturnUrl throws → /orders?error=unknown
  it("redirects to orders with error=unknown when verifyReturnUrl throws", async () => {
    verifyReturnUrl.mockImplementation(() => {
      throw new Error("verify failed")
    })

    const res = await request(app)
      .get(RETURN_URL)
      .query(defaultQuery)
      .redirects(0)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${FE_BASE}/orders?error=unknown`)
    expect(Order.findByPk).not.toHaveBeenCalled()
  })

  // FR: §8 — DB error propagates to catch
  it("redirects to orders with error=unknown when Order.findByPk throws", async () => {
    verifyReturnUrl.mockReturnValue({
      isSuccess: true,
      vnp_Params: { vnp_TxnRef: "42-1710000000004", vnp_ResponseCode: "00" },
    })
    Order.findByPk.mockRejectedValue(new Error("db down"))

    const res = await request(app)
      .get(RETURN_URL)
      .query(defaultQuery)
      .redirects(0)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${FE_BASE}/orders?error=unknown`)
  })
})

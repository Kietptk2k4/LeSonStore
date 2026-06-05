const {
  Order,
  OrderItem,
  Cart,
  CartItem,
  ProductVariation,
  Payment,
  Product,
} = require("../../models");
const sequelize = require("../../config/database");
const { quoteShipping } = require("../shippingService");
const orderRepository = require("./orderRepository");
const { getStrategy } = require("../payment/paymentStrategy");
const { emitOrderEvent } = require("../../events/orderEventBus");
const { registerOrderListeners } = require("../../events/listeners");
const {
  applyTransition,
  emitStatusChanged,
} = require("./orderStateMachine");

registerOrderListeners();

const toVnd = (x) => Math.max(0, Math.round(Number(x) || 0));

function generateOrderCode() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${timestamp}-${random}`;
}

function appendNote(oldNote, reason) {
  const r = (reason || "").trim();
  if (!r) return oldNote || "";
  const head = `[Cancel @${new Date().toISOString()}] ${r}`;
  return oldNote ? `${oldNote}\n${head}` : head;
}

function throwHttp(status, message, detail) {
  const err = new Error(message);
  err.status = status;
  if (detail !== undefined) err.detail = detail;
  throw err;
}

async function createFromCart({ userId, user, body, req }) {
  const {
    shipping_address,
    shipping_phone,
    shipping_name,
    note,
    payment_provider,
    payment_method,
    items,
    province_id,
    ward_id,
    geo_lat,
    geo_lng,
  } = body;

  const t = await sequelize.transaction();
  try {
    if (!province_id || !ward_id) {
      await t.rollback();
      throwHttp(400, "Vui lòng chọn Tỉnh/Thành và Phường/Xã");
    }
    if (geo_lat == null || geo_lng == null) {
      await t.rollback();
      throwHttp(400, "Vui lòng xác nhận vị trí trên bản đồ");
    }

    let strategy;
    try {
      if (!payment_provider) {
        throwHttp(400, `Unsupported payment_provider: ${payment_provider}`);
      }
      strategy = getStrategy(payment_provider);
      strategy.validateMethod(payment_method, "createOrder");
    } catch (err) {
      if (err.status) {
        await t.rollback();
        let message = err.message;
        if (message.startsWith("Unsupported provider:")) {
          message = `Unsupported payment_provider: ${payment_provider}`;
        }
        throwHttp(err.status, message);
      }
      throw err;
    }

    let txnRef = null;
    let itemsForOrder = [];

    if (Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        const variation = await ProductVariation.findByPk(it.variation_id, {
          include: [{ model: Product, as: "product" }],
          transaction: t,
        });
        if (!variation) {
          await t.rollback();
          throwHttp(400, `Variation ${it.variation_id} not found`);
        }
        itemsForOrder.push({
          variation,
          variation_id: variation.variation_id,
          quantity: Number(it.quantity || 1),
        });
      }
    } else {
      const cart = await Cart.findOne({
        where: { user_id: userId },
        transaction: t,
      });
      if (!cart) {
        await t.rollback();
        throwHttp(400, "Cart is empty");
      }

      const cartItems = await CartItem.findAll({
        where: { cart_id: cart.cart_id },
        include: [
          {
            model: ProductVariation,
            as: "variation",
            include: [{ model: Product, as: "product" }],
          },
        ],
        transaction: t,
      });
      if (cartItems.length === 0) {
        await t.rollback();
        throwHttp(400, "Cart is empty");
      }

      itemsForOrder = cartItems.map((ci) => ({
        variation: ci.variation,
        variation_id: ci.variation_id,
        quantity: ci.quantity,
      }));
    }

    let totalAmount = 0;
    let discountAmount = 0;

    for (const it of itemsForOrder) {
      const v = it.variation;
      const available = Number(v.stock_quantity || 0);
      if (!v.is_available || available < it.quantity) {
        await t.rollback();
        throwHttp(
          400,
          `Insufficient stock for ${
            v.product?.product_name || `variation ${it.variation_id}`
          }`
        );
      }

      const price = Number(v.price);
      const pct = Math.max(0, Number(v.product?.discount_percentage || 0));
      const itemTotal = price * it.quantity;
      const itemDiscount = Math.round(((price * pct) / 100) * it.quantity);

      totalAmount += itemTotal;
      discountAmount += itemDiscount;
    }

    const items_breakdown = itemsForOrder.map((it) => {
      const v = it.variation;
      const price = Number(v.price);
      const pct = Math.max(0, Number(v.product?.discount_percentage || 0));
      const unit_discount_amount = Math.round((price * pct) / 100);
      const unit_final_price = Math.max(0, price - unit_discount_amount);
      const itemTotal = price * it.quantity;
      const itemDiscount = Math.round(unit_discount_amount * it.quantity);

      return {
        variation_id: it.variation_id,
        product_name: v.product?.product_name || null,
        quantity: it.quantity,
        unit_price: Math.round(price),
        unit_discount_amount,
        unit_final_price,
        item_total: Math.round(itemTotal),
        item_discount: itemDiscount,
        item_subtotal_after_discount: Math.max(
          0,
          Math.round(itemTotal - itemDiscount)
        ),
      };
    });

    const subtotalAfterDiscount = toVnd(totalAmount - discountAmount);
    const { shipping_fee } = await quoteShipping({
      province_id,
      ward_id,
      subtotal: subtotalAfterDiscount,
    });

    const finalAmount = toVnd(
      subtotalAfterDiscount + Number(shipping_fee || 0)
    );

    const holdMs = strategy.getReserveHoldMs();
    const order = await Order.create(
      {
        user_id: userId,
        order_code: generateOrderCode(),
        total_amount: totalAmount,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        status: strategy.getInitialOrderStatus(),
        shipping_address,
        shipping_fee,
        shipping_phone,
        shipping_name,
        note: note || "",
        reserve_expires_at: holdMs ? new Date(Date.now() + holdMs) : null,
        province_id: province_id || null,
        ward_id: ward_id || null,
        geo_lat: geo_lat ?? null,
        geo_lng: geo_lng ?? null,
      },
      { transaction: t }
    );

    txnRef = strategy.buildTxnRef(order.order_id);

    for (const it of itemsForOrder) {
      const reserveResult = await orderRepository.reserveVariationStock(
        it.variation_id,
        it.quantity,
        t
      );
      if (!reserveResult.ok) {
        await t.rollback();
        throwHttp(reserveResult.status, reserveResult.message);
      }

      const price = Number(it.variation.price);
      const pct = Math.max(
        0,
        Number(it.variation.product?.discount_percentage || 0)
      );
      const itemTotal = price * it.quantity;
      const itemDiscount = Math.round(((price * pct) / 100) * it.quantity);

      await OrderItem.create(
        {
          order_id: order.order_id,
          variation_id: it.variation_id,
          quantity: it.quantity,
          price,
          discount_amount: itemDiscount,
          subtotal: Math.max(0, Math.round(itemTotal - itemDiscount)),
        },
        { transaction: t }
      );
    }

    await orderRepository.createPaymentRecord(
      strategy.buildPaymentRecord({
        order_id: order.order_id,
        payment_method,
        amount: finalAmount,
        txnRef,
      }),
      t
    );

    if (Array.isArray(items) && items.length > 0) {
      const cart = await Cart.findOne({
        where: { user_id: userId },
        transaction: t,
      });

      if (cart) {
        const selectedVariationIds = items
          .map((it) => Number(it.variation_id))
          .filter(Boolean);

        if (selectedVariationIds.length > 0) {
          await CartItem.destroy({
            where: {
              cart_id: cart.cart_id,
              variation_id: selectedVariationIds,
            },
            transaction: t,
          });
        }
      }
    } else {
      const cart = await Cart.findOne({
        where: { user_id: userId },
        transaction: t,
      });
      if (cart) {
        await CartItem.destroy({
          where: { cart_id: cart.cart_id },
          transaction: t,
        });
      }
    }

    let redirect = null;
    try {
      const paymentResult = await strategy.afterOrderCreated({
        order,
        payment_method,
        amount: finalAmount,
        txnRef,
        req,
      });
      redirect = paymentResult.redirect;
    } catch (e) {
      await t.rollback();
      throwHttp(502, "VNPAY configuration error", e.message);
    }

    await t.commit();

    emitOrderEvent("order.created", {
      order,
      items_breakdown,
      payment_provider,
      payment_method,
      user,
    });

    return {
      statusCode: 201,
      body: {
        message: "Order created successfully",
        order: {
          order_id: order.order_id,
          order_code: order.order_code,
          total_amount: order.total_amount,
          discount_amount: order.discount_amount,
          final_amount: order.final_amount,
          status: order.status,
          shipping_fee,
          items_breakdown,
        },
        redirect,
      },
    };
  } catch (error) {
    if (!error.status) {
      await t.rollback();
    }
    throw error;
  }
}

async function cancelOrder({ userId, orderId, reason }) {
  const t = await sequelize.transaction();
  try {
    const trimmedReason = (reason || "").slice(0, 500);

    const orderBundle = await orderRepository.findOrderWithItemsAndPayment(
      orderId,
      { userId, transaction: t, lockOrder: true }
    );

    if (!orderBundle) {
      await t.rollback();
      throwHttp(404, "Order not found");
    }

    const { order, payment, items } = orderBundle;

    const prov = payment?.provider || "COD";
    const pstat = payment?.payment_status;
    const ostat = order.status;

    const isAwaitingVnpay =
      prov === "VNPAY" && ostat === "AWAITING_PAYMENT" && pstat === "pending";
    const isToShipCOD =
      prov === "COD" && ostat === "processing" && pstat === "pending";
    const isToShipVNPAY =
      prov === "VNPAY" && ostat === "processing" && pstat === "completed";

    if (!(isAwaitingVnpay || isToShipCOD || isToShipVNPAY)) {
      await t.rollback();
      throwHttp(400, "Order cannot be cancelled in current state.");
    }

    for (const it of items) {
      await orderRepository.releaseVariationStock(
        it.variation_id,
        it.quantity,
        t
      );
    }

    const { oldStatus } = await applyTransition(order, "cancelled", {
      transaction: t,
      extraOrderFields: { note: appendNote(order.note, trimmedReason) },
    });

    if (payment) {
      if (isAwaitingVnpay || isToShipCOD) {
        await payment.update(
          { payment_status: "failed", paid_at: null },
          { transaction: t }
        );
      } else if (isToShipVNPAY) {
        await payment.update({ payment_status: "pending" }, { transaction: t });
      }
    }

    await t.commit();

    emitOrderEvent("order.cancelled", { order, payment, userId });
    emitStatusChanged(order, oldStatus, "cancelled", {
      source: "customer_cancel",
      payment,
    });

    return {
      statusCode: 200,
      body: {
        message: "Order cancelled successfully",
        order: {
          order_id: order.order_id,
          status: "cancelled",
          payment_status: payment?.payment_status || null,
        },
      },
    };
  } catch (error) {
    if (!error.status) {
      await t.rollback();
    }
    throw error;
  }
}

async function changePaymentMethod({ userId, orderId, provider, method, req }) {
  const t = await sequelize.transaction();
  try {
    let strategy;
    try {
      strategy = getStrategy(provider);
      strategy.validateMethod(method, "changePayment");
    } catch (err) {
      if (err.status) {
        await t.rollback();
        throwHttp(err.status, err.message);
      }
      throw err;
    }

    const order = await Order.findOne({
      where: { order_id: orderId, user_id: userId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!order) {
      await t.rollback();
      throwHttp(404, "Order not found");
    }

    if (["shipping", "delivered", "cancelled"].includes(order.status)) {
      await t.rollback();
      throwHttp(400, "Cannot change payment in current state.");
    }

    const payment = await Payment.findOne({
      where: { order_id: order.order_id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!payment) {
      await t.rollback();
      throwHttp(400, "Payment record not found");
    }

    if (payment.payment_status === "completed") {
      await t.rollback();
      throwHttp(400, "Payment already completed; cannot change method.");
    }

    const oldData = {
      provider: payment.provider,
      method: payment.payment_method,
    };

    let redirect = null;
    try {
      const changeResult = await strategy.applyChangePayment({
        order,
        payment,
        method,
        req,
        transaction: t,
      });
      redirect = changeResult.redirect;
    } catch (e) {
      await t.rollback();
      throwHttp(502, "VNPAY configuration error", e.message);
    }

    await t.commit();

    const newData = {
      provider: payment.provider,
      method: payment.payment_method,
    };

    emitOrderEvent("order.payment_method.changed", {
      order,
      payment,
      oldData,
      newData,
    });

    return {
      statusCode: 200,
      body: {
        message: "Payment method updated",
        order: {
          order_id: order.order_id,
          status: order.status,
        },
        payment: {
          provider,
          method,
          status: "pending",
        },
        redirect,
      },
    };
  } catch (error) {
    if (!error.status) {
      await t.rollback();
    }
    throw error;
  }
}

module.exports = {
  createFromCart,
  cancelOrder,
  changePaymentMethod,
};

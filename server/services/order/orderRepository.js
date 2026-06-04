const { Order, OrderItem, Payment, ProductVariation } = require("../../models");

/**
 * Khóa row variation, kiểm tra tồn kho và trừ stock (logic copy từ createOrder).
 * @returns {{ ok: true, variation }} | {{ ok: false, status: number, message: string }}
 */
async function reserveVariationStock(variationId, quantity, transaction) {
  const v = await ProductVariation.findOne({
    where: { variation_id: variationId },
    transaction,
    lock: transaction.LOCK.UPDATE,
    skipLocked: true,
  });
  if (!v) {
    return {
      ok: false,
      status: 400,
      message: `Variation ${variationId} not found during reserve`,
    };
  }
  if (Number(v.stock_quantity || 0) < quantity) {
    return {
      ok: false,
      status: 400,
      message: `Out of stock during reserve for ${variationId}`,
    };
  }

  await v.decrement("stock_quantity", { by: quantity, transaction });
  return { ok: true, variation: v };
}

/** Tạo bản ghi Payment (logic copy từ createOrder). */
async function createPaymentRecord(data, transaction) {
  return Payment.create(data, { transaction });
}

/**
 * Tìm order + payment + items (logic copy từ cancelOrder).
 * @returns {{ order, payment, items } | null} null khi không tìm thấy order
 */
async function findOrderWithItemsAndPayment(orderId, { userId, transaction, lockOrder = false }) {
  const findOptions = {
    where: { order_id: orderId, user_id: userId },
    transaction,
  };
  if (lockOrder) {
    findOptions.lock = transaction.LOCK.UPDATE;
    findOptions.skipLocked = true;
  }

  const order = await Order.findOne(findOptions);
  if (!order) {
    return null;
  }

  const payment = await Payment.findOne({
    where: { order_id: order.order_id },
    transaction,
  });

  const items = await OrderItem.findAll({
    where: { order_id: order.order_id },
    transaction,
  });

  return { order, payment, items };
}

/** Hoàn kho — increment stock (logic copy từ cancelOrder). */
async function releaseVariationStock(variationId, quantity, transaction) {
  const v = await ProductVariation.findOne({
    where: { variation_id: variationId },
    transaction,
    lock: transaction.LOCK.UPDATE,
    skipLocked: true,
  });
  if (!v) return null;
  await v.increment("stock_quantity", { by: quantity, transaction });
  return v;
}

module.exports = {
  reserveVariationStock,
  createPaymentRecord,
  findOrderWithItemsAndPayment,
  releaseVariationStock,
};

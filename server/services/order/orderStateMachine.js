const { emitOrderEvent } = require("../../events/orderEventBus");

const ALLOWED = {
  AWAITING_PAYMENT: ["cancelled", "processing"],
  processing: ["shipping", "cancelled"],
  shipping: ["delivered"],
  delivered: [],
  cancelled: [],
  FAILED: ["AWAITING_PAYMENT"],
};

function assertTransition(from, to) {
  const allowed = ALLOWED[from];
  if (!allowed || !allowed.includes(to)) {
    const err = new Error(`Invalid transition: ${from} → ${to}`);
    err.status = 400;
    throw err;
  }
}

async function applyTransition(order, to, { transaction, extraOrderFields = {} } = {}) {
  const from = order.status;
  assertTransition(from, to);
  const oldStatus = from;

  const updatePayload = { status: to, ...extraOrderFields };
  if (transaction) {
    await order.update(updatePayload, { transaction });
  } else {
    await order.update(updatePayload);
  }

  return { oldStatus, newStatus: to };
}

function emitStatusChanged(order, oldStatus, newStatus, context = {}) {
  emitOrderEvent("order.status.changed", {
    order,
    oldStatus,
    newStatus,
    context,
  });
}

module.exports = {
  ALLOWED,
  assertTransition,
  applyTransition,
  emitStatusChanged,
};

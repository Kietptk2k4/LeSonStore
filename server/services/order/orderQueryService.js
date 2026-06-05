const { Op } = require("sequelize");
const {
  Order,
  OrderItem,
  ProductVariation,
  Payment,
  Product,
} = require("../../models");

/**
 * Parse ?tab=&page=&limit=&q=&sort= — dùng chung V2 + legacy
 */
function parseListQuery(query = {}) {
  const {
    tab = "all",
    page = 1,
    limit = 10,
    q = "",
    sort = "created_at:desc",
  } = query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * perPage;

  const [, sortDirRaw] = String(sort).split(":");
  const sortDir =
    (sortDirRaw || "desc").toUpperCase() === "ASC" ? "ASC" : "DESC";

  return {
    tab: String(tab),
    q: String(q || "").trim(),
    pageNum,
    perPage,
    offset,
    sortDir,
    orderBy: [["created_at", sortDir]],
  };
}

/**
 * Map Sequelize Order instance → JSON list item (IDENTICAL cho V2 + legacy)
 */
function mapOrderListRow(o) {
  const j = o.toJSON();
  const preview = (j.items || []).slice(0, 2).map((it) => ({
    variation_id: it.variation_id,
    quantity: it.quantity,
    product_name: it.variation?.product?.product_name || null,
    thumbnail_url:
      it.variation?.product?.images?.[0]?.image_url ||
      it.variation?.product?.thumbnail_url ||
      null,
  }));

  return {
    order_id: j.order_id,
    order_code: j.order_code,
    status: j.status,
    final_amount: Number(j.final_amount || 0),
    shipping_fee: Number(j.shipping_fee || 0),
    created_at: j.created_at,
    reserve_expires_at: j.reserve_expires_at,
    payment: j.payment
      ? {
          provider: j.payment.provider,
          payment_method: j.payment.payment_method,
          payment_status: j.payment.payment_status,
          txn_ref: j.payment.txn_ref,
        }
      : null,
    items_preview: preview,
    items_count: (j.items || []).length,
  };
}

function buildPagination(count, pageNum, perPage) {
  return {
    total: count,
    page: pageNum,
    limit: perPage,
    totalPages: Math.ceil(count / perPage),
  };
}

/**
 * V2 — production GET /api/orders
 */
async function listUserOrdersV2({ userId, query }) {
  const { tab, q, pageNum, perPage, offset, orderBy } = parseListQuery(query);

  const where = { user_id: userId };

  let paymentInclude = {
    model: Payment,
    as: "payment",
    required: false,
  };

  switch (tab) {
    case "awaiting_payment":
      where.status = "AWAITING_PAYMENT";
      paymentInclude = {
        model: Payment,
        as: "payment",
        required: true,
        where: { provider: "VNPAY", payment_status: "pending" },
      };
      break;

    case "to_ship":
      where.status = "processing";
      paymentInclude = {
        model: Payment,
        as: "payment",
        required: true,
        where: {
          [Op.or]: [
            { provider: "COD", payment_status: "pending" },
            { provider: "VNPAY", payment_status: "completed" },
          ],
        },
      };
      break;

    case "shipping":
      where.status = "shipping";
      paymentInclude = {
        model: Payment,
        as: "payment",
        required: true,
        where: {
          [Op.or]: [
            { provider: "COD", payment_status: "pending" },
            { provider: "VNPAY", payment_status: "completed" },
          ],
        },
      };
      break;

    case "completed":
      where.status = "delivered";
      paymentInclude = {
        model: Payment,
        as: "payment",
        required: true,
        where: { payment_status: "completed" },
      };
      break;

    case "cancelled":
      where.status = { [Op.in]: ["cancelled", "FAILED"] };
      break;

    case "failed":
      where.status = "FAILED";
      break;

    case "all":
    default:
      break;
  }

  if (q) {
    where[Op.or] = [
      { order_code: { [Op.iLike]: `%${q}%` } },
      { "$items.variation.product.product_name$": { [Op.iLike]: `%${q}%` } },
    ];
  }

  const { count, rows } = await Order.findAndCountAll({
    where,
    include: [
      {
        model: OrderItem,
        as: "items",
        required: true,
        include: [
          {
            model: ProductVariation,
            as: "variation",
            include: [{ model: Product, as: "product" }],
          },
        ],
      },
      paymentInclude,
    ],
    limit: perPage,
    offset,
    order: orderBy,
    distinct: true,
    subQuery: false,
  });

  return {
    orders: rows.map(mapOrderListRow),
    pagination: buildPagination(count, pageNum, perPage),
  };
}

/**
 * Legacy — exports.getUserOrders (không mount route)
 */
async function listUserOrders({ userId, query }) {
  const { tab, q, pageNum, perPage, offset, orderBy } = parseListQuery(query);

  const where = { user_id: userId };
  const paymentWhere = {};

  switch (tab) {
    case "awaiting_payment":
      where.status = "AWAITING_PAYMENT";
      paymentWhere.provider = "VNPAY";
      paymentWhere.payment_status = "pending";
      break;

    case "to_ship":
      where.status = "processing";
      break;

    case "shipping":
      where.status = "shipping";
      break;

    case "completed":
      where.status = "delivered";
      paymentWhere.payment_status = "completed";
      break;

    case "cancelled":
      where.status = { [Op.in]: ["cancelled", "FAILED"] };
      break;

    case "failed":
      where.status = "FAILED";
      break;

    case "all":
    default:
      break;
  }

  if (q) {
    where.order_code = { [Op.iLike]: `%${q}%` };
  }

  const { count, rows } = await Order.findAndCountAll({
    where,
    include: [
      {
        model: OrderItem,
        as: "items",
        include: [
          {
            model: ProductVariation,
            as: "variation",
            include: [{ model: Product, as: "product" }],
          },
        ],
      },
      {
        model: Payment,
        as: "payment",
        ...(Object.keys(paymentWhere).length ? { where: paymentWhere } : {}),
        required: false,
      },
    ],
    limit: perPage,
    offset,
    order: orderBy,
    distinct: true,
  });

  return {
    orders: rows.map(mapOrderListRow),
    pagination: buildPagination(count, pageNum, perPage),
  };
}

module.exports = {
  parseListQuery,
  mapOrderListRow,
  listUserOrdersV2,
  listUserOrders,
};

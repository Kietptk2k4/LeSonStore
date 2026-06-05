const sequelize = require("../../config/database");
const { Op, Sequelize } = require("sequelize");
const { Product, Order, User } = require("../../models");

async function getDashboard({ period = "30" }) {
  const periodDays = parseInt(period);

  const periodStartDate = new Date();
  periodStartDate.setDate(periodStartDate.getDate() - periodDays);

  const [totalUsers, totalProducts] = await Promise.all([
    User.count(),
    Product.count({ where: { is_active: true } }),
  ]);

  const [totalOrders, totalRevenue, totalDiscount, deliveredOrders] =
    await Promise.all([
      Order.count({
        where: {
          created_at: { [Op.gte]: periodStartDate },
        },
      }),
      Order.sum("final_amount", {
        where: {
          status: "delivered",
          created_at: { [Op.gte]: periodStartDate },
        },
      }),
      Order.sum("discount_amount", {
        where: {
          status: "delivered",
          created_at: { [Op.gte]: periodStartDate },
        },
      }),
      Order.count({
        where: {
          status: "delivered",
          created_at: { [Op.gte]: periodStartDate },
        },
      }),
    ]);

  const aov = deliveredOrders > 0 ? (totalRevenue || 0) / deliveredOrders : 0;
  const successRate =
    totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentOrders = await Order.count({
    where: {
      created_at: { [Op.gte]: sevenDaysAgo },
    },
  });

  const salesData = await Order.findAll({
    attributes: [
      [Sequelize.fn("DATE", Sequelize.col("created_at")), "date"],
      [Sequelize.fn("COUNT", Sequelize.col("order_id")), "order_count"],
      [Sequelize.fn("SUM", Sequelize.col("final_amount")), "total_revenue"],
    ],
    where: {
      created_at: { [Op.gte]: periodStartDate },
      status: "delivered",
    },
    group: [Sequelize.fn("DATE", Sequelize.col("created_at"))],
    order: [[Sequelize.fn("DATE", Sequelize.col("created_at")), "ASC"]],
    raw: true,
  });

  const orderStatusStats = await Order.findAll({
    attributes: [
      "status",
      [Sequelize.fn("COUNT", Sequelize.col("order_id")), "count"],
    ],
    group: ["status"],
    raw: true,
  });

  const lowStockAlertsRaw = await sequelize.query(
    `
      SELECT
        pv.variation_id,
        pv.sku,
        pv.stock_quantity,
        p.product_name,
        p.thumbnail_url
      FROM product_variations pv
      JOIN products p ON pv.product_id = p.product_id
      WHERE pv.stock_quantity > 0
        AND pv.is_available = true
        AND p.is_active = true
      ORDER BY pv.stock_quantity ASC
      LIMIT 10
    `,
    {
      type: Sequelize.QueryTypes.SELECT,
      raw: true,
    }
  );

  const lowStockAlerts = lowStockAlertsRaw.map((item) => ({
    variation_id: item.variation_id,
    sku: item.sku,
    stock_quantity: item.stock_quantity,
    "product.product_name": item.product_name,
    "product.thumbnail_url": item.thumbnail_url,
  }));

  const salesByCategory = await sequelize.query(
    `
      SELECT
        c.category_name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.price * oi.quantity) as total_revenue
      FROM order_items oi
      JOIN product_variations pv ON oi.variation_id = pv.variation_id
      JOIN products p ON pv.product_id = p.product_id
      JOIN categories c ON p.category_id = c.category_id
      GROUP BY c.category_id, c.category_name
      ORDER BY total_revenue DESC
      LIMIT 5
    `,
    {
      type: Sequelize.QueryTypes.SELECT,
      raw: true,
    }
  );

  const salesByBrand = await sequelize.query(
    `
      SELECT
        b.brand_name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.price * oi.quantity) as total_revenue
      FROM order_items oi
      JOIN product_variations pv ON oi.variation_id = pv.variation_id
      JOIN products p ON pv.product_id = p.product_id
      JOIN brands b ON p.brand_id = b.brand_id
      GROUP BY b.brand_id, b.brand_name
      ORDER BY total_revenue DESC
      LIMIT 5
    `,
    {
      type: Sequelize.QueryTypes.SELECT,
      raw: true,
    }
  );

  const topProducts = await sequelize.query(
    `
      SELECT
        pv.sku,
        pv.processor,
        pv.ram,
        pv.storage,
        p.product_name,
        p.thumbnail_url,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.price * oi.quantity) as total_revenue
      FROM order_items oi
      JOIN product_variations pv ON oi.variation_id = pv.variation_id
      JOIN products p ON pv.product_id = p.product_id
      GROUP BY pv.variation_id, pv.sku, pv.processor, pv.ram, pv.storage, p.product_id, p.product_name, p.thumbnail_url
      ORDER BY total_quantity DESC
      LIMIT 5
    `,
    {
      type: Sequelize.QueryTypes.SELECT,
      raw: true,
    }
  );

  const formattedTopProducts = topProducts.map((product) => ({
    sku: product.sku,
    processor: product.processor,
    ram: product.ram,
    storage: product.storage,
    total_quantity: product.total_quantity,
    total_revenue: product.total_revenue,
    "product.product_name": product.product_name,
    "product.thumbnail_url": product.thumbnail_url,
  }));

  return {
    totals: {
      users: totalUsers,
      products: totalProducts,
      orders: totalOrders,
      revenue: totalRevenue || 0,
      discount: totalDiscount || 0,
      aov: Math.round(aov),
      success_rate: Math.round(successRate * 100) / 100,
    },
    recent: {
      orders_last_7_days: recentOrders,
    },
    order_status_breakdown: orderStatusStats,
    low_stock_alerts: lowStockAlerts,
    sales_by_category: salesByCategory,
    sales_by_brand: salesByBrand,
    top_products: formattedTopProducts,
    sales_data: salesData,
  };
}

async function getSales({ period = "30" }) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));

  const salesData = await Order.findAll({
    attributes: [
      [Sequelize.fn("DATE", Sequelize.col("created_at")), "date"],
      [Sequelize.fn("COUNT", Sequelize.col("order_id")), "order_count"],
      [Sequelize.fn("SUM", Sequelize.col("final_amount")), "total_revenue"],
    ],
    where: {
      created_at: { [Op.gte]: startDate },
      status: "delivered",
    },
    group: [Sequelize.fn("DATE", Sequelize.col("created_at"))],
    order: [[Sequelize.fn("DATE", Sequelize.col("created_at")), "ASC"]],
    raw: true,
  });

  const currentMonth = new Date();
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const [currentMonthSales, lastMonthSales] = await Promise.all([
    Order.sum("final_amount", {
      where: {
        created_at: {
          [Op.gte]: new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth(),
            1
          ),
          [Op.lt]: new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth() + 1,
            1
          ),
        },
        status: "delivered",
      },
    }),
    Order.sum("final_amount", {
      where: {
        created_at: {
          [Op.gte]: new Date(
            lastMonth.getFullYear(),
            lastMonth.getMonth(),
            1
          ),
          [Op.lt]: new Date(
            lastMonth.getFullYear(),
            lastMonth.getMonth() + 1,
            1
          ),
        },
        status: "delivered",
      },
    }),
  ]);

  return {
    sales_data: salesData,
    comparison: {
      current_month: currentMonthSales || 0,
      last_month: lastMonthSales || 0,
      growth_percentage: lastMonthSales
        ? (
            ((currentMonthSales - lastMonthSales) / lastMonthSales) *
            100
          ).toFixed(2)
        : 0,
    },
  };
}

module.exports = {
  getDashboard,
  getSales,
};

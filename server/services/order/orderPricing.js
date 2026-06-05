const toVnd = (x) => Math.max(0, Math.round(Number(x) || 0));

/**
 * @param {{ variation: object, quantity: number }} line
 * @param {{ includeCatalogFields?: boolean, mode?: 'preview' | 'create' }} options
 */
function computeLineBreakdown(line, options = {}) {
  const { variation: v, quantity } = line;
  const { includeCatalogFields = false, mode = "preview" } = options;
  const qty = Math.max(1, Number(quantity || 1));
  const unit_price = Number(v.price);

  let unit_discount_amount;
  let unit_final_price;
  let item_total;
  let item_discount;
  let item_subtotal_after_discount;

  if (mode === "create") {
    const pct = Math.max(0, Number(v.product?.discount_percentage || 0));
    unit_discount_amount = Math.round((unit_price * pct) / 100);
    unit_final_price = Math.max(0, unit_price - unit_discount_amount);
    const itemTotal = unit_price * qty;
    item_discount = Math.round(unit_discount_amount * qty);
    item_total = Math.round(itemTotal);
    item_subtotal_after_discount = Math.max(
      0,
      Math.round(itemTotal - item_discount)
    );
  } else {
    unit_discount_amount = Math.max(
      0,
      Math.round(
        Number((unit_price * v.product?.discount_percentage) / 100 || 0)
      )
    );
    unit_final_price = Math.max(
      0,
      Math.round(unit_price - unit_discount_amount)
    );
    item_total = Math.round(unit_price * qty);
    item_discount = Math.round(unit_discount_amount * qty);
    item_subtotal_after_discount = Math.max(
      0,
      Math.round(unit_final_price * qty)
    );
  }

  const row = {
    variation_id: v.variation_id,
    product_name: v.product?.product_name || null,
    quantity: qty,
    unit_price: Math.round(unit_price),
    unit_discount_amount,
    unit_final_price,
    item_total,
    item_discount,
    item_subtotal_after_discount,
  };

  if (includeCatalogFields) {
    row.thumbnail_url = v.product?.thumbnail_url || null;
    row.slug = v.product?.slug || null;
  }

  return row;
}

/**
 * @param {Array<{ variation: object, quantity: number }>} lines
 * @param {{ stockMode?: 'strict' | 'warn', includeCatalogFields?: boolean }} options
 */
function buildOrderPricing(lines, options = {}) {
  const { stockMode = "strict", includeCatalogFields = false } = options;
  const mode = stockMode === "strict" ? "create" : "preview";
  const stock_warnings = [];
  const items_breakdown = [];
  let total_amount = 0;
  let discount_amount = 0;

  for (const line of lines) {
    const { variation: v, quantity } = line;
    const qty = Math.max(1, Number(quantity || 1));
    const available = Number(v.stock_quantity || 0);

    if (!v.is_available || available < qty) {
      if (stockMode === "strict") {
        const err = new Error(
          `Insufficient stock for ${
            v.product?.product_name || `variation ${v.variation_id}`
          }`
        );
        err.status = 400;
        throw err;
      }
      stock_warnings.push({
        variation_id: v.variation_id,
        message: `Only ${available} left in stock`,
      });
    }

    const breakdown = computeLineBreakdown(line, { includeCatalogFields, mode });
    items_breakdown.push(breakdown);

    if (mode === "create") {
      const price = Number(v.price);
      const pct = Math.max(0, Number(v.product?.discount_percentage || 0));
      total_amount += price * qty;
      discount_amount += Math.round(((price * pct) / 100) * qty);
    } else {
      total_amount += breakdown.item_total;
      discount_amount += breakdown.item_discount;
    }
  }

  const subtotal_after_discount =
    mode === "create"
      ? toVnd(total_amount - discount_amount)
      : Math.max(0, Math.round(total_amount - discount_amount));

  const result = {
    items_breakdown,
    total_amount,
    discount_amount,
    subtotal_after_discount,
  };

  if (stockMode === "warn") {
    result.stock_warnings = stock_warnings;
  }

  return result;
}

module.exports = {
  toVnd,
  computeLineBreakdown,
  buildOrderPricing,
};

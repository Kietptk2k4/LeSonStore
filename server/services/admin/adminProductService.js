const sequelize = require("../../config/database");
const { Product, ProductVariation, ProductImage } = require("../../models");

function throwHttp(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function parseVariationsJson(variationsString, { allowEmpty = false } = {}) {
  if (!variationsString && allowEmpty) return [];
  try {
    return variationsString ? JSON.parse(variationsString) : [];
  } catch {
    throwHttp(400, "Invalid variations data");
  }
}

function validatePrimaryVariation(variations) {
  if (!variations || variations.length === 0) {
    throwHttp(400, "At least one variation is required");
  }
  const primaryCount = variations.filter((v) => v.is_primary === true).length;
  if (primaryCount !== 1) {
    throwHttp(400, "Exactly one variation must be marked as primary");
  }
}

async function syncProductVariations({ productId, variations, transaction }) {
  const existingVariations = await ProductVariation.findAll({
    where: { product_id: productId },
    transaction,
  });

  const existingVariationIds = existingVariations.map((v) => v.variation_id);
  const incomingVariationIds = variations
    .filter((v) => v.variation_id)
    .map((v) => v.variation_id);

  const variationsToUpdate = variations.filter((v) => v.variation_id);
  const variationsToCreate = variations.filter((v) => !v.variation_id);
  const variationsToDelete = existingVariationIds.filter(
    (id) => !incomingVariationIds.includes(id)
  );

  for (const variation of variationsToUpdate) {
    await ProductVariation.update(
      {
        processor: variation.processor,
        ram: variation.ram,
        storage: variation.storage,
        graphics_card: variation.graphics_card,
        screen_size: variation.screen_size,
        color: variation.color,
        price: variation.price,
        stock_quantity: variation.stock_quantity,
        is_primary: variation.is_primary,
        sku: variation.sku,
      },
      {
        where: { variation_id: variation.variation_id },
        transaction,
      }
    );
  }

  if (variationsToCreate.length > 0) {
    const newVariationsData = variationsToCreate.map((v) => ({
      product_id: productId,
      processor: v.processor,
      ram: v.ram,
      storage: v.storage,
      graphics_card: v.graphics_card,
      screen_size: v.screen_size,
      color: v.color,
      price: v.price,
      stock_quantity: v.stock_quantity,
      is_primary: v.is_primary,
      sku: v.sku,
    }));
    await ProductVariation.bulkCreate(newVariationsData, { transaction });
  }

  if (variationsToDelete.length > 0) {
    await ProductVariation.destroy({
      where: {
        variation_id: variationsToDelete,
        product_id: productId,
      },
      transaction,
    });
  }
}

async function createProduct({ body, files }) {
  const transaction = await sequelize.transaction();

  try {
    const {
      product_name,
      slug,
      description,
      category_id,
      brand_id,
      discount_percentage,
      variations: variationsString,
    } = body;

    let variations;
    try {
      variations = JSON.parse(variationsString);
    } catch {
      await transaction.rollback();
      throwHttp(400, "Invalid variations data");
    }

    if (!variations || variations.length === 0) {
      await transaction.rollback();
      throwHttp(400, "At least one variation is required");
    }

    const primaryVariations = variations.filter((v) => v.is_primary === true);
    if (primaryVariations.length !== 1) {
      await transaction.rollback();
      throwHttp(400, "Exactly one variation must be marked as primary");
    }

    let thumbnail_url = null;
    if (files && files.thumbnail && files.thumbnail[0]) {
      thumbnail_url = files.thumbnail[0].path;
    }

    const product = await Product.create(
      {
        product_name,
        slug,
        description,
        category_id,
        brand_id,
        discount_percentage,
        thumbnail_url,
        is_active: true,
      },
      { transaction }
    );

    if (variations && variations.length > 0) {
      const variationData = variations.map((v) => ({
        ...v,
        product_id: product.product_id,
      }));
      await ProductVariation.bulkCreate(variationData, { transaction });
    }

    if (files && files.product_images && files.product_images.length > 0) {
      const imageData = files.product_images.map((file, index) => ({
        product_id: product.product_id,
        image_url: file.path,
        is_primary: false,
        display_order: index,
      }));
      await ProductImage.bulkCreate(imageData, { transaction });
    }

    await transaction.commit();

    return {
      statusCode: 201,
      body: {
        message: "Product created successfully",
        product,
      },
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function updateProduct({ productId, body, files }) {
  const transaction = await sequelize.transaction();

  try {
    const {
      product_name,
      slug,
      description,
      category_id,
      brand_id,
      discount_percentage,
      variations: variationsString,
    } = body;

    let variations = [];
    try {
      variations = variationsString ? JSON.parse(variationsString) : [];
    } catch {
      await transaction.rollback();
      throwHttp(400, "Invalid variations data");
    }

    const product = await Product.findByPk(productId);
    if (!product) {
      await transaction.rollback();
      throwHttp(404, "Product not found");
    }

    if (variations.length > 0) {
      const primaryVariations = variations.filter((v) => v.is_primary === true);
      if (primaryVariations.length !== 1) {
        await transaction.rollback();
        throwHttp(400, "Exactly one variation must be marked as primary");
      }
    }

    const updateData = {
      product_name,
      slug,
      description,
      category_id,
      brand_id,
      discount_percentage,
      is_active:
        body.is_active !== undefined ? body.is_active : product.is_active,
    };

    if (files && files.thumbnail && files.thumbnail[0]) {
      updateData.thumbnail_url = files.thumbnail[0].path;
    }

    await product.update(updateData, { transaction });

    if (variations.length > 0) {
      await syncProductVariations({ productId, variations, transaction });
    }

    if (body.deleted_image_ids) {
      let idsToDelete = body.deleted_image_ids;
      if (!Array.isArray(idsToDelete)) {
        idsToDelete = [idsToDelete];
      }

      await ProductImage.destroy({
        where: {
          image_id: idsToDelete,
          product_id: productId,
        },
        transaction,
      });
    }

    if (files && files.product_images && files.product_images.length > 0) {
      const newImages = files.product_images.map((file, index) => ({
        product_id: productId,
        image_url: file.path,
        is_primary: false,
        display_order: index,
      }));

      await ProductImage.bulkCreate(newImages, { transaction });
    }

    await transaction.commit();

    const updatedProduct = await Product.findByPk(productId, {
      include: [
        { model: ProductImage, as: "images" },
        { model: ProductVariation, as: "variations" },
      ],
    });

    return {
      statusCode: 200,
      body: {
        message: "Product updated successfully",
        product: updatedProduct,
      },
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function deleteProduct(productId) {
  const product = await Product.findByPk(productId);
  if (!product) {
    throwHttp(404, "Product not found");
  }

  await product.update({ is_active: false });

  return { body: { message: "Product deleted successfully" } };
}

async function createVariation({ productId, variationData }) {
  const product = await Product.findByPk(productId);
  if (!product) {
    throwHttp(404, "Product not found");
  }

  const variation = await ProductVariation.create({
    ...variationData,
    product_id: productId,
  });

  return {
    statusCode: 201,
    body: {
      message: "Variation created successfully",
      variation,
    },
  };
}

async function updateVariation({ variationId, updateData }) {
  const variation = await ProductVariation.findByPk(variationId);
  if (!variation) {
    throwHttp(404, "Variation not found");
  }

  await variation.update(updateData);

  return {
    body: {
      message: "Variation updated successfully",
      variation,
    },
  };
}

module.exports = {
  createProduct,
  updateProduct,
  deleteProduct,
  createVariation,
  updateVariation,
  throwHttp,
};

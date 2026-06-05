const { Product, ProductVariation, ProductImage, Category, Brand, Order, OrderItem, Payment, User, Role } = require("../models")
const { Op, Sequelize } = require("sequelize")
const sequelize = require("../config/database")
const { uploadProductFiles } = require("../middleware/upload")
const {
  applyTransition,
  emitStatusChanged,
} = require("../services/order/orderStateMachine")
const { registerOrderListeners } = require("../events/listeners")
const refundService = require("../services/order/refundService")
const adminProductService = require("../services/admin/adminProductService")
const analyticsService = require("../services/admin/analyticsService")

registerOrderListeners()

function sendServiceError(res, error) {
  return res.status(error.status).json({ message: error.message })
}

// Product Management
exports.createProduct = [
  uploadProductFiles,
  async (req, res, next) => {
    try {
      const result = await adminProductService.createProduct({
        body: req.body,
        files: req.files,
      })
      return res.status(result.statusCode).json(result.body)
    } catch (error) {
      if (error.status) return sendServiceError(res, error)
      next(error)
    }
  },
]

exports.updateProduct = [
  uploadProductFiles,
  async (req, res, next) => {
    try {
      const result = await adminProductService.updateProduct({
        productId: req.params.product_id,
        body: req.body,
        files: req.files,
      })
      return res.status(result.statusCode).json(result.body)
    } catch (error) {
      if (error.status) return sendServiceError(res, error)
      next(error)
    }
  },
]

exports.deleteProduct = async (req, res, next) => {
  try {
    const result = await adminProductService.deleteProduct(req.params.product_id)
    return res.json(result.body)
  } catch (error) {
    if (error.status) return sendServiceError(res, error)
    next(error)
  }
}

exports.createVariation = async (req, res, next) => {
  try {
    const result = await adminProductService.createVariation({
      productId: req.params.product_id,
      variationData: req.body,
    })
    return res.status(result.statusCode).json(result.body)
  } catch (error) {
    if (error.status) return sendServiceError(res, error)
    next(error)
  }
}

exports.updateVariation = async (req, res, next) => {
  try {
    const result = await adminProductService.updateVariation({
      variationId: req.params.variation_id,
      updateData: req.body,
    })
    return res.json(result.body)
  } catch (error) {
    if (error.status) return sendServiceError(res, error)
    next(error)
  }
}

// Order Management
exports.getAllOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query
    const offset = (page - 1) * limit

    const where = {}
    if (status) where.status = status

    const { count, rows } = await Order.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["user_id", "username", "email", "full_name", "phone_number"],
        },
        {
          model: Payment,
          as: "payment",
          attributes: ["payment_id", "payment_method", "payment_status", "provider"],
        },
      ],
      limit: Number.parseInt(limit),
      offset: Number.parseInt(offset),
      order: [["created_at", "DESC"]],
    })

    res.json({
      orders: rows,
      pagination: {
        total: count,
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        totalPages: Math.ceil(count / limit),
      },
    })
  } catch (error) {
    next(error)
  }
}

exports.getOrderDetail = async (req, res, next) => {
  try {
    const { order_id } = req.params

    const order = await Order.findOne({
      where: { order_id },
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
        },
        {
          model: User,
          as: "user",
          attributes: ["user_id", "username", "email", "full_name", "phone_number"],
        },
      ],
    })

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    res.json({ order })
  } catch (error) {
    next(error)
  }
}

exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { order_id } = req.params
    const { status } = req.body

    const order = await Order.findByPk(order_id)
    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    try {
      const { oldStatus, newStatus } = await applyTransition(order, status);
      emitStatusChanged(order, oldStatus, newStatus, {
        source: "admin_updateOrderStatus",
      });
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }

    res.json({
      message: "Order status updated successfully",
      order,
    })
  } catch (error) {
    next(error)
  }
}

// Ship order (processing -> shipping)
exports.shipOrder = async (req, res, next) => {
  try {
    const { order_id } = req.params

    const order = await Order.findByPk(order_id)
    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    try {
      const { oldStatus, newStatus } = await applyTransition(order, "shipping");
      emitStatusChanged(order, oldStatus, newStatus, { source: "admin_ship" });
    } catch (err) {
      if (err.status === 400 && order.status !== "processing") {
        return res
          .status(400)
          .json({ message: "Order must be in processing status to ship" });
      }
      if (err.status === 400) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }

    res.json({
      message: "Order shipped successfully",
      order,
    })
  } catch (error) {
    next(error)
  }
}

// Deliver order (shipping -> delivered)
exports.deliverOrder = async (req, res, next) => {
  try {
    const { order_id } = req.params

    const order = await Order.findByPk(order_id)
    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    try {
      const { oldStatus, newStatus } = await applyTransition(order, "delivered");
      emitStatusChanged(order, oldStatus, newStatus, { source: "admin_deliver" });
    } catch (err) {
      if (err.status === 400 && order.status !== "shipping") {
        return res
          .status(400)
          .json({ message: "Order must be in shipping status to deliver" });
      }
      if (err.status === 400) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }

    res.json({
      message: "Order delivered successfully",
      order,
    })
  } catch (error) {
    next(error)
  }
}

// Refund order (for cancelled VNPAY orders)
exports.refundOrder = async (req, res, next) => {
  try {
    const result = await refundService.processAdminRefund({
      orderId: req.params.order_id,
    });
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

// User Management
exports.getAllUsers = async (req, res, next) => {
  try {
    const { 
      page = 1, 
      limit = 20,
      // ĐỌC THÊM tham số sort và order từ query
      sort = "created_at", // Mặc định là created_at
      order = "DESC"      // Mặc định là DESC
    } = req.query

    const offset = (page - 1) * limit
    
    // Whitelist và kiểm tra các tham số sắp xếp
    const allowedSort = ["user_id", "username", "created_at", "last_login", "email"]
    const sortField = allowedSort.includes(sort) ? sort : "created_at"
    const sortOrder = ["ASC", "DESC"].includes(order.toUpperCase()) ? order.toUpperCase() : "DESC"

    const { count, rows } = await User.findAndCountAll({
      include: [
        {
          model: Role,
          through: { attributes: [] },
        },
      ],
      attributes: { exclude: ["password_hash"] },
      limit: Number.parseInt(limit),
      offset: Number.parseInt(offset),
      
      // ÁP DỤNG SẮP XẾP MỚI
      order: [[sortField, sortOrder]], 

    })

    res.json({
      users: rows,
      pagination: {
        total: count,
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        totalPages: Math.ceil(count / limit),
      },
    })
  } catch (error) {
    next(error)
  }
}

exports.updateUserStatus = async (req, res, next) => {
  try {
    const { user_id } = req.params
    const { is_active } = req.body

    const user = await User.findByPk(user_id)
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    await user.update({ is_active })

    res.json({
      message: "User status updated successfully",
      user,
    })
  } catch (error) {
    next(error)
  }
}

// Category Management

exports.getAllCategories = async (req, res, next) => {
  try {
    const categories = await Category.findAll({
      order: [["display_order", "ASC"]],
    })

    res.json({ categories })
  } catch (error) {
    next(error)
  }
}

exports.createCategory = [
  uploadProductFiles,
  async (req, res, next) => {
    try {
      const { category_name, description, display_order } = req.body

      // Auto generate slug
      const slug = category_name.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

      // Check if slug already exists
      const existingCategory = await Category.findOne({ where: { slug } })
      if (existingCategory) {
        return res.status(400).json({ message: "Slug already exists. Please choose a different category name." })
      }

      // Handle icon upload
      let icon_url = null
      if (req.files && req.files.thumbnail && req.files.thumbnail[0]) {
        icon_url = req.files.thumbnail[0].path
      }

      const category = await Category.create({
        category_name,
        slug,
        description,
        display_order: display_order || 0,
        icon_url,
      })

      res.status(201).json({
        message: "Category created successfully",
        category,
      })
    } catch (error) {
      next(error)
    }
  }
]

exports.updateCategory = [
  uploadProductFiles,
  async (req, res, next) => {
    try {
      const { category_id } = req.params
      const { category_name, description, display_order } = req.body

      const category = await Category.findByPk(category_id)
      if (!category) {
        return res.status(404).json({ message: "Category not found" })
      }

      const updateData = {
        description,
        display_order: display_order || 0
      }

      // Update category_name and slug if changed
      if (category_name && category_name !== category.category_name) {
        const slug = category_name.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

        // Check if new slug conflicts with other categories
        const existingCategory = await Category.findOne({
          where: { slug, category_id: { [Op.ne]: category_id } }
        })
        if (existingCategory) {
          return res.status(400).json({ message: "Slug already exists. Please choose a different category name." })
        }

        updateData.category_name = category_name
        updateData.slug = slug
      }

      // Handle icon upload
      if (req.files && req.files.thumbnail && req.files.thumbnail[0]) {
        updateData.icon_url = req.files.thumbnail[0].path
      }

      await category.update(updateData)

      res.json({
        message: "Category updated successfully",
        category,
      })
    } catch (error) {
      next(error)
    }
  }
]

exports.deleteCategory = async (req, res, next) => {
  try {
    const { category_id } = req.params

    const category = await Category.findByPk(category_id)
    if (!category) {
      return res.status(404).json({ message: "Category not found" })
    }

    // Kiểm tra xem có sản phẩm nào thuộc category này không (Nếu có, bạn nên ngăn chặn hoặc chuyển sản phẩm)
    const productCount = await category.countProducts()
    if (productCount > 0) {
        return res.status(400).json({ message: "Cannot delete category with associated products" })
    }

    await category.destroy()

    res.json({ message: "Category deleted successfully" })
  } catch (error) {
    next(error)
  }
}

// Brand Management
exports.createBrand = async (req, res, next) => {
  try {
    const brand = await Brand.create(req.body)

    res.status(201).json({
      message: "Brand created successfully",
      brand,
    })
  } catch (error) {
    next(error)
  }
}

exports.updateBrand = async (req, res, next) => {
  try {
    const { brand_id } = req.params

    const brand = await Brand.findByPk(brand_id)
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" })
    }

    await brand.update(req.body)

    res.json({
      message: "Brand updated successfully",
      brand,
    })
  } catch (error) {
    next(error)
  }
}

// Role Management
exports.getAllRoles = async (req, res, next) => {
  try {
    const roles = await Role.findAll({
      include: [
        {
          model: User,
          through: { attributes: [] },
        },
      ],
    })

    res.json({ roles })
  } catch (error) {
    next(error)
  }
}

exports.createRole = async (req, res, next) => {
  try {
    const { role_name, description } = req.body

    const role = await Role.create({ role_name, description })

    res.status(201).json({
      message: "Role created successfully",
      role,
    })
  } catch (error) {
    next(error)
  }
}

exports.updateRole = async (req, res, next) => {
  try {
    const { role_id } = req.params

    const role = await Role.findByPk(role_id)
    if (!role) {
      return res.status(404).json({ message: "Role not found" })
    }

    await role.update(req.body)

    res.json({
      message: "Role updated successfully",
      role,
    })
  } catch (error) {
    next(error)
  }
}

exports.deleteRole = async (req, res, next) => {
  try {
    const { role_id } = req.params

    const role = await Role.findByPk(role_id)
    if (!role) {
      return res.status(404).json({ message: "Role not found" })
    }

    // Check if role is assigned to users
    const userCount = await role.countUsers()
    if (userCount > 0) {
      return res.status(400).json({ message: "Cannot delete role with assigned users" })
    }

    await role.destroy()

    res.json({ message: "Role deleted successfully" })
  } catch (error) {
    next(error)
  }
}

exports.updateUserRoles = async (req, res, next) => {
  try {
    const { user_id } = req.params
    const { role_ids } = req.body

    const user = await User.findByPk(user_id)
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    const roles = await Role.findAll({ where: { role_id: role_ids } })
    await user.setRoles(roles)

    res.json({
      message: "User roles updated successfully",
      user: {
        user_id: user.user_id,
        username: user.username,
        roles: roles.map(r => ({ role_id: r.role_id, role_name: r.role_name })),
      },
    })
  } catch (error) {
    next(error)
  }
}

// Analytics & Dashboard
exports.getDashboardAnalytics = async (req, res, next) => {
  try {
    const data = await analyticsService.getDashboard({ period: req.query.period })
    return res.json(data)
  } catch (error) {
    next(error)
  }
}

exports.getSalesAnalytics = async (req, res, next) => {
  try {
    const data = await analyticsService.getSales({ period: req.query.period })
    return res.json(data)
  } catch (error) {
    next(error)
  }
}

// Brand Management
exports.getAllBrands = async (req, res, next) => {
  try {
    const brands = await Brand.findAll({
      order: [["brand_name", "ASC"]],
    })

    res.json({ brands })
  } catch (error) {
    next(error)
  }
}

exports.getBrandById = async (req, res, next) => {
  try {
    const { brand_id } = req.params

    const brand = await Brand.findByPk(brand_id)
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" })
    }

    res.json({ brand })
  } catch (error) {
    next(error)
  }
}

exports.createBrand = [
  uploadProductFiles,
  async (req, res, next) => {
    try {
      const { brand_name, description } = req.body

      // Auto generate slug
      const slug = brand_name.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

      // Check if slug already exists
      const existingBrand = await Brand.findOne({ where: { slug } })
      if (existingBrand) {
        return res.status(400).json({ message: "Slug already exists. Please choose a different brand name." })
      }

      // Handle logo upload
      let logo_url = null
      if (req.files && req.files.thumbnail && req.files.thumbnail[0]) {
        logo_url = req.files.thumbnail[0].path
      }

      const brand = await Brand.create({
        brand_name,
        slug,
        description,
        logo_url,
      })

      res.status(201).json({
        message: "Brand created successfully",
        brand,
      })
    } catch (error) {
      next(error)
    }
  }
]

exports.updateBrand = [
  uploadProductFiles,
  async (req, res, next) => {
    try {
      const { brand_id } = req.params
      const { brand_name, description } = req.body

      const brand = await Brand.findByPk(brand_id)
      if (!brand) {
        return res.status(404).json({ message: "Brand not found" })
      }

      const updateData = { description }

      // Update brand_name and slug if changed
      if (brand_name && brand_name !== brand.brand_name) {
        const slug = brand_name.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

        // Check if new slug conflicts with other brands
        const existingBrand = await Brand.findOne({
          where: { slug, brand_id: { [Op.ne]: brand_id } }
        })
        if (existingBrand) {
          return res.status(400).json({ message: "Slug already exists. Please choose a different brand name." })
        }

        updateData.brand_name = brand_name
        updateData.slug = slug
      }

      // Handle logo upload
      if (req.files && req.files.thumbnail && req.files.thumbnail[0]) {
        updateData.logo_url = req.files.thumbnail[0].path
      }

      await brand.update(updateData)

      res.json({
        message: "Brand updated successfully",
        brand,
      })
    } catch (error) {
      next(error)
    }
  }
]

exports.deleteBrand = async (req, res, next) => {
  try {
    const { brand_id } = req.params

    const brand = await Brand.findByPk(brand_id)
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" })
    }

    // Check if brand is being used by any products
    const productCount = await brand.countProducts()
    if (productCount > 0) {
      return res.status(400).json({
        message: `Cannot delete brand "${brand.brand_name}" because it is associated with ${productCount} product(s). Please reassign or remove these products first.`
      })
    }

    await brand.destroy()

    res.json({ message: "Brand deleted successfully" })
  } catch (error) {
    next(error)
  }
}

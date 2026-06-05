const catalogService = require("../services/product/catalogService");
const qaService = require("../services/product/qaService");

function sendServiceError(res, error) {
  const payload = { message: error.message };
  if (error.payload) Object.assign(payload, error.payload);
  return res.status(error.status).json(payload);
}

exports.getProductFacets = async (req, res, next) => {
  try {
    const result = await catalogService.getFacets();
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getProductsV2 = async (req, res, next) => {
  try {
    const result = await catalogService.listProductsV2(req.query);
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getProducts = async (req, res, next) => {
  try {
    const result = await catalogService.listProductsLegacy(req.query);
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getProductDetail = async (req, res, next) => {
  try {
    const result = await catalogService.getProductDetail(req.params.id);
    return res.json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

exports.getSearchSuggestions = async (req, res, next) => {
  try {
    const result = await catalogService.getSearchSuggestions(req.query.q);
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getRecommendedByVariation = async (req, res) => {
  try {
    const result = await catalogService.getRecommendationsByVariation(
      Number(req.params.variation_id)
    );
    return res.status(result.statusCode).json(result.body);
  } catch (e) {
    console.error("getRecommendedByVariation EX:", e);
    const variationId = Number(req.params.variation_id);
    return res.status(502).json({
      products: [],
      basedOn: { variationId },
      source: "knn",
      error: "adapter_exception",
      detail: { message: e.message },
    });
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const result = await catalogService.listCategories();
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getBrands = async (req, res, next) => {
  try {
    const result = await catalogService.listBrands();
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.compareProducts = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids
      : String(req.query.ids || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    const result = await catalogService.compareProducts(ids);
    return res.json(result);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

exports.createQuestion = async (req, res, next) => {
  try {
    const result = await qaService.createProductQuestion({
      productKey: req.params.id,
      userId: req.user.user_id,
      question_text: req.body.question_text,
      parent_question_id: req.body.parent_question_id,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    if (error?.name === "SequelizeUniqueConstraintError") {
      return res
        .status(409)
        .json({ message: "This question already has a follow-up" });
    }
    next(error);
  }
};

exports.getGlobalQuestions = async (req, res, next) => {
  try {
    const result = await qaService.listGlobalQuestions(req.query);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.json(result.body);
  } catch (err) {
    next(err);
  }
};

exports.createGlobalQuestion = async (req, res, next) => {
  try {
    const result = await qaService.createGlobalQuestion({
      userId: req.user.user_id,
      question_text: req.body.question_text,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

exports.createAnswer = async (req, res, next) => {
  try {
    const result = await qaService.createAnswer({
      questionId: req.params.question_id,
      userId: req.user.user_id,
      roles: req.user.Roles,
      answer_text: req.body.answer_text,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    if (error?.name === "SequelizeUniqueConstraintError") {
      return res
        .status(409)
        .json({ message: "This question already has an answer" });
    }
    next(error);
  }
};

exports.getProductQuestions = async (req, res, next) => {
  try {
    const result = await qaService.listProductQuestions({
      productKey: req.params.id,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

exports.updateQuestion = async (req, res, next) => {
  try {
    const result = await qaService.updateQuestion({
      questionId: req.params.question_id,
      userId: req.user.user_id,
      roles: req.user.Roles,
      question_text: req.body.question_text,
    });
    return res.json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

exports.deleteQuestion = async (req, res, next) => {
  try {
    const result = await qaService.deleteQuestion({
      questionId: req.params.question_id,
      userId: req.user.user_id,
      roles: req.user.Roles,
    });
    return res.json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

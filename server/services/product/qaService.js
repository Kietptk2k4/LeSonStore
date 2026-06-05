const notificationService = require("../notificationService");
const {
  Product,
  Question,
  Answer,
  User,
  Role,
} = require("../../models");

function throwHttp(status, message, payload) {
  const err = new Error(message);
  err.status = status;
  if (payload) err.payload = payload;
  throw err;
}

function getRoleNames(roles) {
  return (roles || []).map((r) => r.role_name);
}

function isStaff(roles) {
  const names = getRoleNames(roles);
  return names.includes("admin") || names.includes("staff");
}

async function createProductQuestion({
  productKey,
  userId,
  question_text,
  parent_question_id,
}) {
  if (!question_text || !question_text.trim()) {
    throwHttp(400, "question_text is required");
  }

  const whereKey = /^\d+$/.test(String(productKey))
    ? { product_id: productKey }
    : { slug: productKey };

  const product = await Product.findOne({
    where: whereKey,
    attributes: ["product_id", "product_name"],
  });

  if (!product) throwHttp(404, "Product not found");

  let parent = null;
  if (parent_question_id) {
    parent = await Question.findByPk(parent_question_id, {
      attributes: ["question_id", "product_id", "parent_question_id"],
    });

    if (!parent) {
      throwHttp(404, "Parent question not found");
    }
    if (parent.parent_question_id) {
      throwHttp(400, "Only one follow-up level is allowed");
    }
    if (parent.product_id !== product.product_id) {
      throwHttp(400, "Parent question does not belong to this product");
    }
    const answered = await Answer.findOne({
      where: { question_id: parent.question_id },
    });
    if (!answered) {
      throwHttp(400, "Parent must be answered before follow-up");
    }
  }

  const q = await Question.create({
    product_id: product.product_id,
    user_id: userId,
    question_text: question_text.trim(),
    is_answered: false,
    parent_question_id: parent_question_id || null,
  });

  const withUser = await Question.findByPk(q.question_id, {
    attributes: [
      "question_id",
      "question_text",
      "is_answered",
      "created_at",
      "parent_question_id",
    ],
    include: [
      {
        model: User,
        as: "user",
        attributes: ["user_id", "username", "full_name"],
      },
    ],
  });

  try {
    const notifTitle = parent_question_id ? "Phản hồi mới 💬" : "Câu hỏi mới ❓";
    const notifMessage = parent_question_id
      ? `Khách hàng phản hồi câu trả lời tại sản phẩm: ${product.product_name}`
      : `Có câu hỏi mới về sản phẩm: ${product.product_name}`;

    const staffUsers = await User.findAll({
      attributes: ["user_id"],
      include: [
        {
          model: Role,
          as: "Roles",
          where: { role_name: ["admin", "staff"] },
          required: true,
        },
      ],
    });

    if (staffUsers.length > 0) {
      const notiPromises = staffUsers.map((staff) =>
        notificationService.createNotification({
          userId: staff.user_id,
          title: notifTitle,
          message: notifMessage,
          type: "new_question",
          relatedType: "product",
          relatedId: product.product_id,
        })
      );
      await Promise.all(notiPromises);
    }
  } catch (notifError) {
    console.error(">>> [DEBUG] Lỗi gửi thông báo:", notifError);
  }

  return { statusCode: 201, body: { question: withUser } };
}

async function listGlobalQuestions(query) {
  const page = Math.max(1, parseInt(query.page || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(query.limit || "3", 10)));
  const offset =
    query.offset != null
      ? Math.max(0, parseInt(query.offset || "0", 10))
      : (page - 1) * limit;

  const where = { parent_question_id: null };

  const { count, rows } = await Question.findAndCountAll({
    where,
    attributes: [
      "question_id",
      "product_id",
      "question_text",
      "is_answered",
      "created_at",
      "parent_question_id",
    ],
    include: [
      {
        model: User,
        as: "user",
        attributes: ["user_id", "username", "full_name"],
      },
      {
        model: Product,
        as: "product",
        attributes: ["product_id", "product_name", "slug"],
        required: false,
      },
      {
        model: Answer,
        as: "answers",
        attributes: ["answer_id", "answer_text", "created_at"],
        include: [
          {
            model: User,
            as: "user",
            attributes: ["user_id", "username", "full_name"],
          },
        ],
      },
    ],
    order: [
      ["created_at", "DESC"],
      [{ model: Answer, as: "answers" }, "created_at", "ASC"],
    ],
    limit,
    offset,
    distinct: true,
  });

  return {
    body: {
      questions: rows,
      total: count,
      page,
      limit,
      offset,
      totalPages: Math.max(1, Math.ceil(count / limit)),
    },
  };
}

async function createGlobalQuestion({ userId, question_text }) {
  if (!question_text || !question_text.trim()) {
    throwHttp(400, "question_text is required");
  }

  const q = await Question.create({
    product_id: null,
    user_id: userId,
    question_text: question_text.trim(),
    is_answered: false,
    parent_question_id: null,
  });

  const withUser = await Question.findByPk(q.question_id, {
    attributes: [
      "question_id",
      "product_id",
      "question_text",
      "is_answered",
      "created_at",
      "parent_question_id",
    ],
    include: [
      {
        model: User,
        as: "user",
        attributes: ["user_id", "username", "full_name"],
      },
    ],
  });

  return { statusCode: 201, body: { question: withUser } };
}

async function createAnswer({ questionId, userId, roles, answer_text }) {
  if (!answer_text || !answer_text.trim()) {
    throwHttp(400, "answer_text is required");
  }

  if (!isStaff(roles)) {
    throwHttp(403, "Only staff can answer");
  }

  const q = await Question.findByPk(questionId);
  if (!q) throwHttp(404, "Question not found");

  const existed = await Answer.findOne({
    where: { question_id: q.question_id },
  });
  if (existed) {
    throwHttp(409, "This question already has an answer");
  }

  const a = await Answer.create({
    question_id: q.question_id,
    user_id: userId,
    answer_text: answer_text.trim(),
  });

  if (!q.is_answered) await q.update({ is_answered: true });

  const withUser = await Answer.findByPk(a.answer_id, {
    attributes: ["answer_id", "answer_text", "created_at"],
    include: [
      {
        model: User,
        as: "user",
        attributes: ["user_id", "username", "full_name"],
      },
    ],
  });

  const question = await Question.findByPk(questionId);

  if (question.user_id) {
    notificationService.createNotification({
      userId: question.user_id,
      title: "Phản hồi mới",
      message: "Admin đã trả lời câu hỏi của bạn.",
      type: "new_answer",
      relatedType: "product",
      relatedId: question.product_id,
    });
  }

  return { statusCode: 201, body: { answer: withUser } };
}

async function listProductQuestions({ productKey, page: pageIn, limit: limitIn }) {
  const page = Math.max(1, parseInt(pageIn || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(limitIn || "10", 10)));
  const offset = (page - 1) * limit;

  const whereKey = /^\d+$/.test(String(productKey))
    ? { product_id: productKey }
    : { slug: productKey };
  const product = await Product.findOne({
    where: whereKey,
    attributes: ["product_id"],
  });
  if (!product) throwHttp(404, "Product not found");

  const { count, rows } = await Question.findAndCountAll({
    where: { product_id: product.product_id },
    attributes: ["question_id", "question_text", "is_answered", "created_at"],
    include: [
      {
        model: User,
        as: "user",
        attributes: ["user_id", "username", "full_name"],
      },
      {
        model: Answer,
        as: "answers",
        attributes: ["answer_id", "answer_text", "created_at"],
        include: [
          {
            model: User,
            as: "user",
            attributes: ["user_id", "username", "full_name"],
          },
        ],
      },
    ],
    order: [
      ["created_at", "DESC"],
      [{ model: Answer, as: "answers" }, "created_at", "ASC"],
    ],
    limit,
    offset,
  });

  return {
    body: {
      questions: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    },
  };
}

async function updateQuestion({ questionId, userId, roles, question_text }) {
  if (!question_text || !question_text.trim()) {
    throwHttp(400, "question_text is required");
  }

  const q = await Question.findByPk(questionId);
  if (!q) throwHttp(404, "Question not found");

  const isOwner = q.user_id === userId;
  if (!isOwner && !isStaff(roles)) {
    throwHttp(403, "Insufficient permissions");
  }

  await q.update({ question_text: question_text.trim() });
  return { body: { question: q } };
}

async function deleteQuestion({ questionId, userId, roles }) {
  const q = await Question.findByPk(questionId);
  if (!q) throwHttp(404, "Question not found");

  const isOwner = q.user_id === userId;
  if (!isOwner && !isStaff(roles)) {
    throwHttp(403, "Insufficient permissions");
  }

  await Answer.destroy({ where: { question_id: q.question_id } });
  await q.destroy();
  return { body: { ok: true } };
}

module.exports = {
  createProductQuestion,
  listGlobalQuestions,
  createGlobalQuestion,
  createAnswer,
  listProductQuestions,
  updateQuestion,
  deleteQuestion,
  throwHttp,
};

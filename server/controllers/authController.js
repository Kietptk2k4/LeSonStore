// server/controllers/authController.js
const { validationResult } = require("express-validator");
const authService = require("../services/auth/authService");

function sendServiceError(res, error) {
  const payload = { message: error.message };
  if (error.payload) Object.assign(payload, error.payload);
  return res.status(error.status).json(payload);
}

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const result = await authService.register({ body: req.body });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

exports.registerEmailVerification = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const result = await authService.registerWithEmailVerification({
      body: req.body,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { redirectUrl } = await authService.verifyEmailAndIssueSession(
      req.query.token
    );
    return res.redirect(redirectUrl);
  } catch (_) {
    const fe =
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      "http://localhost:3000";
    return res.redirect(`${fe.replace(/\/$/, "")}/login?verify=error`);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const result = await authService.forgotPassword({ email: req.body.email });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    next(error);
  }
};

exports.resetPasswordRedirect = async (req, res) => {
  try {
    const { redirectUrl } = await authService.validateResetTokenForRedirect(
      req.query.token
    );
    return res.redirect(redirectUrl);
  } catch (_) {
    const fe =
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      "http://localhost:3000";
    return res.redirect(
      `${fe.replace(/\/$/, "")}/login?mode=reset&error=error`
    );
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const result = await authService.resetPassword({
      token: req.body.token,
      password: req.body.password,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const result = await authService.login(req.body);
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error.status) return sendServiceError(res, error);
    next(error);
  }
};

exports.getCurrentUser = async (req, res, next) => {
  try {
    const result = await authService.getCurrentUser(req.user.user_id);
    return res.json(result.body);
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const result = await authService.updateProfile({
      user: req.user,
      body: req.body,
    });
    return res.json(result.body);
  } catch (error) {
    next(error);
  }
};

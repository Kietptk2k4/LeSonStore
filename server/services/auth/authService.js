const jwt = require("jsonwebtoken");
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch (_) {
  nodemailer = null;
}
const { Op } = require("sequelize");
const { User, Role, Cart } = require("../../models");

const JWT_SECRET = () => process.env.JWT_SECRET || "your-secret-key";

function throwHttp(status, message, payload) {
  const err = new Error(message);
  err.status = status;
  if (payload) err.payload = payload;
  throw err;
}

function getFrontendBaseUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function getApiBaseUrl() {
  return (process.env.API_PUBLIC_URL || "http://localhost:5000").replace(
    /\/$/,
    ""
  );
}

function generateSessionToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET(), { expiresIn: "7d" });
}

function signPurposeToken({ purpose, userId, email, expiresIn }) {
  return jwt.sign({ purpose, userId, email }, JWT_SECRET(), { expiresIn });
}

function makeMailTransporter() {
  if (!nodemailer) {
    return null;
  }
  const host = process.env.EMAIL_HOST;
  const port = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : undefined;
  const secure = String(process.env.EMAIL_SECURE || "").toLowerCase() === "true";
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!host || !port || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

async function sendAuthEmail({ to, subject, text, html }) {
  const transporter = makeMailTransporter();
  if (!transporter) {
    console.log("[MAIL] Missing EMAIL_* env. Skip sending to:", to);
    console.log("[MAIL] Subject:", subject);
    if (text) console.log("[MAIL] Text:\n", text);
    return { skipped: true };
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  await transporter.sendMail({ from, to, subject, text, html });
  return { sent: true };
}

function mapUserForAuthResponse(user, roles) {
  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    phone_number: user.phone_number,
    avatar_url: user.avatar_url,
    roles,
  };
}

async function checkDuplicateUser({ username, email, phone_number }) {
  const existing = await User.findOne({
    where: { [Op.or]: [{ username }, { email }, { phone_number }] },
    attributes: ["username", "email", "phone_number"],
  });
  if (!existing) return null;

  const dupErrors = [];
  if (existing.username === username) {
    dupErrors.push({
      field: "username",
      code: "DUPLICATE_USERNAME",
      message: "Username already taken",
    });
  }
  if (existing.email === email) {
    dupErrors.push({
      field: "email",
      code: "DUPLICATE_EMAIL",
      message: "Email already registered",
    });
  }
  if (existing.phone_number === phone_number) {
    dupErrors.push({
      field: "phone_number",
      code: "DUPLICATE_PHONE",
      message: "Phone number already registered",
    });
  }
  return dupErrors;
}

async function provisionNewUser(user) {
  const customerRole = await Role.findOne({ where: { role_name: "customer" } });
  if (customerRole) await user.addRole(customerRole);
  await Cart.create({ user_id: user.user_id });
}

async function createUserAccount({
  username,
  email,
  password,
  full_name,
  phone_number,
  is_active,
}) {
  const dupErrors = await checkDuplicateUser({ username, email, phone_number });
  if (dupErrors) {
    throwHttp(409, "Duplicate entry", { errors: dupErrors });
  }

  const createPayload = {
    username,
    email,
    password_hash: password,
    full_name,
    phone_number,
  };
  if (is_active !== undefined) {
    createPayload.is_active = is_active;
  }

  const user = await User.create(createPayload);
  await provisionNewUser(user);
  return user;
}

async function register({ body }) {
  const { username, email, password, full_name, phone_number } = body;
  const user = await createUserAccount({
    username,
    email,
    password,
    full_name,
    phone_number,
  });

  const token = generateSessionToken(user.user_id);
  const roles = ["customer"];

  return {
    statusCode: 201,
    body: {
      message: "User registered successfully",
      token,
      user: mapUserForAuthResponse(user, roles),
    },
  };
}

async function registerWithEmailVerification({ body }) {
  const { username, email, password, full_name, phone_number } = body;
  const user = await createUserAccount({
    username,
    email,
    password,
    full_name,
    phone_number,
    is_active: false,
  });

  const token = signPurposeToken({
    purpose: "email_verify",
    userId: user.user_id,
    email: user.email,
    expiresIn: process.env.EMAIL_VERIFY_EXPIRES_IN || "24h",
  });

  const verifyUrl = `${getApiBaseUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

  const subject = "Xác nhận tài khoản";
  const text = `Hệ thống đã nhận yêu cầu đăng ký tài khoản.\n\nVui lòng bấm link sau để xác nhận: ${verifyUrl}`;
  const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <p>Hệ thống đã nhận yêu cầu đăng ký tài khoản.</p>
        <p>Vui lòng bấm nút bên dưới để xác nhận tạo tài khoản:</p>
        <p>
          <a href="${verifyUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
            Xác nhận
          </a>
        </p>
        <p>Nếu bạn không yêu cầu đăng ký, vui lòng bỏ qua email này.</p>
      </div>
    `;

  await sendAuthEmail({ to: user.email, subject, text, html });

  return {
    statusCode: 201,
    body: {
      message: "Verification email sent",
      email: user.email,
    },
  };
}

async function verifyEmailAndIssueSession(token) {
  const fe = getFrontendBaseUrl();
  try {
    const t = String(token || "");
    if (!t) {
      return { redirectUrl: `${fe}/login?verify=missing` };
    }

    let decoded;
    try {
      decoded = jwt.verify(t, JWT_SECRET());
    } catch (_) {
      return { redirectUrl: `${fe}/login?verify=invalid` };
    }

    if (decoded?.purpose !== "email_verify" || !decoded?.userId) {
      return { redirectUrl: `${fe}/login?verify=invalid` };
    }

    const user = await User.findByPk(decoded.userId);
    if (!user) {
      return { redirectUrl: `${fe}/login?verify=notfound` };
    }

    if (!user.is_active) {
      await user.update({ is_active: true });
    }

    const sessionToken = generateSessionToken(user.user_id);
    return {
      redirectUrl: `${fe}/oauth/success?token=${encodeURIComponent(sessionToken)}`,
    };
  } catch (_) {
    return { redirectUrl: `${fe}/login?verify=error` };
  }
}

async function forgotPassword({ email }) {
  const trimmed = String(email || "").trim();
  const user = await User.findOne({ where: { email: trimmed } });
  if (user) {
    const token = signPurposeToken({
      purpose: "password_reset",
      userId: user.user_id,
      email: user.email,
      expiresIn: process.env.PASSWORD_RESET_EXPIRES_IN || "15m",
    });

    const verifyUrl = `${getApiBaseUrl()}/api/auth/reset-password/verify?token=${encodeURIComponent(token)}`;
    const subject = "Đặt lại mật khẩu";
    const text = `Bạn đã yêu cầu đặt lại mật khẩu.\n\nBấm link sau để tiếp tục: ${verifyUrl}`;
    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <p>Bạn đã yêu cầu đặt lại mật khẩu.</p>
          <p>Bấm nút bên dưới để đặt mật khẩu mới:</p>
          <p>
            <a href="${verifyUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
              Xác nhận thay đổi mật khẩu
            </a>
          </p>
          <p>Nếu bạn không yêu cầu, vui lòng bỏ qua email này.</p>
        </div>
      `;
    await sendAuthEmail({ to: user.email, subject, text, html });
  }

  return {
    statusCode: 200,
    body: { message: "If the email exists, a reset link has been sent" },
  };
}

async function validateResetTokenForRedirect(token) {
  const fe = getFrontendBaseUrl();
  try {
    const t = String(token || "");
    if (!t) {
      return { redirectUrl: `${fe}/login?mode=reset&error=missing` };
    }
    try {
      const decoded = jwt.verify(t, JWT_SECRET());
      if (decoded?.purpose !== "password_reset" || !decoded?.userId) {
        return { redirectUrl: `${fe}/login?mode=reset&error=invalid` };
      }
    } catch (_) {
      return { redirectUrl: `${fe}/login?mode=reset&error=invalid` };
    }
    return {
      redirectUrl: `${fe}/login?mode=reset&token=${encodeURIComponent(t)}`,
    };
  } catch (_) {
    return { redirectUrl: `${fe}/login?mode=reset&error=error` };
  }
}

async function resetPassword({ token, password }) {
  const t = String(token || "");
  if (!t) {
    throwHttp(400, "Missing token");
  }

  let decoded;
  try {
    decoded = jwt.verify(t, JWT_SECRET());
  } catch (_) {
    throwHttp(400, "Invalid or expired token");
  }

  if (decoded?.purpose !== "password_reset" || !decoded?.userId) {
    throwHttp(400, "Invalid token");
  }

  const user = await User.findByPk(decoded.userId);
  if (!user) {
    throwHttp(404, "User not found");
  }

  await user.update({ password_hash: password });

  return {
    statusCode: 200,
    body: { message: "Password updated successfully" },
  };
}

async function login({ username, password }) {
  const user = await User.findOne({
    where: { username },
    include: [
      {
        model: Role,
        through: { attributes: [] },
      },
    ],
  });

  if (!user) {
    throwHttp(401, "Invalid username or password");
  }

  const isValidPassword = await user.comparePassword(password);
  if (!isValidPassword) {
    throwHttp(401, "Invalid username or password");
  }

  if (!user.is_active) {
    throwHttp(403, "Account is inactive");
  }

  await user.update({ last_login: new Date() });

  const token = generateSessionToken(user.user_id);
  const roles = user.Roles.map((r) => r.role_name);

  return {
    statusCode: 200,
    body: {
      message: "Login successful",
      token,
      user: mapUserForAuthResponse(user, roles),
    },
  };
}

async function getCurrentUser(userId) {
  const user = await User.findByPk(userId, {
    include: [
      {
        model: Role,
        through: { attributes: [] },
      },
    ],
    attributes: { exclude: ["password_hash"] },
  });

  return {
    body: {
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        phone_number: user.phone_number,
        address: user.address,
        avatar_url: user.avatar_url,
        roles: user.Roles.map((role) => role.role_name),
      },
    },
  };
}

async function updateProfile({ user, body }) {
  const { full_name, phone_number, address, avatar_url } = body;

  await user.update({
    full_name,
    phone_number,
    address,
    avatar_url,
  });

  return {
    body: {
      message: "Profile updated successfully",
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        phone_number: user.phone_number,
        address: user.address,
        avatar_url: user.avatar_url,
      },
    },
  };
}

module.exports = {
  register,
  registerWithEmailVerification,
  verifyEmailAndIssueSession,
  forgotPassword,
  validateResetTokenForRedirect,
  resetPassword,
  login,
  getCurrentUser,
  updateProfile,
  throwHttp,
};

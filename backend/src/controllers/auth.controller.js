const bcrypt = require("bcrypt");
const { z } = require("zod");
const User = require("../models/User");
const LoginActivity = require("../models/LoginActivity");
const { AppError } = require("../utils/errors");
const { isUserAdmin } = require("../utils/adminAccess");
const { buildLockDetails, normalizeRestrictions } = require("../utils/accountModeration");
const { getJwtExpiresIn, signAccessToken } = require("../utils/authToken");
const { hashPassword } = require("../utils/passwords");

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(30),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const loginSchema = z.object({
  login: z.string().trim().min(1, "Email or username is required").optional(),
  email: z.string().trim().optional(),
  password: z.string().min(1, "Password is required"),
});

function signToken(user) {
  const role = isUserAdmin(user) ? "admin" : "user";
  return signAccessToken(
    {
      sub: String(user._id),
      username: user.username,
      email: user.email,
      role,
    },
  );
}

function serializeModerationState(user) {
  return {
    isVerified: Boolean(user?.isVerified),
    verifiedAt: user?.verifiedAt || null,
    verifiedBy: String(user?.verifiedBy || ""),
    strikesCount: Number(user?.strikesCount) || 0,
    accountLocked: Boolean(user?.accountLocked),
    accountLockedAt: user?.accountLockedAt || null,
    accountLockedReason: String(user?.accountLockedReason || ""),
    restrictions: normalizeRestrictions(user?.restrictions),
  };
}

async function register(req, res, next) {
  try {
    const body = registerSchema.parse(req.body);
    const username = body.username.trim().toLowerCase();
    const email = body.email.trim().toLowerCase();

    const existedEmail = await User.findOne({ email });
    if (existedEmail) {
      throw new AppError("Email already exists", 409, "EMAIL_EXISTS");
    }

    const existedUsername = await User.findOne({ username });
    if (existedUsername) {
      throw new AppError("Username already exists", 409, "USERNAME_EXISTS");
    }

    const passwordHash = await hashPassword(body.password);

    const role = isUserAdmin({ username, email }) ? "admin" : "user";
    const newUser = await User.create({
      username,
      email,
      passwordHash,
      role,
      bio: "",
      avatarUrl: "",
    });

    const token = signToken(newUser);

    return res.status(201).json({
      ok: true,
      message: "Register successful",
      data: {
        token,
        tokenType: "Bearer",
        expiresIn: getJwtExpiresIn(),
        user: {
          id: String(newUser._id),
          username: newUser.username,
          email: newUser.email,
          role: isUserAdmin(newUser) ? "admin" : "user",
          bio: newUser.bio,
          avatarUrl: newUser.avatarUrl,
          createdAt: newUser.createdAt,
          ...serializeModerationState(newUser),
        },
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(
        new AppError(
          err.issues?.[0]?.message || err.errors?.[0]?.message || "Invalid input",
          400,
          "VALIDATION_ERROR",
        ),
      );
    }
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const body = loginSchema.parse(req.body);
    const loginValue = String(body.login || body.email || "").trim();
    const normalized = loginValue.toLowerCase();

    const user = await User.findOne(
      normalized.includes("@")
        ? { email: normalized }
        : { username: normalized },
    );

    if (!user) {
      throw new AppError("Invalid email/username or password", 401, "INVALID_LOGIN");
    }

    const matched = await bcrypt.compare(body.password, user.passwordHash);
    if (!matched) {
      throw new AppError("Invalid email/username or password", 401, "INVALID_LOGIN");
    }

    if (user.accountLocked) {
      throw new AppError("Account has been locked", 423, "ACCOUNT_LOCKED", buildLockDetails(user));
    }

    const currentRole = isUserAdmin(user) ? "admin" : "user";
    const now = new Date();
    await Promise.all([
      User.updateOne(
        { _id: user._id },
        {
          $inc: { loginCount: 1 },
          $set: {
            lastLoginAt: now,
            role: currentRole,
          },
        },
      ),
      LoginActivity.create({
        userId: user._id,
        username: user.username,
        loggedInAt: now,
      }),
    ]);

    user.loginCount = (Number(user.loginCount) || 0) + 1;
    user.lastLoginAt = now;
    user.role = currentRole;
    const token = signToken(user);

    return res.json({
      ok: true,
      message: "Login successful",
      data: {
        token,
        tokenType: "Bearer",
        expiresIn: getJwtExpiresIn(),
        user: {
          id: String(user._id),
          username: user.username,
          email: user.email,
          role: currentRole,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt,
          loginCount: user.loginCount,
          lastLoginAt: user.lastLoginAt,
          ...serializeModerationState(user),
        },
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(
        new AppError(
          err.issues?.[0]?.message || err.errors?.[0]?.message || "Invalid input",
          400,
          "VALIDATION_ERROR",
        ),
      );
    }
    next(err);
  }
}

async function sessionStatus(req, res, next) {
  try {
    const username = String(req.user?.username || req.headers["x-username"] || "").trim();
    if (!username) {
      throw new AppError("Username required", 401, "USERNAME_REQUIRED");
    }

    const user =
      req.currentUser ||
      (await User.findOne({ username })
        .select(
          "_id username email isVerified verifiedAt verifiedBy accountLocked accountLockedAt accountLockedReason strikesCount restrictions",
        )
        .lean());

    if (!user) {
      return res.json({
        ok: true,
        data: {
          exists: false,
          username,
          accountLocked: false,
        },
      });
    }

    return res.json({
      ok: true,
      data: {
        exists: true,
        username: user.username,
        ...serializeModerationState(user),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  sessionStatus,
};

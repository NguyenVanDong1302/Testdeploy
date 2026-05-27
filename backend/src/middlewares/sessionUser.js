const crypto = require("crypto");
const { AppError } = require("../utils/errors");
const User = require("../models/User");
const { buildLockDetails } = require("../utils/accountModeration");
const {
  extractBearerToken,
  isProbablyJwt,
  verifyAccessToken,
} = require("../utils/authToken");

function toLegacyUserId(username) {
  return crypto
    .createHash("sha256")
    .update(String(username))
    .digest("hex")
    .slice(0, 16);
}

async function sessionUser(req, res, next) {
  const headerUsername = String(req.headers["x-username"] || "").trim();
  const accessToken = extractBearerToken(req.headers.authorization || "");

  if (!headerUsername && !accessToken) {
    return next(new AppError("Username required", 401, "USERNAME_REQUIRED"));
  }

  try {
    let tokenPayload = null;
    if (accessToken && isProbablyJwt(accessToken)) {
      tokenPayload = verifyAccessToken(accessToken);
    }

    let currentUser = null;

    if (tokenPayload?.sub) {
      currentUser = await User.findById(String(tokenPayload.sub))
        .select(
          "_id username role avatarUrl isVerified moderationStatus accountLocked accountLockedAt accountLockedReason strikesCount restrictions",
        )
        .lean();

      if (!currentUser) {
        return next(new AppError("User not found", 401, "UNAUTHORIZED"));
      }
    } else if (headerUsername) {
      currentUser = await User.findOne({ username: headerUsername })
        .select(
          "_id username role avatarUrl isVerified moderationStatus accountLocked accountLockedAt accountLockedReason strikesCount restrictions",
        )
        .lean();
    }

    const resolvedUsername = String(
      currentUser?.username || tokenPayload?.username || headerUsername || "",
    ).trim();

    if (!resolvedUsername) {
      return next(new AppError("Username required", 401, "USERNAME_REQUIRED"));
    }

    if (tokenPayload && headerUsername) {
      const normalizedHeaderUsername = headerUsername.toLowerCase();
      const normalizedTokenUsername = String(
        currentUser?.username || tokenPayload?.username || "",
      )
        .trim()
        .toLowerCase();

      if (
        normalizedHeaderUsername
        && normalizedTokenUsername
        && normalizedHeaderUsername !== normalizedTokenUsername
      ) {
        return next(
          new AppError(
            "Authenticated user does not match username header",
            401,
            "SESSION_MISMATCH",
          ),
        );
      }
    }

    req.currentUser = currentUser || null;
    req.user = {
      sub: String(currentUser?._id || tokenPayload?.sub || toLegacyUserId(resolvedUsername)),
      username: resolvedUsername,
      role: String(currentUser?.role || tokenPayload?.role || "user"),
    };
    req.authContext = {
      mode: tokenPayload ? "jwt" : "legacy_username",
      hasCurrentUser: Boolean(currentUser),
    };

    if (currentUser?.accountLocked) {
      return next(
        new AppError("Tài khoản đã bị khóa", 423, "ACCOUNT_LOCKED", buildLockDetails(currentUser)),
      );
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { sessionUser };

const jwt = require("jsonwebtoken");
const { AppError } = require("./errors");

function getJwtSecret() {
  return process.env.JWT_SECRET || "dev_jwt_secret_change_me";
}

function getJwtExpiresIn() {
  return String(process.env.JWT_EXPIRES_IN || "7d").trim() || "7d";
}

function extractBearerToken(headerValue = "") {
  const header = String(headerValue || "").trim();
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function isProbablyJwt(token = "") {
  const normalized = String(token || "").trim();
  return normalized.split(".").length === 3;
}

function signAccessToken(payload = {}, options = {}) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: options.expiresIn || getJwtExpiresIn(),
  });
}

function verifyAccessToken(token = "") {
  try {
    return jwt.verify(String(token || "").trim(), getJwtSecret());
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      throw new AppError("Token expired", 401, "TOKEN_EXPIRED", {
        expiredAt: error?.expiredAt || null,
      });
    }

    throw new AppError("Invalid token", 401, "UNAUTHORIZED");
  }
}

module.exports = {
  extractBearerToken,
  getJwtExpiresIn,
  isProbablyJwt,
  signAccessToken,
  verifyAccessToken,
};

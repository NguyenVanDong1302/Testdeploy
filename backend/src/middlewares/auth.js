const { AppError } = require("../utils/errors");
const {
  extractBearerToken,
  verifyAccessToken,
} = require("../utils/authToken");

function auth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization || "");
  if (!token) return next(new AppError("Missing token", 401, "UNAUTHORIZED"));

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      sub: String(payload?.sub || ""),
      username: String(payload?.username || ""),
      email: String(payload?.email || ""),
      role: String(payload?.role || "user"),
    };
    next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { auth };

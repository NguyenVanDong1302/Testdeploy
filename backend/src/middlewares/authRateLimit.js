const rateLimit = require("express-rate-limit");

function toNumber(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

const authRateLimit = rateLimit({
  windowMs: toNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, {
    min: 60 * 1000,
    max: 24 * 60 * 60 * 1000,
  }),
  max: toNumber(process.env.AUTH_RATE_LIMIT_MAX, 10, { min: 1, max: 500 }),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: "AUTH_RATE_LIMITED",
    message: "Too many authentication attempts. Please try again later.",
  },
});

module.exports = { authRateLimit };

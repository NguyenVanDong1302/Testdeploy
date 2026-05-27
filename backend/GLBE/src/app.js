const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const path = require("path");

const routes = require("./routes");
const { errorHandler } = require("./middlewares/errorHandler");
const { mediaRoot } = require("./config/media");

function normalizeOrigins(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function createCorsOriginMatcher() {
  const allowedOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...normalizeOrigins(process.env.CORS_ALLOWED_ORIGINS),
    ...normalizeOrigins(process.env.FRONTEND_URL),
  ]);
  const allowVercelPreviews = parseBoolean(process.env.CORS_ALLOW_VERCEL_PREVIEWS, true);
  const vercelPreviewPattern = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    if (allowVercelPreviews && vercelPreviewPattern.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${origin}`));
  };
}

function createApp(options = {}) {
  const app = express();
  const corsOrigin = createCorsOriginMatcher();
  const beforeApiRoutes = Array.isArray(options.beforeApiRoutes) ? options.beforeApiRoutes : [];

  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
  );

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan("dev"));

  app.use("/uploads", express.static(mediaRoot));
  app.use("/uploads/posts", express.static(path.join(mediaRoot, "posts")));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "social-backend" });
  });

  if (beforeApiRoutes.length) {
    app.use("/api", ...beforeApiRoutes);
  }
  app.use("/api", routes);
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, createCorsOriginMatcher };

require("dotenv").config();

if (process.env.VERCEL && !process.env.MEDIA_PUBLIC_BASE_URL && process.env.VERCEL_URL) {
  process.env.MEDIA_PUBLIC_BASE_URL = `https://${process.env.VERCEL_URL}`;
}

const mongoose = require("mongoose");
const { createApp } = require("../src/app");
const { connectDB } = require("../src/config/db");
const { setIO } = require("../src/realtime/io");
const { AppError } = require("../src/utils/errors");

function createNoopSocketIO() {
  const io = {
    sockets: {
      adapter: {
        rooms: new Map(),
      },
    },
    to() {
      return io;
    },
    in() {
      return io;
    },
    emit() {
      return false;
    },
  };

  return io;
}

setIO(createNoopSocketIO());

let mongoConnectionPromise = null;

async function ensureDatabase(_req, _res, next) {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    next(new AppError("Missing MONGO_URI environment variable", 500, "MONGO_URI_MISSING"));
    return;
  }

  if (mongoose.connection.readyState === 1) {
    next();
    return;
  }

  if (!mongoConnectionPromise) {
    mongoConnectionPromise = connectDB(mongoUri).catch((error) => {
      mongoConnectionPromise = null;
      throw error;
    });
  }

  try {
    await mongoConnectionPromise;
    next();
  } catch (error) {
    next(new AppError(error?.message || "Database unavailable", 503, error?.code || "DATABASE_UNAVAILABLE"));
  }
}

function normalizeRewrittenPath(req) {
  const rawPath = req.query?.__path;
  if (!rawPath) return;

  const nextPath = Array.isArray(rawPath) ? rawPath.join("/") : String(rawPath);
  const normalizedPath = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
  const query = new URLSearchParams(req.url.split("?")[1] || "");
  query.delete("__path");
  const queryString = query.toString();

  req.url = `${normalizedPath}${queryString ? `?${queryString}` : ""}`;
}

const app = createApp({
  beforeApiRoutes: [ensureDatabase],
});

module.exports = (req, res) => {
  normalizeRewrittenPath(req);
  return app(req, res);
};

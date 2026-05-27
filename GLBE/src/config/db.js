const mongoose = require("mongoose");

function getMongoConnectOptions() {
  const timeoutMs = Math.max(Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 8000) || 8000, 1000);
  return {
    serverSelectionTimeoutMS: timeoutMs,
  };
}

function isLoopbackMongoUri(uri = "") {
  const raw = String(uri || "").trim();
  if (!raw) return false;

  try {
    const normalized = raw
      .replace(/^mongodb\+srv:/i, "https:")
      .replace(/^mongodb:/i, "http:");
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch (_err) {
    return /mongodb(?:\+srv)?:\/\/(?:[^@]+@)?(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::|\/|$)/i.test(raw);
  }
}

async function connectDB(uri) {
  if (process.env.VERCEL && isLoopbackMongoUri(uri)) {
    const error = new Error("MONGO_URI must point to MongoDB Atlas or another public MongoDB host when running on Vercel");
    error.code = "MONGO_URI_LOCALHOST_ON_VERCEL";
    throw error;
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, getMongoConnectOptions());
  console.log("MongoDB connected");
}

module.exports = { connectDB, isLoopbackMongoUri };

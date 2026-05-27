import dotenv from "dotenv";

dotenv.config();

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function parseCorsOrigins(rawOrigins: string | undefined): string[] {
  if (!rawOrigins) {
    return [];
  }

  return rawOrigins
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri:
    process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/personal_tasks",
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
};

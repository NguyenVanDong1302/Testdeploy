import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { env } from "./config/env.js";
import taskRoutes from "./routes/tasks.js";

export const app = express();

const allowAllOrigins = env.corsOrigins.length === 0;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowAllOrigins || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
  }),
);

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.use("/api/tasks", taskRoutes);

app.use(
  (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    const message =
      error instanceof Error ? error.message : "Internal server error.";

    console.error(error);
    response.status(500).json({ message });
  },
);

import { NextFunction, Request, Response, Router } from "express";
import mongoose from "mongoose";
import { Task } from "../models/task.js";

const router = Router();

function asyncHandler(
  handler: (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

router.get(
  "/",
  asyncHandler(async (_request, response) => {
    const tasks = await Task.find().sort({ createdAt: -1 }).lean();
    response.json(tasks);
  }),
);

router.post(
  "/",
  asyncHandler(async (request, response) => {
    const title =
      typeof request.body.title === "string" ? request.body.title.trim() : "";

    if (!title) {
      response.status(400).json({ message: "Title is required." });
      return;
    }

    const task = await Task.create({ title });
    response.status(201).json(task);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const { id } = request.params;

    if (!mongoose.isValidObjectId(id)) {
      response.status(400).json({ message: "Invalid task id." });
      return;
    }

    if (typeof request.body.done !== "boolean") {
      response.status(400).json({ message: "`done` must be a boolean." });
      return;
    }

    const task = await Task.findByIdAndUpdate(
      id,
      { done: request.body.done },
      { new: true, runValidators: true },
    );

    if (!task) {
      response.status(404).json({ message: "Task not found." });
      return;
    }

    response.json(task);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const { id } = request.params;

    if (!mongoose.isValidObjectId(id)) {
      response.status(400).json({ message: "Invalid task id." });
      return;
    }

    const task = await Task.findByIdAndDelete(id);

    if (!task) {
      response.status(404).json({ message: "Task not found." });
      return;
    }

    response.json({ success: true });
  }),
);

export default router;

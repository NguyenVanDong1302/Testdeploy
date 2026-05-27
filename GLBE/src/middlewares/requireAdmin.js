const mongoose = require("mongoose");
const User = require("../models/User");
const { AppError } = require("../utils/errors");
const { isUserAdmin } = require("../utils/adminAccess");

async function requireAdmin(req, res, next) {
  try {
    const userId = String(req.user?.sub || "").trim();
    if (!userId) {
      throw new AppError("Missing token payload", 401, "UNAUTHORIZED");
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError("Invalid token payload", 401, "UNAUTHORIZED");
    }

    const user = await User.findById(userId).select("_id username email role").lean();
    if (!user) {
      throw new AppError("User not found", 401, "UNAUTHORIZED");
    }

    if (!isUserAdmin(user)) {
      throw new AppError("Forbidden: Admin only", 403, "FORBIDDEN");
    }

    req.adminUser = {
      id: String(user._id),
      username: user.username,
      email: user.email,
      role: "admin",
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin };

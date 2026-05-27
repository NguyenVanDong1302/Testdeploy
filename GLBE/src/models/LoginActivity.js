const mongoose = require("mongoose");

const loginActivitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    username: { type: String, required: true, index: true },
    loggedInAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

module.exports = mongoose.model("LoginActivity", loginActivitySchema);

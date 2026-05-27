const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },
    fullName: { type: String, default: "", trim: true, maxlength: 80 },
    website: { type: String, default: "", trim: true, maxlength: 255 },
    bio: { type: String, default: "" },
    gender: { type: String, default: "", trim: true, maxlength: 30 },
    avatarUrl: { type: String, default: "" },
    showThreadsBadge: { type: Boolean, default: false },
    showSuggestedAccountsOnProfile: { type: Boolean, default: true },
    isPrivateAccount: { type: Boolean, default: false, index: true },
    showActivityStatus: { type: Boolean, default: true },
    loginCount: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date, default: null },
    moderationStatus: {
      type: String,
      enum: ["normal", "warning", "violating"],
      default: "normal",
      index: true,
    },
    moderationReason: { type: String, default: "" },
    isVerified: { type: Boolean, default: false, index: true },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: String, default: "" },
    strikesCount: { type: Number, default: 0, min: 0 },
    accountLocked: { type: Boolean, default: false, index: true },
    accountLockedAt: { type: Date, default: null },
    accountLockedReason: { type: String, default: "" },
    restrictions: {
      commentBlocked: { type: Boolean, default: false },
      messagingBlocked: { type: Boolean, default: false },
      likeBlocked: { type: Boolean, default: false },
      dailyPostLimit: { type: Number, default: 0, min: 0 },
    },
    hiddenStoryAuthorIds: { type: [String], default: [] },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);

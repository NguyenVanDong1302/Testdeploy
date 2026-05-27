const mongoose = require("mongoose");

const reportMediaSnapshotSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["image", "video"], default: "image" },
    url: { type: String, default: "" },
    thumbnailUrl: { type: String, default: "" },
    filename: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0, min: 0 },
    order: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const postSnapshotSchema = new mongoose.Schema(
  {
    authorId: { type: String, default: "" },
    authorUsername: { type: String, default: "" },
    content: { type: String, default: "", maxlength: 3000 },
    media: { type: [reportMediaSnapshotSchema], default: [] },
    imageUrl: { type: String, default: "" },
    mediaType: {
      type: String,
      enum: ["text", "image", "video", "mixed"],
      default: "text",
    },
    allowComments: { type: Boolean, default: true },
    createdAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    moderationReason: { type: String, default: "", maxlength: 500 },
  },
  { _id: false },
);

const postReportSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    reporterId: { type: String, required: true, index: true },
    reporterUsername: { type: String, required: true, index: true },
    reason: { type: String, trim: true, maxlength: 500, default: "" },
    status: {
      type: String,
      enum: ["pending", "reviewed", "accepted", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: "" },
    source: {
      type: String,
      enum: ["user_report", "auto_nsfw"],
      default: "user_report",
      index: true,
    },
    postSnapshot: { type: postSnapshotSchema, default: null },
    detectionSignals: { type: [String], default: [] },
    autoModeratedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

postReportSchema.index({ postId: 1, createdAt: -1 });

module.exports = mongoose.model("PostReport", postReportSchema);

const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    authorId: { type: String, required: true, index: true },
    authorUsername: { type: String, required: true },
    content: { type: String, trim: true, maxlength: 1000, default: "" },
    parentCommentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },
    replyToCommentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },
    replyToAuthorId: { type: String, default: null },
    replyToAuthorUsername: { type: String, default: null },
    likes: { type: [String], default: [] },
    mediaUrl: { type: String, default: "" },
    mediaType: { type: String, enum: ["", "image", "gif", "video"], default: "" },
  },
  { timestamps: true },
);

commentSchema.index({ postId: 1, parentCommentId: 1, createdAt: 1 });

module.exports = mongoose.model("Comment", commentSchema);

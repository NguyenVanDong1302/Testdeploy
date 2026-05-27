const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["direct"],
      default: "direct",
    },
    memberIds: [{ type: String, required: true }],
    memberUsernames: [{ type: String, required: true }],
    directKey: { type: String, unique: true, sparse: true, index: true },
    lastMessageText: { type: String, default: "" },
    lastMessageAt: { type: Date, default: null, index: true },
    lastMessageSenderId: { type: String, default: "" },
  },
  { timestamps: true },
);

conversationSchema.index({ memberIds: 1 });
conversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);

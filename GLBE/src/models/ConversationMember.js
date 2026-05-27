const mongoose = require("mongoose");

const conversationMemberSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    unreadCount: { type: Number, default: 0 },
    lastReadMessageId: { type: String, default: "" },
    lastReadAt: { type: Date, default: null },
    peerNickname: { type: String, default: "", trim: true, maxlength: 80 },
    blockedPeer: { type: Boolean, default: false },
    blockedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

conversationMemberSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
conversationMemberSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model("ConversationMember", conversationMemberSchema);

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['like', 'comment', 'follow', 'message', 'moderation'],
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['post', 'user', 'conversation', 'story', 'moderation'],
      required: true,
      default: 'post',
      index: true,
    },
    targetId: { type: String, required: true, index: true },
    postId: { type: String, default: '', index: true },
    actors: { type: [String], default: [] },
    actorUsernames: { type: [String], default: [] },
    totalEvents: { type: Number, default: 1, min: 0 },
    previewText: { type: String, default: '' },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    lastEventAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

notificationSchema.index(
  { recipientId: 1, type: 1, targetType: 1, targetId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      recipientId: { $type: 'string' },
      type: { $exists: true },
      targetType: { $type: 'string' },
      targetId: { $type: 'string' },
    },
    name: 'recipientId_1_type_1_targetType_1_targetId_1',
  },
);

module.exports = mongoose.model('Notification', notificationSchema);

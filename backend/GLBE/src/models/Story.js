const mongoose = require('mongoose');

const storyViewSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    username: { type: String, default: '' },
    viewedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const storySchema = new mongoose.Schema(
  {
    authorId: { type: String, required: true, index: true },
    authorUsername: { type: String, required: true, index: true },
    mediaType: { type: String, enum: ['image', 'video'], required: true },
    mediaUrl: { type: String, required: true },
    thumbnailUrl: { type: String, default: '' },
    caption: { type: String, default: '', trim: true, maxlength: 300 },
    likes: { type: [String], default: [] },
    views: { type: [storyViewSchema], default: [] },
    expiresAt: { type: Date, required: true, index: true },
    archivedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

storySchema.index({ authorId: 1, createdAt: -1 });
storySchema.index({ archivedAt: 1, expiresAt: 1, createdAt: -1 });

module.exports = mongoose.model('Story', storySchema);

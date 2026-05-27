const mongoose = require("mongoose");

const followSchema = new mongoose.Schema(
  {
    followerId: { type: String, required: true, index: true },
    followerUsername: { type: String, required: true, index: true },

    followingId: { type: String, required: true, index: true },
    followingUsername: { type: String, required: true, index: true },
  },
  { timestamps: true },
);

// A follows B only once
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

// query helpers
followSchema.index({ followingId: 1, createdAt: -1 });
followSchema.index({ followerId: 1, createdAt: -1 });

module.exports = mongoose.model("Follow", followSchema);

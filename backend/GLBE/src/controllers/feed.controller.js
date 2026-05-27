const Post = require("../models/Post");
const Follow = require("../models/Follow");

async function listFollowingFeed(req, res, next) {
  try {
    const me = req.user.sub;

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50,
    );
    const skip = (page - 1) * limit;

    const following = await Follow.find({ followerId: me }).select(
      "followingId",
    );
    const ids = following.map((x) => x.followingId);

    // following feed: chỉ lấy bài public + friends (vì viewer là follower)
    const query = {
      authorId: { $in: ids },
      visibility: { $in: ["public", "friends"] },
      moderationStatus: { $in: ["normal", "reported"] },
    };

    const [items, total] = await Promise.all([
      Post.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Post.countDocuments(query),
    ]);

    res.json({
      ok: true,
      data: { items, page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listFollowingFeed };

const crypto = require("crypto");
const Follow = require("../models/Follow");
const { AppError } = require("../utils/errors");

function toUserId(username) {
  return crypto
    .createHash("sha256")
    .update(String(username))
    .digest("hex")
    .slice(0, 16);
}

function parseLimit(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(50, n));
}

/**
 * Cursor format: `${createdAtMillis}_${id}`
 */
function encodeCursor(doc) {
  return `${new Date(doc.createdAt).getTime()}_${doc._id.toString()}`;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  const [msStr, id] = String(cursor).split("_");
  const ms = Number(msStr);
  if (!ms || !id) return null;
  return { ms, id };
}

// ===== Helpers =====
async function getCountsByUsername(username) {
  const userId = toUserId(username);
  const [followers, following] = await Promise.all([
    Follow.countDocuments({ followingId: userId }),
    Follow.countDocuments({ followerId: userId }),
  ]);
  return { followers, following };
}

async function relationship(viewer, targetUsername) {
  const viewerId = viewer.sub;
  const viewerUsername = viewer.username;
  const targetId = toUserId(targetUsername);

  if (viewerUsername === targetUsername) {
    return { isMe: true, isFollowing: false, isFollowedBy: false };
  }

  const [isFollowing, isFollowedBy] = await Promise.all([
    Follow.exists({ followerId: viewerId, followingId: targetId }),
    Follow.exists({ followerId: targetId, followingId: viewerId }),
  ]);

  return {
    isMe: false,
    isFollowing: !!isFollowing,
    isFollowedBy: !!isFollowedBy,
  };
}

// ===== Controllers =====
async function getProfile(req, res, next) {
  try {
    const targetUsername = req.params.username;
    const counts = await getCountsByUsername(targetUsername);
    const rel = await relationship(req.user, targetUsername);

    res.json({
      ok: true,
      data: {
        username: targetUsername,
        counts,
        isMe: rel.isMe,
        relationship: {
          isFollowing: rel.isFollowing,
          isFollowedBy: rel.isFollowedBy,
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

async function getRelationship(req, res, next) {
  try {
    const targetUsername = req.params.username;
    const rel = await relationship(req.user, targetUsername);
    res.json({ ok: true, data: rel });
  } catch (e) {
    next(e);
  }
}

async function followUser(req, res, next) {
  try {
    const targetUsername = req.params.username;
    const viewer = req.user;

    if (viewer.username === targetUsername) {
      throw new AppError("Cannot follow yourself", 400, "INVALID_OPERATION");
    }

    const targetId = toUserId(targetUsername);

    // idempotent: if exists -> return ok
    try {
      await Follow.create({
        followerId: viewer.sub,
        followerUsername: viewer.username,
        followingId: targetId,
        followingUsername: targetUsername,
      });
    } catch (err) {
      // duplicate key => already following
      if (err?.code !== 11000) throw err;
    }

    const counts = await getCountsByUsername(targetUsername);

    res.status(200).json({
      ok: true,
      data: {
        isFollowing: true,
        counts,
      },
    });
  } catch (e) {
    next(e);
  }
}

async function unfollowUser(req, res, next) {
  try {
    const targetUsername = req.params.username;
    const viewer = req.user;

    const targetId = toUserId(targetUsername);

    await Follow.deleteOne({
      followerId: viewer.sub,
      followingId: targetId,
    });

    const counts = await getCountsByUsername(targetUsername);

    res.status(200).json({
      ok: true,
      data: {
        isFollowing: false,
        counts,
      },
    });
  } catch (e) {
    next(e);
  }
}

async function listFollowers(req, res, next) {
  try {
    const targetUsername = req.params.username;
    const targetId = toUserId(targetUsername);

    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor);

    const query = { followingId: targetId };

    // cursor pagination: createdAt desc
    // if cursor exists => createdAt < cursorCreatedAt OR (createdAt == and _id < cursorId)
    if (cursor) {
      const cursorDate = new Date(cursor.ms);
      query.$or = [
        { createdAt: { $lt: cursorDate } },
        { createdAt: cursorDate, _id: { $lt: cursor.id } },
      ];
    }

    const docs = await Follow.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .select("followerId followerUsername createdAt");

    const hasMore = docs.length > limit;
    const sliced = hasMore ? docs.slice(0, limit) : docs;

    res.json({
      ok: true,
      data: {
        items: sliced.map((d) => ({
          userId: d.followerId,
          username: d.followerUsername,
        })),
        nextCursor: hasMore ? encodeCursor(sliced[sliced.length - 1]) : null,
      },
    });
  } catch (e) {
    next(e);
  }
}

async function listFollowing(req, res, next) {
  try {
    const targetUsername = req.params.username;
    const targetId = toUserId(targetUsername);

    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor);

    const query = { followerId: targetId };

    if (cursor) {
      const cursorDate = new Date(cursor.ms);
      query.$or = [
        { createdAt: { $lt: cursorDate } },
        { createdAt: cursorDate, _id: { $lt: cursor.id } },
      ];
    }

    const docs = await Follow.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .select("followingId followingUsername createdAt");

    const hasMore = docs.length > limit;
    const sliced = hasMore ? docs.slice(0, limit) : docs;

    res.json({
      ok: true,
      data: {
        items: sliced.map((d) => ({
          userId: d.followingId,
          username: d.followingUsername,
        })),
        nextCursor: hasMore ? encodeCursor(sliced[sliced.length - 1]) : null,
      },
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getProfile,
  getRelationship,
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
};

const crypto = require("crypto");
const path = require("path");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const Follow = require("../models/Follow");
const Post = require("../models/Post");
const Comment = require("../models/Comment");
const PostReport = require("../models/PostReport");
const Story = require("../models/Story");
const LoginActivity = require("../models/LoginActivity");
const Conversation = require("../models/Conversation");
const ConversationMember = require("../models/ConversationMember");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const { AppError } = require("../utils/errors");
const notificationService = require('../services/notification.service');
const { hashPassword } = require("../utils/passwords");

const PROFILE_SELECT = "_id username email bio avatarUrl website fullName gender showThreadsBadge showSuggestedAccountsOnProfile isVerified isPrivateAccount showActivityStatus createdAt";
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const USERNAME_PATTERN = /^[a-z0-9._]{3,30}$/;

function legacyUserId(username) {
  return crypto.createHash("sha256").update(String(username || "")).digest("hex").slice(0, 16);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizePublicMediaUrl(url = "") {
  const raw = String(url || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  if (/^(https?:)?\/\//i.test(raw)) return raw;
  if (/^(data:|blob:)/i.test(raw)) return raw;
  const uploadsIndex = raw.toLowerCase().indexOf("/uploads/");
  if (uploadsIndex >= 0) return `${MEDIA_PUBLIC_BASE_URL}${raw.slice(uploadsIndex)}`;
  if (raw.toLowerCase().startsWith("uploads/")) return `${MEDIA_PUBLIC_BASE_URL}/${raw}`;
  return `${MEDIA_PUBLIC_BASE_URL}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function normalizeOptionalBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

async function resolveViewer(req) {
  const username = (req.headers["x-username"] || req.user?.username || "").toString().trim();
  if (!username) {
    return null;
  }

  const user = await User.findOne({ username })
    .select(PROFILE_SELECT)
    .lean();
  if (!user) {
    return null;
  }

  return user;
}

function serializeUser(user) {
  const id = String(user._id);
  return {
    _id: id,
    id,
    username: user.username,
    email: user.email || "",
    fullName: user.fullName || "",
    website: user.website || "",
    bio: user.bio || "",
    gender: user.gender || "",
    showThreadsBadge: Boolean(user.showThreadsBadge),
    showSuggestedAccountsOnProfile: user.showSuggestedAccountsOnProfile !== false,
    isPrivateAccount: Boolean(user.isPrivateAccount),
    showActivityStatus: user.showActivityStatus !== false,
    isVerified: Boolean(user.isVerified),
    avatarUrl: user.avatarUrl || "",
    createdAt: user.createdAt || null,
  };
}

async function getFollowDocsForTarget(user) {
  return Follow.find({
    $or: [{ followingId: String(user._id) }, { followingUsername: user.username }],
  })
    .select("followerId followerUsername")
    .lean();
}

async function getFollowingDocsForUser(user) {
  return Follow.find({
    $or: [
      { followerId: String(user._id) },
      { followerId: legacyUserId(user.username) },
      { followerUsername: user.username },
    ],
  })
    .select("followingId followingUsername")
    .lean();
}

async function hydrateUsersByRefs({ ids = [], usernames = [] }) {
  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (usernames.length) or.push({ username: { $in: usernames } });
  if (!or.length) return [];

  const users = await User.find({ $or: or })
    .select(PROFILE_SELECT)
    .sort({ username: 1 })
    .lean();

  const seen = new Set();
  return users.filter((user) => {
    const id = String(user._id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function getCountsForUser(user) {
  try {
    const [followers, following] = await Promise.all([
      Follow.countDocuments({
        $or: [{ followingId: String(user._id) }, { followingUsername: user.username }],
      }),
      Follow.countDocuments({
        $or: [
          { followerId: String(user._id) },
          { followerId: legacyUserId(user.username) },
          { followerUsername: user.username },
        ],
      }),
    ]);

    return {
      followers: Number.isFinite(followers) ? followers : 0,
      following: Number.isFinite(following) ? following : 0,
    };
  } catch (err) {
    return { followers: 0, following: 0 };
  }
}

async function getRelationship(viewer, targetUser) {
  if (!viewer) {
    return { isMe: false, isFollowing: false, isFollowedBy: false };
  }

  if (String(viewer._id) === String(targetUser._id)) {
    return { isMe: true, isFollowing: false, isFollowedBy: false };
  }

  const viewerLegacyId = legacyUserId(viewer.username);
  const targetLegacyId = legacyUserId(targetUser.username);

  const [isFollowing, isFollowedBy] = await Promise.all([
    Follow.exists({
      $or: [
        {
          followerId: String(viewer._id),
          followingId: String(targetUser._id),
        },
        {
          followerId: viewerLegacyId,
          followingId: targetLegacyId,
        },
        {
          followerUsername: viewer.username,
          followingUsername: targetUser.username,
        },
        {
          followerId: String(viewer._id),
          followingUsername: targetUser.username,
        },
        {
          followerUsername: viewer.username,
          followingId: String(targetUser._id),
        },
      ],
    }),
    Follow.exists({
      $or: [
        {
          followerId: String(targetUser._id),
          followingId: String(viewer._id),
        },
        {
          followerId: targetLegacyId,
          followingId: viewerLegacyId,
        },
        {
          followerUsername: targetUser.username,
          followingUsername: viewer.username,
        },
        {
          followerId: String(targetUser._id),
          followingUsername: viewer.username,
        },
        {
          followerUsername: targetUser.username,
          followingId: String(viewer._id),
        },
      ],
    }),
  ]);

  return {
    isMe: false,
    isFollowing: Boolean(isFollowing),
    isFollowedBy: Boolean(isFollowedBy),
  };
}

async function getProfile(req, res, next) {
  try {
    const { username } = req.params;
    const [user, viewer] = await Promise.all([
      User.findOne({ username })
        .select(PROFILE_SELECT)
        .lean(),
      resolveViewer(req),
    ]);

    if (!user) {
      throw new AppError("Không tìm thấy người dùng", 404, "USER_NOT_FOUND");
    }

    const [counts, relationship] = await Promise.all([
      getCountsForUser(user),
      getRelationship(viewer, user),
    ]);

    return res.json({
      ok: true,
      data: {
        ...serializeUser(user),
        counts,
        relationship,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function follow(req, res, next) {
  try {
    const viewer = await resolveViewer(req);
    const followingId = String(req.body?.followingId || "").trim();
    const followingUsername = String(req.body?.username || req.body?.followingUsername || "").trim();

    if (!viewer) {
      throw new AppError("Chưa xác thực người dùng", 401, "UNAUTHORIZED");
    }

    if (!followingId && !followingUsername) {
      throw new AppError("Thiếu followingId hoặc username", 400, "MISSING_TARGET_USER");
    }

    const targetUser = await User.findOne({
      $or: [
        ...(followingId ? [{ _id: followingId }] : []),
        ...(followingUsername ? [{ username: followingUsername }] : []),
      ],
    })
      .select(PROFILE_SELECT)
      .lean();

    if (!targetUser) {
      throw new AppError("Không tìm thấy người dùng cần follow", 404, "TARGET_USER_NOT_FOUND");
    }

    if (String(viewer._id) === String(targetUser._id)) {
      throw new AppError("Không thể tự follow chính mình", 400, "INVALID_FOLLOW");
    }

    try {
      await Follow.create({
        followerId: String(viewer._id),
        followerUsername: viewer.username,
        followingId: String(targetUser._id),
        followingUsername: targetUser.username,
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }

    const counts = await getCountsForUser(targetUser);

    notificationService.notifyFollow({
      recipientId: String(targetUser._id),
      recipientUsername: targetUser.username,
      actorId: String(viewer._id),
      actorUsername: viewer.username,
    }).catch((error) => {
      console.error('notifyFollow failed:', error?.message || error);
    });

    return res.json({
      ok: true,
      message: "Follow thành công",
      data: {
        targetUser: serializeUser(targetUser),
        counts,
        relationship: {
          isMe: false,
          isFollowing: true,
          isFollowedBy: false,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function unfollow(req, res, next) {
  try {
    const viewer = await resolveViewer(req);
    const followingId = String(req.body?.followingId || "").trim();
    const followingUsername = String(req.body?.username || req.body?.followingUsername || "").trim();

    if (!viewer) {
      throw new AppError("Chưa xác thực người dùng", 401, "UNAUTHORIZED");
    }

    if (!followingId && !followingUsername) {
      throw new AppError("Thiếu followingId hoặc username", 400, "MISSING_TARGET_USER");
    }

    const targetUser = await User.findOne({
      $or: [
        ...(followingId ? [{ _id: followingId }] : []),
        ...(followingUsername ? [{ username: followingUsername }] : []),
      ],
    })
      .select(PROFILE_SELECT)
      .lean();

    if (!targetUser) {
      throw new AppError("Không tìm thấy người dùng cần unfollow", 404, "TARGET_USER_NOT_FOUND");
    }

    await Follow.deleteMany({
      $or: [
        {
          followerId: String(viewer._id),
          followingId: String(targetUser._id),
        },
        {
          followerId: legacyUserId(viewer.username),
          followingId: legacyUserId(targetUser.username),
        },
        {
          followerUsername: viewer.username,
          followingUsername: targetUser.username,
        },
        {
          followerId: String(viewer._id),
          followingUsername: targetUser.username,
        },
        {
          followerUsername: viewer.username,
          followingId: String(targetUser._id),
        },
      ],
    });

    const counts = await getCountsForUser(targetUser);

    notificationService.removeFollowNotification({
      recipientId: String(targetUser._id),
      recipientUsername: targetUser.username,
      actorId: String(viewer._id),
      actorUsername: viewer.username,
    }).catch((error) => {
      console.error('removeFollowNotification failed:', error?.message || error);
    });

    return res.json({
      ok: true,
      message: "Bỏ follow thành công",
      data: {
        targetUser: serializeUser(targetUser),
        counts,
        relationship: {
          isMe: false,
          isFollowing: false,
          isFollowedBy: false,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function listFollowers(req, res, next) {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username }).select("_id username").lean();
    if (!user) {
      throw new AppError("Không tìm thấy người dùng", 404, "USER_NOT_FOUND");
    }

    const rows = await getFollowDocsForTarget(user);
    const users = await hydrateUsersByRefs({
      ids: rows.map((item) => String(item.followerId || "")).filter(Boolean),
      usernames: rows.map((item) => String(item.followerUsername || "")).filter(Boolean),
    });

    return res.json({
      ok: true,
      data: users.map(serializeUser),
    });
  } catch (err) {
    next(err);
  }
}

async function listFollowing(req, res, next) {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username }).select("_id username").lean();
    if (!user) {
      throw new AppError("Không tìm thấy người dùng", 404, "USER_NOT_FOUND");
    }

    const rows = await getFollowingDocsForUser(user);
    const users = await hydrateUsersByRefs({
      ids: rows.map((item) => String(item.followingId || "")).filter(Boolean),
      usernames: rows.map((item) => String(item.followingUsername || "")).filter(Boolean),
    });

    return res.json({
      ok: true,
      data: users.map(serializeUser),
    });
  } catch (err) {
    next(err);
  }
}

async function listUsers(req, res, next) {
  try {
    const users = await User.find({})
      .select(PROFILE_SELECT)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      data: users.map(serializeUser),
    });
  } catch (err) {
    next(err);
  }
}

async function syncUsernameReferences({ oldUsername, newUsername, oldLegacyId, newLegacyId }) {
  const usernameOps = [
    User.updateMany({ verifiedBy: oldUsername }, { $set: { verifiedBy: newUsername } }),
    Post.updateMany({ authorUsername: oldUsername }, { $set: { authorUsername: newUsername } }),
    Comment.updateMany({ authorUsername: oldUsername }, { $set: { authorUsername: newUsername } }),
    Comment.updateMany({ replyToAuthorUsername: oldUsername }, { $set: { replyToAuthorUsername: newUsername } }),
    Follow.updateMany({ followerUsername: oldUsername }, { $set: { followerUsername: newUsername } }),
    Follow.updateMany({ followingUsername: oldUsername }, { $set: { followingUsername: newUsername } }),
    PostReport.updateMany({ reporterUsername: oldUsername }, { $set: { reporterUsername: newUsername } }),
    PostReport.updateMany({ reviewedBy: oldUsername }, { $set: { reviewedBy: newUsername } }),
    Story.updateMany({ authorUsername: oldUsername }, { $set: { authorUsername: newUsername } }),
    Story.updateMany(
      { "views.username": oldUsername },
      { $set: { "views.$[view].username": newUsername } },
      { arrayFilters: [{ "view.username": oldUsername }] },
    ),
    LoginActivity.updateMany({ username: oldUsername }, { $set: { username: newUsername } }),
    Conversation.updateMany(
      { memberUsernames: oldUsername },
      { $set: { "memberUsernames.$[username]": newUsername } },
      { arrayFilters: [{ username: oldUsername }] },
    ),
    ConversationMember.updateMany({ username: oldUsername }, { $set: { username: newUsername } }),
    Message.updateMany({ senderUsername: oldUsername }, { $set: { senderUsername: newUsername } }),
    Message.updateMany({ receiverUsername: oldUsername }, { $set: { receiverUsername: newUsername } }),
    Message.updateMany({ replyToSenderUsername: oldUsername }, { $set: { replyToSenderUsername: newUsername } }),
    Message.updateMany({ "storyReply.ownerUsername": oldUsername }, { $set: { "storyReply.ownerUsername": newUsername } }),
    Message.updateMany(
      { "reactions.username": oldUsername },
      { $set: { "reactions.$[reaction].username": newUsername } },
      { arrayFilters: [{ "reaction.username": oldUsername }] },
    ),
    Notification.updateMany(
      { actorUsernames: oldUsername },
      { $set: { "actorUsernames.$[item]": newUsername } },
      { arrayFilters: [{ item: oldUsername }] },
    ),
  ];

  const idOps = oldLegacyId && newLegacyId && oldLegacyId !== newLegacyId
    ? [
        Post.updateMany({ authorId: oldLegacyId }, { $set: { authorId: newLegacyId } }),
        Post.updateMany(
          { likes: oldLegacyId },
          { $set: { "likes.$[item]": newLegacyId } },
          { arrayFilters: [{ item: oldLegacyId }] },
        ),
        Comment.updateMany({ authorId: oldLegacyId }, { $set: { authorId: newLegacyId } }),
        Comment.updateMany({ replyToAuthorId: oldLegacyId }, { $set: { replyToAuthorId: newLegacyId } }),
        Comment.updateMany(
          { likes: oldLegacyId },
          { $set: { "likes.$[item]": newLegacyId } },
          { arrayFilters: [{ item: oldLegacyId }] },
        ),
        Follow.updateMany({ followerId: oldLegacyId }, { $set: { followerId: newLegacyId } }),
        Follow.updateMany({ followingId: oldLegacyId }, { $set: { followingId: newLegacyId } }),
        PostReport.updateMany({ reporterId: oldLegacyId }, { $set: { reporterId: newLegacyId } }),
        Notification.updateMany({ recipientId: oldLegacyId }, { $set: { recipientId: newLegacyId } }),
        Notification.updateMany(
          { actors: oldLegacyId },
          { $set: { "actors.$[item]": newLegacyId } },
          { arrayFilters: [{ item: oldLegacyId }] },
        ),
      ]
    : [];

  await Promise.all([...usernameOps, ...idOps]);
}


async function updateMyProfile(req, res, next) {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer) {
      throw new AppError("Chưa xác thực người dùng", 401, "UNAUTHORIZED");
    }

    const payload = req.body || {};
    const patch = {};
    if (hasOwn(payload, "fullName")) patch.fullName = String(payload.fullName || "").trim().slice(0, 80);
    if (hasOwn(payload, "website")) patch.website = String(payload.website || "").trim().slice(0, 255);
    if (hasOwn(payload, "bio")) patch.bio = String(payload.bio || "").trim().slice(0, 150);
    if (hasOwn(payload, "gender")) patch.gender = String(payload.gender || "").trim().slice(0, 30);
    if (hasOwn(payload, "showThreadsBadge")) {
      patch.showThreadsBadge = normalizeOptionalBoolean(payload.showThreadsBadge, Boolean(viewer.showThreadsBadge));
    }
    if (hasOwn(payload, "showSuggestedAccountsOnProfile")) {
      patch.showSuggestedAccountsOnProfile = normalizeOptionalBoolean(
        payload.showSuggestedAccountsOnProfile,
        viewer.showSuggestedAccountsOnProfile !== false,
      );
    }
    if (hasOwn(payload, "isPrivateAccount")) {
      patch.isPrivateAccount = normalizeOptionalBoolean(payload.isPrivateAccount, Boolean(viewer.isPrivateAccount));
    }
    if (hasOwn(payload, "showActivityStatus")) {
      patch.showActivityStatus = normalizeOptionalBoolean(payload.showActivityStatus, viewer.showActivityStatus !== false);
    }
    if (req.file?.path) {
      patch.avatarUrl = normalizePublicMediaUrl(`/uploads/avatars/${path.basename(req.file.path)}`);
    } else if (hasOwn(payload, "avatarUrl")) {
      patch.avatarUrl = String(payload.avatarUrl || "").trim();
    }

    const updated = await User.findByIdAndUpdate(
      viewer._id,
      { $set: patch },
      { new: true, runValidators: true }
    )
      .select(PROFILE_SELECT)
      .lean();

    const counts = await getCountsForUser(updated);

    return res.json({
      ok: true,
      message: "Cập nhật hồ sơ thành công",
      data: {
        ...serializeUser(updated),
        counts,
        relationship: {
          isMe: true,
          isFollowing: false,
          isFollowedBy: false,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function changeMyPassword(req, res, next) {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer) {
      throw new AppError("ChÆ°a xÃ¡c thá»±c ngÆ°á»i dÃ¹ng", 401, "UNAUTHORIZED");
    }

    const currentPassword = String(req.body?.currentPassword || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();
    const confirmPassword = String(req.body?.confirmPassword || "").trim();

    if (!currentPassword || !newPassword) {
      throw new AppError("Thiáº¿u máº­t kháº©u hiá»‡n táº¡i hoáº·c máº­t kháº©u má»›i", 400, "MISSING_PASSWORD_FIELDS");
    }
    if (newPassword.length < 6) {
      throw new AppError("Máº­t kháº©u má»›i pháº£i cÃ³ Ã­t nháº¥t 6 kÃ½ tá»±", 400, "INVALID_NEW_PASSWORD");
    }
    if (confirmPassword && confirmPassword !== newPassword) {
      throw new AppError("XÃ¡c nháº­n máº­t kháº©u khÃ´ng khá»›p", 400, "PASSWORD_CONFIRM_MISMATCH");
    }

    const user = await User.findById(viewer._id).select("_id passwordHash");
    if (!user) {
      throw new AppError("KhÃ´ng tÃ¬m tháº¥y ngÆ°á»i dÃ¹ng", 404, "USER_NOT_FOUND");
    }

    const matched = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matched) {
      throw new AppError("Máº­t kháº©u hiá»‡n táº¡i khÃ´ng Ä‘Ãºng", 400, "INVALID_CURRENT_PASSWORD");
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsCurrent) {
      throw new AppError("Máº­t kháº©u má»›i pháº£i khÃ¡c máº­t kháº©u hiá»‡n táº¡i", 400, "PASSWORD_NOT_CHANGED");
    }

    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    return res.json({
      ok: true,
      message: "Äá»•i máº­t kháº©u thÃ nh cÃ´ng",
    });
  } catch (err) {
    next(err);
  }
}

async function changeMyUsername(req, res, next) {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer) {
      throw new AppError("ChÆ°a xÃ¡c thá»±c ngÆ°á»i dÃ¹ng", 401, "UNAUTHORIZED");
    }

    const rawUsername = String(req.body?.username || req.body?.newUsername || "")
      .trim()
      .toLowerCase();

    if (!rawUsername) {
      throw new AppError("Thiáº¿u username má»›i", 400, "MISSING_NEW_USERNAME");
    }
    if (!USERNAME_PATTERN.test(rawUsername)) {
      throw new AppError("Username chá»‰ gá»“m chá»¯ thÆ°á»ng, sá»‘, dáº¥u gáº¡ch dÆ°á»›i hoáº·c cháº¥m (3-30 kÃ½ tá»±)", 400, "INVALID_USERNAME");
    }
    if (rawUsername === viewer.username) {
      throw new AppError("Username má»›i trÃ¹ng vá»›i username hiá»‡n táº¡i", 400, "USERNAME_NOT_CHANGED");
    }

    const existed = await User.findOne({ username: rawUsername }).select("_id").lean();
    if (existed) {
      throw new AppError("Username Ä‘Ã£ tá»“n táº¡i", 409, "USERNAME_EXISTS");
    }

    const oldUsername = String(viewer.username);
    const oldLegacyId = legacyUserId(oldUsername);
    const newLegacyId = legacyUserId(rawUsername);

    await Promise.all([
      User.updateOne({ _id: viewer._id }, { $set: { username: rawUsername } }),
      syncUsernameReferences({
        oldUsername,
        newUsername: rawUsername,
        oldLegacyId,
        newLegacyId,
      }),
    ]);

    const updated = await User.findById(viewer._id).select(PROFILE_SELECT).lean();
    if (!updated) {
      throw new AppError("KhÃ´ng tÃ¬m tháº¥y ngÆ°á»i dÃ¹ng", 404, "USER_NOT_FOUND");
    }

    const counts = await getCountsForUser(updated);

    return res.json({
      ok: true,
      message: "Äá»•i username thÃ nh cÃ´ng",
      data: {
        ...serializeUser(updated),
        counts,
        relationship: {
          isMe: true,
          isFollowing: false,
          isFollowedBy: false,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  follow,
  unfollow,
  listFollowers,
  listFollowing,
  listUsers,
  updateMyProfile,
  changeMyPassword,
  changeMyUsername,
};

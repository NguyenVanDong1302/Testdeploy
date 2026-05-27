const { AppError } = require("./errors");

function normalizeRestrictions(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    commentBlocked: Boolean(source.commentBlocked),
    messagingBlocked: Boolean(source.messagingBlocked),
    likeBlocked: Boolean(source.likeBlocked),
    dailyPostLimit: Math.max(Number(source.dailyPostLimit) || 0, 0),
  };
}

function buildLockDetails(user) {
  return {
    accountLocked: Boolean(user?.accountLocked),
    lockedAt: user?.accountLockedAt || null,
    reason: String(user?.accountLockedReason || "").trim(),
  };
}

function ensureAccountNotLocked(user) {
  if (!user?.accountLocked) return;
  throw new AppError("Tài khoản đã bị khóa", 423, "ACCOUNT_LOCKED", buildLockDetails(user));
}

function ensureCanComment(user) {
  ensureAccountNotLocked(user);
  const restrictions = normalizeRestrictions(user?.restrictions);
  if (!restrictions.commentBlocked) return;
  throw new AppError("Tài khoản của bạn đã bị khóa tính năng bình luận", 403, "COMMENT_BLOCKED");
}

function ensureCanLike(user) {
  ensureAccountNotLocked(user);
  const restrictions = normalizeRestrictions(user?.restrictions);
  if (!restrictions.likeBlocked) return;
  throw new AppError("Tài khoản của bạn đã bị khóa tính năng thích", 403, "LIKE_BLOCKED");
}

function ensureCanMessage(user) {
  ensureAccountNotLocked(user);
  const restrictions = normalizeRestrictions(user?.restrictions);
  if (!restrictions.messagingBlocked) return;
  throw new AppError("Tài khoản của bạn đã bị chặn nhắn tin", 403, "MESSAGE_BLOCKED");
}

function ensureCanCreatePost(user, todayPostCount = 0) {
  ensureAccountNotLocked(user);
  const restrictions = normalizeRestrictions(user?.restrictions);
  if (!restrictions.dailyPostLimit) return;

  const totalToday = Number(todayPostCount) || 0;
  if (totalToday < restrictions.dailyPostLimit) return;
  throw new AppError(
    `Ban da dat gioi han dang bai trong ngay (${restrictions.dailyPostLimit} bai)`,
    403,
    "POST_LIMIT_REACHED",
  );
}

module.exports = {
  normalizeRestrictions,
  buildLockDetails,
  ensureAccountNotLocked,
  ensureCanComment,
  ensureCanLike,
  ensureCanMessage,
  ensureCanCreatePost,
};

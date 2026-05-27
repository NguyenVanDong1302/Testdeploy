const { z } = require("zod");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const User = require("../models/User");
const Post = require("../models/Post");
const Comment = require("../models/Comment");
const LoginActivity = require("../models/LoginActivity");
const PostReport = require("../models/PostReport");
const { AppError } = require("../utils/errors");
const { postMediaDir } = require("../config/media");
const notificationService = require("../services/notification.service");
const {
  buildModerationWindow,
  queuePostForAutoModeration,
} = require("../services/postModeration.service");
const { normalizeRestrictions } = require("../utils/accountModeration");

const accountStatsQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).optional().default(12),
});

const adminPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  sort: z.enum(["engagement_desc", "engagement_asc"]).optional().default("engagement_desc"),
});

const reportedPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(["all", "pending", "reviewed", "accepted", "rejected"]).optional().default("all"),
  source: z.enum(["all", "user_report", "auto_nsfw"]).optional().default("all"),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
});

const moderationPostSchema = z.object({
  status: z.enum(["normal", "reported", "pending_review", "violating"]),
  reason: z.string().trim().max(500).optional().or(z.literal("")).default(""),
});

const moderationUserSchema = z.object({
  status: z.enum(["normal", "warning", "violating"]),
  reason: z.string().trim().max(500).optional().or(z.literal("")).default(""),
});

const adminAccountsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  keyword: z.string().trim().optional().default(""),
  status: z.enum(["all", "active", "locked"]).optional().default("all"),
});

const userRestrictionsSchema = z.object({
  commentBlocked: z.boolean().optional(),
  messagingBlocked: z.boolean().optional(),
  likeBlocked: z.boolean().optional(),
  verified: z.boolean().optional(),
  dailyPostLimit: z
    .union([z.coerce.number().int().min(0).max(1000), z.null(), z.literal("")])
    .optional(),
  accountLocked: z.boolean().optional(),
  lockReason: z.string().trim().max(500).optional().or(z.literal("")).default(""),
});

const REPORT_RESOLUTION_ACTIONS = ["no_violation", "delete_post", "strike_account", "lock_account"];

const resolveReportSchema = z
  .object({
    decision: z.enum(REPORT_RESOLUTION_ACTIONS).optional(),
    actions: z.array(z.enum(REPORT_RESOLUTION_ACTIONS)).min(1).max(REPORT_RESOLUTION_ACTIONS.length).optional(),
    reason: z.string().trim().max(500).optional().or(z.literal("")).default(""),
  })
  .superRefine((value, ctx) => {
    const hasDecision = typeof value.decision === "string" && value.decision.length > 0;
    const hasActions = Array.isArray(value.actions) && value.actions.length > 0;
    if (!hasDecision && !hasActions) {
      ctx.addIssue({
        code: "custom",
        message: "At least one moderation action is required",
      });
    }
  });

const adminPostActionSchema = z.object({
  action: z.enum(["delete_post", "lock_comments", "unlock_comments"]),
  reason: z.string().trim().max(500).optional().or(z.literal("")).default(""),
  notification: z.string().trim().max(500).optional().or(z.literal("")).default(""),
});

function monthKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildMonthlyBuckets(months) {
  const now = new Date();
  const firstOfCurrentMonthUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const startDate = new Date(firstOfCurrentMonthUtc);
  startDate.setUTCMonth(startDate.getUTCMonth() - (months - 1));

  const buckets = [];
  for (let index = 0; index < months; index += 1) {
    const current = new Date(startDate);
    current.setUTCMonth(startDate.getUTCMonth() + index);
    buckets.push(monthKey(current));
  }

  return { startDate, buckets };
}

function parseDateInput(value, endOfDay = false) {
  if (!value) return null;
  const source = String(value).trim();
  if (!source) return null;
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    if (endOfDay) {
      parsed.setHours(23, 59, 59, 999);
    } else {
      parsed.setHours(0, 0, 0, 0);
    }
  }

  return parsed;
}

function buildCreatedAtRange({ startDate, endDate }) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate, true);
  if ((startDate && !start) || (endDate && !end)) {
    throw new AppError("Invalid date filter", 400, "INVALID_DATE_FILTER");
  }
  if (start && end && start > end) {
    throw new AppError("startDate must be before endDate", 400, "INVALID_DATE_FILTER");
  }
  if (!start && !end) return null;
  return {
    ...(start ? { $gte: start } : {}),
    ...(end ? { $lte: end } : {}),
  };
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toPostTitle(content = "") {
  const normalized = String(content || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "(Không có tiêu đề)";
  if (normalized.length <= 50) return normalized;
  return `${normalized.slice(0, 50)}...`;
}

function resolvePostThumbnail(post = {}) {
  const media = Array.isArray(post.media) ? post.media : [];
  if (media.length > 0) {
    const firstMedia = media[0] || {};
    if (firstMedia.type === "video") {
      return String(firstMedia.thumbnailUrl || firstMedia.url || post.imageUrl || "");
    }
    return String(firstMedia.url || post.imageUrl || "");
  }
  return String(post.imageUrl || "");
}

function resolvePostMediaType(post = {}) {
  const media = Array.isArray(post.media) ? post.media : [];
  if (media.length > 0) {
    const firstType = String(media[0]?.type || "").toLowerCase();
    return firstType === "video" ? "video" : "image";
  }
  return post.imageUrl ? "image" : "text";
}

function normalizeSnapshotMedia(media = []) {
  if (!Array.isArray(media)) return [];
  return media.map((item, index) => ({
    type: String(item?.type || "").toLowerCase() === "video" ? "video" : "image",
    url: String(item?.url || ""),
    thumbnailUrl: String(item?.thumbnailUrl || ""),
    filename: String(item?.filename || ""),
    mimeType: String(item?.mimeType || ""),
    size: Math.max(Number(item?.size) || 0, 0),
    order: Number.isFinite(item?.order) ? item.order : index,
  }));
}

function normalizeReportSnapshot(snapshot = null) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const media = normalizeSnapshotMedia(snapshot.media);
  return {
    authorId: String(snapshot.authorId || ""),
    authorUsername: String(snapshot.authorUsername || ""),
    content: String(snapshot.content || ""),
    media,
    imageUrl: String(snapshot.imageUrl || media.find((item) => item.type === "image")?.url || ""),
    mediaType: String(snapshot.mediaType || resolvePostMediaType({ media, imageUrl: snapshot.imageUrl || "" })),
    allowComments: snapshot.allowComments !== false,
    createdAt: snapshot.createdAt || null,
    deletedAt: snapshot.deletedAt || null,
    moderationReason: String(snapshot.moderationReason || ""),
  };
}

function resolvePostSource(post = null, snapshot = null) {
  if (post) return post;
  return snapshot || {};
}

function findLatestReportSnapshot(reports = []) {
  if (!Array.isArray(reports) || reports.length === 0) return null;
  for (const report of reports) {
    const snapshot = normalizeReportSnapshot(report?.postSnapshot);
    if (snapshot) return snapshot;
  }
  return null;
}

function removePostMediaFiles(post = {}) {
  const media = Array.isArray(post.media) ? post.media : [];
  for (const item of media) {
    const mediaUrl = String(item?.url || "").trim();
    if (!mediaUrl) continue;
    const filename = path.basename(mediaUrl);
    const absolutePath = path.join(postMediaDir, filename);
    if (!absolutePath.toLowerCase().startsWith(path.resolve(postMediaDir).toLowerCase())) continue;
    try {
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    } catch (_err) {
      // ignore delete file failure
    }
  }
}

function serializeAdminAccount(user = {}) {
  return {
    id: String(user._id),
    username: user.username || "",
    email: user.email || "",
    role: user.role || "user",
    moderationStatus: user.moderationStatus || "normal",
    moderationReason: user.moderationReason || "",
    isVerified: Boolean(user.isVerified),
    verifiedAt: user.verifiedAt || null,
    verifiedBy: user.verifiedBy || "",
    strikesCount: Number(user.strikesCount) || 0,
    accountLocked: Boolean(user.accountLocked),
    accountLockedAt: user.accountLockedAt || null,
    accountLockedReason: user.accountLockedReason || "",
    restrictions: normalizeRestrictions(user.restrictions),
    loginCount: Number(user.loginCount) || 0,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function resolveReportActions(payload = {}) {
  const fromActions = Array.isArray(payload.actions) ? payload.actions : [];
  const fromDecision = payload.decision ? [payload.decision] : [];
  const selected = fromActions.length ? fromActions : fromDecision.length ? fromDecision : ["no_violation"];
  const uniqueActions = Array.from(new Set(selected));
  const hasNoViolation = uniqueActions.includes("no_violation");
  const punitiveActions = uniqueActions.filter((action) => action !== "no_violation");
  if (hasNoViolation && punitiveActions.length) {
    throw new AppError(
      "no_violation cannot be combined with punitive actions",
      400,
      "VALIDATION_ERROR",
    );
  }
  if (!uniqueActions.length) return ["no_violation"];
  return punitiveActions.length ? punitiveActions : ["no_violation"];
}

function buildModerationNotificationMessage({ decision, reason, strikesCount = 0, autoLocked = false }) {
  const cleanReason = String(reason || "").trim();
  if (decision === "delete_post") {
    return cleanReason
      ? `Bài viết của bạn đã bị xóa do vi phạm: ${cleanReason}`
      : "Bài viết của bạn đã bị xóa do vi phạm tiêu chuẩn cộng đồng.";
  }
  if (decision === "strike_account") {
    const strikeText = `Tài khoản của bạn nhận 1 gậy (${strikesCount}/3).`;
    const lockText = autoLocked ? " Tài khoản đã bị khóa do đủ 3 gậy." : "";
    return cleanReason ? `${strikeText}${lockText} Lý do: ${cleanReason}` : `${strikeText}${lockText}`;
  }
  if (decision === "lock_account") {
    return cleanReason
      ? `Tài khoản của bạn đã bị khóa bởi quản trị viên. Lý do: ${cleanReason}`
      : "Tài khoản của bạn đã bị khóa bởi quản trị viên.";
  }
  return cleanReason || "Báo cáo đã được xử lý bởi quản trị viên.";
}

function buildModerationNotificationMessageFromActions({
  actions = [],
  reason,
  strikesCount = 0,
  autoLocked = false,
}) {
  const normalizedActions = Array.from(new Set(actions));
  if (!normalizedActions.length) {
    return buildModerationNotificationMessage({ decision: "no_violation", reason, strikesCount, autoLocked });
  }
  if (normalizedActions.length === 1) {
    return buildModerationNotificationMessage({
      decision: normalizedActions[0],
      reason,
      strikesCount,
      autoLocked,
    });
  }

  const fragments = [];
  if (normalizedActions.includes("delete_post")) {
    fragments.push("Bài viết của bạn đã bị xóa do vi phạm tiêu chuẩn cộng đồng.");
  }
  if (normalizedActions.includes("strike_account")) {
    const strikeText = `Tài khoản của bạn nhận 1 gậy (${strikesCount}/3).`;
    const lockText = autoLocked ? " Tài khoản đã bị khóa do đủ 3 gậy." : "";
    fragments.push(`${strikeText}${lockText}`.trim());
  }
  if (normalizedActions.includes("lock_account") && !autoLocked) {
    fragments.push("Tài khoản của bạn đã bị khóa bởi quản trị viên.");
  }

  const base = fragments.join(" ").trim() || "Báo cáo đã được xử lý bởi quản trị viên.";
  const cleanReason = String(reason || "").trim();
  return cleanReason ? `${base} Lý do: ${cleanReason}` : base;
}

function buildAdminPostActionMessage({ action, reason }) {
  const cleanReason = String(reason || "").trim();
  if (action === "delete_post") {
    return cleanReason
      ? `Bài viết của bạn đã bị xóa bởi admin. Lý do: ${cleanReason}`
      : "Bài viết của bạn đã bị xóa bởi admin.";
  }
  if (action === "lock_comments") {
    return cleanReason
      ? `Admin đã khóa bình luận bài viết của bạn. Lý do: ${cleanReason}`
      : "Admin đã khóa bình luận bài viết của bạn.";
  }
  if (action === "unlock_comments") {
    return cleanReason
      ? `Admin đã mở lại bình luận bài viết của bạn. Ghi chú: ${cleanReason}`
      : "Admin đã mở lại bình luận bài viết của bạn.";
  }
  return cleanReason || "Bài viết của bạn đã được cập nhật bởi admin.";
}

async function buildCommentCountMap(postIds = []) {
  if (!postIds.length) return new Map();
  const rows = await Comment.aggregate([
    { $match: { postId: { $in: postIds } } },
    { $group: { _id: "$postId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), Number(row.count) || 0]));
}

async function getAccountStats(req, res, next) {
  try {
    const { months } = accountStatsQuerySchema.parse(req.query || {});
    const { startDate, buckets } = buildMonthlyBuckets(months);

    const [newUsersRaw, loginsRaw, totalAccounts, totalLoginsRaw, activeLast30Days, topLoginUsers] =
      await Promise.all([
        User.aggregate([
          { $match: { createdAt: { $gte: startDate } } },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
              },
              count: { $sum: 1 },
            },
          },
        ]),
        LoginActivity.aggregate([
          { $match: { loggedInAt: { $gte: startDate } } },
          {
            $group: {
              _id: {
                year: { $year: "$loggedInAt" },
                month: { $month: "$loggedInAt" },
              },
              count: { $sum: 1 },
            },
          },
        ]),
        User.countDocuments({}),
        User.aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: { $ifNull: ["$loginCount", 0] } },
            },
          },
        ]),
        User.countDocuments({
          lastLoginAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        }),
        User.find({ loginCount: { $gt: 0 } })
          .select("username loginCount lastLoginAt role")
          .sort({ loginCount: -1, lastLoginAt: -1 })
          .limit(10)
          .lean(),
      ]);

    const monthlyNewUsersMap = new Map(
      newUsersRaw.map((row) => [
        `${String(row._id?.year || "").padStart(4, "0")}-${String(row._id?.month || "").padStart(2, "0")}`,
        Number(row.count) || 0,
      ]),
    );
    const monthlyLoginMap = new Map(
      loginsRaw.map((row) => [
        `${String(row._id?.year || "").padStart(4, "0")}-${String(row._id?.month || "").padStart(2, "0")}`,
        Number(row.count) || 0,
      ]),
    );

    const monthly = buckets.map((month) => ({
      month,
      newAccounts: monthlyNewUsersMap.get(month) || 0,
      loginCount: monthlyLoginMap.get(month) || 0,
    }));

    const totalLogins = Number(totalLoginsRaw?.[0]?.total) || 0;

    res.json({
      ok: true,
      data: {
        summary: {
          totalAccounts: Number(totalAccounts) || 0,
          totalLogins,
          activeLast30Days: Number(activeLast30Days) || 0,
        },
        monthly,
        topLoginUsers: topLoginUsers.map((item) => ({
          id: String(item._id),
          username: item.username || "",
          role: item.role || "user",
          loginCount: Number(item.loginCount) || 0,
          lastLoginAt: item.lastLoginAt || null,
        })),
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(new AppError(err.issues?.[0]?.message || "Invalid query", 400, "VALIDATION_ERROR"));
    }
    next(err);
  }
}

async function listAccountsForAdmin(req, res, next) {
  try {
    const { page, limit, keyword, status } = adminAccountsQuerySchema.parse(req.query || {});
    const skip = (page - 1) * limit;

    const filter = {};
    if (status === "locked") filter.accountLocked = true;
    if (status === "active") filter.accountLocked = false;
    if (keyword) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { username: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
      ];
    }

    const [rows, total] = await Promise.all([
      User.find(filter)
        .select(
          "username email role moderationStatus moderationReason isVerified verifiedAt verifiedBy strikesCount accountLocked accountLockedAt accountLockedReason restrictions loginCount lastLoginAt createdAt updatedAt",
        )
        .sort({ accountLocked: -1, strikesCount: -1, updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      ok: true,
      data: {
        items: rows.map(serializeAdminAccount),
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
        filters: {
          keyword,
          status,
        },
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(new AppError(err.issues?.[0]?.message || "Invalid query", 400, "VALIDATION_ERROR"));
    }
    next(err);
  }
}

async function listPostsForAdmin(req, res, next) {
  try {
    const { page, limit, startDate, endDate, sort } = adminPostsQuerySchema.parse(req.query || {});
    const skip = (page - 1) * limit;
    const createdAtRange = buildCreatedAtRange({ startDate, endDate });

    const match = {};
    if (createdAtRange) {
      match.createdAt = createdAtRange;
    }

    const sortDirection = sort === "engagement_asc" ? 1 : -1;
    const pipeline = [
      { $match: match },
      { $addFields: { likesCount: { $size: { $ifNull: ["$likes", []] } } } },
      {
        $lookup: {
          from: "comments",
          let: { postId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$postId", "$$postId"] },
              },
            },
            { $count: "count" },
          ],
          as: "commentStats",
        },
      },
      {
        $addFields: {
          commentsCount: { $ifNull: [{ $arrayElemAt: ["$commentStats.count", 0] }, 0] },
        },
      },
      {
        $addFields: {
          engagementCount: { $add: ["$likesCount", "$commentsCount"] },
        },
      },
      { $project: { commentStats: 0 } },
      {
        $sort: {
          engagementCount: sortDirection,
          createdAt: -1,
          _id: -1,
        },
      },
      { $skip: skip },
      { $limit: limit },
    ];

    const [rows, total] = await Promise.all([
      Post.aggregate(pipeline),
      Post.countDocuments(match),
    ]);

    const items = rows.map((post) => ({
      id: String(post._id),
      title: toPostTitle(post.content),
      fullTitle: String(post.content || "").replace(/\s+/g, " ").trim(),
      thumbnailUrl: resolvePostThumbnail(post),
      mediaType: resolvePostMediaType(post),
      authorUsername: post.authorUsername || "",
      createdAt: post.createdAt || null,
      likesCount: Number(post.likesCount) || 0,
      commentsCount: Number(post.commentsCount) || 0,
      engagementCount: Number(post.engagementCount) || 0,
      reportCount: Number(post.reportCount) || 0,
      allowComments: post.allowComments !== false,
      moderationStatus: post.moderationStatus || "normal",
      moderationReason: post.moderationReason || "",
    }));

    res.json({
      ok: true,
      data: {
        items,
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
        filters: {
          startDate: startDate || "",
          endDate: endDate || "",
          sort,
        },
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(new AppError(err.issues?.[0]?.message || "Invalid query", 400, "VALIDATION_ERROR"));
    }
    next(err);
  }
}

async function listReportedPosts(req, res, next) {
  try {
    const { page, limit, status, source, startDate, endDate } = reportedPostsQuerySchema.parse(req.query || {});
    const skip = (page - 1) * limit;
    const createdAtRange = buildCreatedAtRange({ startDate, endDate });

    const match = {};
    if (status !== "all") match.status = status;
    if (source !== "all") match.source = source;
    if (createdAtRange) match.createdAt = createdAtRange;

    const [grouped, totalRaw] = await Promise.all([
      PostReport.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$postId",
            reportCount: { $sum: 1 },
            pendingCount: {
              $sum: {
                $cond: [{ $eq: ["$status", "pending"] }, 1, 0],
              },
            },
            lastReportedAt: { $first: "$createdAt" },
            latestReason: { $first: "$reason" },
            statuses: { $addToSet: "$status" },
            latestSource: { $first: "$source" },
            latestSnapshot: { $first: "$postSnapshot" },
            latestAutoModeratedAt: { $first: "$autoModeratedAt" },
          },
        },
        { $sort: { reportCount: -1, lastReportedAt: -1, _id: -1 } },
        { $skip: skip },
        { $limit: limit },
      ]),
      PostReport.aggregate([
        { $match: match },
        { $group: { _id: "$postId" } },
        { $count: "count" },
      ]),
    ]);

    const postIds = grouped.map((row) => row._id).filter(Boolean);
    const [posts, commentCountMap] = await Promise.all([
      Post.find({ _id: { $in: postIds } })
        .select("content media imageUrl authorUsername createdAt likes reportCount moderationStatus moderationReason allowComments")
        .lean(),
      buildCommentCountMap(postIds),
    ]);

    const postMap = new Map(posts.map((post) => [String(post._id), post]));

    const items = grouped.map((row) => {
      const post = postMap.get(String(row._id));
      const snapshot = normalizeReportSnapshot(row.latestSnapshot);
      const source = resolvePostSource(post, snapshot);
      const likesCount = Array.isArray(post?.likes) ? post.likes.length : 0;
      const commentsCount = post ? commentCountMap.get(String(row._id)) || 0 : 0;
      const effectiveReportCount =
        Number(post?.reportCount) > 0 ? Number(post.reportCount) : Number(row.reportCount) || 0;

      return {
        id: String(row._id),
        title: toPostTitle(source?.content || ""),
        thumbnailUrl: resolvePostThumbnail(source || {}),
        mediaType: resolvePostMediaType(source || {}),
        authorUsername: source?.authorUsername || "(unknown)",
        createdAt: source?.createdAt || null,
        likesCount,
        commentsCount,
        engagementCount: likesCount + commentsCount,
        reportCount: effectiveReportCount,
        pendingCount: Number(row.pendingCount) || 0,
        lastReportedAt: row.lastReportedAt || null,
        latestReason: row.latestReason || "",
        statuses: Array.isArray(row.statuses) ? row.statuses : [],
        moderationStatus: post?.moderationStatus || (snapshot ? "violating" : "normal"),
        moderationReason: post?.moderationReason || snapshot?.moderationReason || "",
        allowComments: post ? post.allowComments !== false : snapshot?.allowComments !== false,
        postExists: Boolean(post),
        reportSource: row.latestSource || "user_report",
        autoModeratedAt: row.latestAutoModeratedAt || snapshot?.deletedAt || null,
      };
    });

    const total = Number(totalRaw?.[0]?.count) || 0;

    res.json({
      ok: true,
      data: {
        items,
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
        filters: {
          status,
          source,
          startDate: startDate || "",
          endDate: endDate || "",
        },
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(new AppError(err.issues?.[0]?.message || "Invalid query", 400, "VALIDATION_ERROR"));
    }
    next(err);
  }
}

async function getPostDetailForAdmin(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid post id", 400, "INVALID_ID");
    }

    const postId = req.params.id;
    const [post, reports] = await Promise.all([
      Post.findById(postId)
        .select(
          "authorId authorUsername content media imageUrl allowComments likes reportCount lastReportedAt moderationStatus moderationReason createdAt updatedAt",
        )
        .lean(),
      PostReport.find({ postId })
        .select(
          "reporterId reporterUsername reason status reviewedBy reviewedAt createdAt source postSnapshot detectionSignals autoModeratedAt",
        )
        .sort({ createdAt: -1, _id: -1 })
        .limit(30)
        .lean(),
    ]);

    if (!post && reports.length === 0) throw new AppError("Post not found", 404, "NOT_FOUND");

    const snapshot = findLatestReportSnapshot(reports);
    if (!post && !snapshot) throw new AppError("Post not found", 404, "NOT_FOUND");

    const source = resolvePostSource(post, snapshot);
    const commentsCount = post ? await Comment.countDocuments({ postId: post._id }) : 0;
    const likesCount = Array.isArray(post?.likes) ? post.likes.length : 0;
    const detail = {
      id: String(post?._id || postId),
      title: toPostTitle(source?.content || ""),
      fullTitle: String(source?.content || "").replace(/\s+/g, " ").trim(),
      content: String(source?.content || ""),
      thumbnailUrl: resolvePostThumbnail(source),
      mediaType: resolvePostMediaType(source),
      media: Array.isArray(source?.media) ? source.media : [],
      imageUrl: String(source?.imageUrl || ""),
      authorId: String(post?.authorId || snapshot?.authorId || ""),
      authorUsername: source?.authorUsername || "(unknown)",
      createdAt: source?.createdAt || null,
      updatedAt: post?.updatedAt || null,
      likesCount,
      commentsCount: Number(commentsCount) || 0,
      engagementCount: likesCount + (Number(commentsCount) || 0),
      reportCount: Number(post?.reportCount) || reports.length,
      lastReportedAt: post?.lastReportedAt || reports[0]?.createdAt || null,
      allowComments: post ? post.allowComments !== false : snapshot?.allowComments !== false,
      moderationStatus: post?.moderationStatus || (snapshot ? "violating" : "normal"),
      moderationReason: post?.moderationReason || snapshot?.moderationReason || "",
      postPath: post ? `/post/${String(post._id)}` : "",
      postExists: Boolean(post),
      reportSource: reports[0]?.source || "user_report",
      autoModeratedAt: reports[0]?.autoModeratedAt || snapshot?.deletedAt || null,
    };

    res.json({
      ok: true,
      data: {
        post: detail,
        reports: reports.map((item) => ({
          id: String(item._id),
          reporterId: String(item.reporterId || ""),
          reporterUsername: item.reporterUsername || "",
          reason: item.reason || "",
          status: item.status || "pending",
          reviewedBy: item.reviewedBy || "",
          reviewedAt: item.reviewedAt || null,
          createdAt: item.createdAt || null,
          source: item.source || "user_report",
          detectionSignals: Array.isArray(item.detectionSignals) ? item.detectionSignals : [],
          autoModeratedAt: item.autoModeratedAt || null,
          hasSnapshot: Boolean(item.postSnapshot),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function applyPostActionForAdmin(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid post id", 400, "INVALID_ID");
    }

    const body = adminPostActionSchema.parse(req.body || {});
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");

    const action = body.action;
    const reason = String(body.reason || "").trim();
    const customNotification = String(body.notification || "").trim();

    let removedPost = false;
    let updatedPost = null;

    if (action === "delete_post") {
      removePostMediaFiles(post);
      await Promise.all([Comment.deleteMany({ postId: post._id }), Post.deleteOne({ _id: post._id })]);
      removedPost = true;
    } else {
      post.allowComments = action === "unlock_comments";
      await post.save();
      updatedPost = {
        id: String(post._id),
        allowComments: post.allowComments !== false,
        moderationStatus: post.moderationStatus || "normal",
        moderationReason: post.moderationReason || "",
      };
    }

    const postAuthor = await User.findOne({ username: post.authorUsername }).select("_id username").lean();
    if (postAuthor?._id) {
      const message = customNotification || buildAdminPostActionMessage({ action, reason });
      await notificationService.notifyModerationAction({
        recipientId: String(postAuthor._id),
        actorId: req.adminUser?.id || "admin_system",
        actorUsername: req.adminUser?.username || "admin",
        postId: String(post._id),
        previewText: message,
      });
    }

    res.json({
      ok: true,
      message: "Admin post action applied",
      data: {
        postId: String(post._id),
        action,
        reason,
        removedPost,
        post: updatedPost,
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(new AppError(err.issues?.[0]?.message || "Invalid payload", 400, "VALIDATION_ERROR"));
    }
    next(err);
  }
}

async function listViolations(req, res, next) {
  try {
    const includeWarning = parseBoolean(req.query?.includeWarning, true);
    const userStatuses = includeWarning ? ["warning", "violating"] : ["violating"];

    const [users, posts] = await Promise.all([
      User.find({
        $or: [
          { moderationStatus: { $in: userStatuses } },
          { accountLocked: true },
          { strikesCount: { $gt: 0 } },
        ],
      })
        .select(
          "username email role moderationStatus moderationReason isVerified verifiedAt verifiedBy strikesCount accountLocked accountLockedAt accountLockedReason restrictions createdAt updatedAt loginCount lastLoginAt",
        )
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean(),
      Post.find({ moderationStatus: "violating" })
        .select("content media imageUrl authorUsername createdAt updatedAt likes reportCount moderationStatus moderationReason")
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean(),
    ]);

    const postIds = posts.map((post) => post._id);
    const commentCountMap = await buildCommentCountMap(postIds);

    res.json({
      ok: true,
      data: {
        summary: {
          violatingAccounts: users.filter((user) =>
            user.accountLocked || user.moderationStatus === "violating" || Number(user.strikesCount) > 0,
          ).length,
          violatingPosts: posts.length,
        },
        accounts: users.map(serializeAdminAccount),
        posts: posts.map((post) => {
          const likesCount = Array.isArray(post.likes) ? post.likes.length : 0;
          const commentsCount = commentCountMap.get(String(post._id)) || 0;
          return {
            id: String(post._id),
            title: toPostTitle(post.content),
            thumbnailUrl: resolvePostThumbnail(post),
            mediaType: resolvePostMediaType(post),
            authorUsername: post.authorUsername || "",
            moderationStatus: post.moderationStatus || "normal",
            moderationReason: post.moderationReason || "",
            reportCount: Number(post.reportCount) || 0,
            likesCount,
            commentsCount,
            engagementCount: likesCount + commentsCount,
            createdAt: post.createdAt || null,
            updatedAt: post.updatedAt || null,
          };
        }),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updatePostModeration(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid post id", 400, "INVALID_ID");
    }
    const body = moderationPostSchema.parse(req.body || {});
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");

    const nextStatus = body.status;
    post.moderationStatus = nextStatus;
    post.moderationReason = body.reason || "";
    if (nextStatus === "pending_review") {
      const moderationWindow = buildModerationWindow(new Date());
      post.moderationQueuedAt = moderationWindow.queuedAt;
      post.moderationDeadlineAt = moderationWindow.deadlineAt;
      post.moderationProcessedAt = null;
    } else if (!post.moderationProcessedAt) {
      post.moderationProcessedAt = new Date();
    }

    if (nextStatus === "normal") {
      post.reportCount = 0;
      post.lastReportedAt = null;
    } else if (nextStatus !== "normal" && !post.lastReportedAt && post.reportCount > 0) {
      post.lastReportedAt = new Date();
    }

    await post.save();

    if (nextStatus === "pending_review") {
      queuePostForAutoModeration(String(post._id));
    }

    if (nextStatus === "normal") {
      await PostReport.updateMany(
        { postId: post._id, status: "pending" },
        {
          $set: {
            status: "reviewed",
            reviewedAt: new Date(),
            reviewedBy: req.adminUser?.username || "admin",
          },
        },
      );
    } else if (nextStatus === "violating") {
      await PostReport.updateMany(
        { postId: post._id, status: "pending" },
        {
          $set: {
            status: "accepted",
            reviewedAt: new Date(),
            reviewedBy: req.adminUser?.username || "admin",
          },
        },
      );
    }

    res.json({
      ok: true,
      message: "Post moderation updated",
      data: {
        id: String(post._id),
        moderationStatus: post.moderationStatus,
        moderationReason: post.moderationReason || "",
        reportCount: Number(post.reportCount) || 0,
        lastReportedAt: post.lastReportedAt || null,
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(new AppError(err.issues?.[0]?.message || "Invalid payload", 400, "VALIDATION_ERROR"));
    }
    next(err);
  }
}

async function resolveReportedPost(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid post id", 400, "INVALID_ID");
    }

    const body = resolveReportSchema.parse(req.body || {});
    const [post, latestReport] = await Promise.all([
      Post.findById(req.params.id),
      PostReport.findOne({ postId: req.params.id })
        .select("postSnapshot")
        .sort({ createdAt: -1, _id: -1 })
        .lean(),
    ]);
    if (!post && !latestReport) throw new AppError("Post not found", 404, "NOT_FOUND");
    const snapshot = normalizeReportSnapshot(latestReport?.postSnapshot);

    const adminName = req.adminUser?.username || "admin";
    const reviewedAt = new Date();
    const actions = resolveReportActions(body);
    const decision = actions[0] || "no_violation";
    const reason = String(body.reason || "").trim();
    const isViolation = !actions.includes("no_violation");
    const nextReportStatus = isViolation ? "accepted" : "rejected";
    const shouldDeletePost = actions.includes("delete_post");
    const shouldStrikeAccount = actions.includes("strike_account");
    const shouldLockAccount = actions.includes("lock_account");
    const targetPostId = String(post?._id || req.params.id);

    await PostReport.updateMany(
      { postId: req.params.id, status: "pending" },
      {
        $set: {
          status: nextReportStatus,
          reviewedAt,
          reviewedBy: adminName,
        },
      },
    );

    let removedPost = !post;
    if (!isViolation) {
      if (post) {
        post.moderationStatus = "normal";
        post.moderationReason = "";
        post.reportCount = 0;
        post.lastReportedAt = null;
        await post.save();
      }
    } else {
      if (shouldDeletePost) {
        if (post) {
          removePostMediaFiles(post);
          await Promise.all([
            Comment.deleteMany({ postId: post._id }),
            Post.deleteOne({ _id: post._id }),
          ]);
        }
        removedPost = true;
      } else if (post) {
        post.moderationStatus = "violating";
        post.moderationReason = reason || post.moderationReason || "";
        await post.save();
      }
    }

    const authorUsername = String(post?.authorUsername || snapshot?.authorUsername || "").trim();
    const fallbackAuthorId = String(snapshot?.authorId || "").trim();

    let postAuthor = null;
    if (authorUsername) {
      postAuthor = await User.findOne({ username: authorUsername });
    }
    if (!postAuthor && fallbackAuthorId && mongoose.Types.ObjectId.isValid(fallbackAuthorId)) {
      postAuthor = await User.findById(fallbackAuthorId);
    }

    let accountState = null;
    let autoLocked = false;

    if (postAuthor && isViolation) {
      let accountChanged = false;

      if (shouldStrikeAccount) {
        postAuthor.strikesCount = (Number(postAuthor.strikesCount) || 0) + 1;
        accountChanged = true;
        if (postAuthor.strikesCount >= 3) {
          postAuthor.accountLocked = true;
          if (!postAuthor.accountLockedAt) postAuthor.accountLockedAt = reviewedAt;
          postAuthor.accountLockedReason =
            reason || postAuthor.accountLockedReason || "Tài khoản đã bị khóa do đủ 3 gậy vi phạm";
          autoLocked = true;
        }
      }

      if (shouldLockAccount) {
        postAuthor.accountLocked = true;
        if (!postAuthor.accountLockedAt) postAuthor.accountLockedAt = reviewedAt;
        if (reason) {
          postAuthor.accountLockedReason = reason;
        } else if (!postAuthor.accountLockedReason) {
          postAuthor.accountLockedReason = "Tài khoản bị khóa bởi admin";
        }
        accountChanged = true;
      }

      if (accountChanged) {
        await postAuthor.save();
      }
      accountState = serializeAdminAccount(postAuthor);

      const message = buildModerationNotificationMessageFromActions({
        actions,
        reason,
        strikesCount: postAuthor.strikesCount,
        autoLocked,
      });

      await notificationService.notifyModerationAction({
        recipientId: String(postAuthor._id),
        actorId: req.adminUser?.id || "admin_system",
        actorUsername: adminName,
        postId: targetPostId,
        previewText: message,
      });
    }

    res.json({
      ok: true,
      message: "Report handled successfully",
      data: {
        postId: targetPostId,
        decision,
        actions,
        reason,
        removedPost,
        reportStatus: nextReportStatus,
        moderationStatus: isViolation ? "violating" : "normal",
        account: accountState,
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(new AppError(err.issues?.[0]?.message || "Invalid payload", 400, "VALIDATION_ERROR"));
    }
    next(err);
  }
}

async function updateUserRestrictions(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid user id", 400, "INVALID_ID");
    }
    const body = userRestrictionsSchema.parse(req.body || {});
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError("User not found", 404, "NOT_FOUND");

    const previousRestrictions = normalizeRestrictions(user.restrictions);
    const nextRestrictions = { ...previousRestrictions };

    if (typeof body.commentBlocked === "boolean") nextRestrictions.commentBlocked = body.commentBlocked;
    if (typeof body.messagingBlocked === "boolean") nextRestrictions.messagingBlocked = body.messagingBlocked;
    if (typeof body.likeBlocked === "boolean") nextRestrictions.likeBlocked = body.likeBlocked;
    if (body.dailyPostLimit !== undefined) {
      nextRestrictions.dailyPostLimit =
        body.dailyPostLimit === null || body.dailyPostLimit === ""
          ? 0
          : Math.max(Number(body.dailyPostLimit) || 0, 0);
    }

    user.restrictions = nextRestrictions;

    if (typeof body.verified === "boolean") {
      user.isVerified = body.verified;
      if (body.verified) {
        if (!user.verifiedAt) user.verifiedAt = new Date();
        user.verifiedBy = req.adminUser?.username || "admin";
      } else {
        user.verifiedAt = null;
        user.verifiedBy = "";
      }
    }

    const wasLocked = Boolean(user.accountLocked);
    if (typeof body.accountLocked === "boolean") {
      user.accountLocked = body.accountLocked;
      if (body.accountLocked) {
        if (!user.accountLockedAt) user.accountLockedAt = new Date();
        if (body.lockReason) {
          user.accountLockedReason = body.lockReason;
        } else if (!user.accountLockedReason) {
          user.accountLockedReason = "Tài khoản bị khóa bởi admin";
        }
      } else {
        user.accountLockedAt = null;
        user.accountLockedReason = "";
      }
    } else if (body.lockReason && user.accountLocked) {
      user.accountLockedReason = body.lockReason;
    }

    await user.save();

    if (user.accountLocked && (!wasLocked || body.lockReason)) {
      const message = buildModerationNotificationMessage({
        decision: "lock_account",
        reason: user.accountLockedReason || body.lockReason || "",
      });
      await notificationService.notifyModerationAction({
        recipientId: String(user._id),
        actorId: req.adminUser?.id || "admin_system",
        actorUsername: req.adminUser?.username || "admin",
        previewText: message,
      });
    }

    res.json({
      ok: true,
      message: "User restrictions updated",
      data: serializeAdminAccount(user),
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(new AppError(err.issues?.[0]?.message || "Invalid payload", 400, "VALIDATION_ERROR"));
    }
    next(err);
  }
}

async function updateUserModeration(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid user id", 400, "INVALID_ID");
    }
    const body = moderationUserSchema.parse(req.body || {});
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError("User not found", 404, "NOT_FOUND");

    user.moderationStatus = body.status;
    user.moderationReason = body.reason || "";
    await user.save();

    res.json({
      ok: true,
      message: "User moderation updated",
      data: {
        id: String(user._id),
        username: user.username,
        moderationStatus: user.moderationStatus,
        moderationReason: user.moderationReason || "",
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(new AppError(err.issues?.[0]?.message || "Invalid payload", 400, "VALIDATION_ERROR"));
    }
    next(err);
  }
}

module.exports = {
  getAccountStats,
  listAccountsForAdmin,
  listPostsForAdmin,
  getPostDetailForAdmin,
  applyPostActionForAdmin,
  listReportedPosts,
  listViolations,
  updatePostModeration,
  resolveReportedPost,
  updateUserRestrictions,
  updateUserModeration,
};

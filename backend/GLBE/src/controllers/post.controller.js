const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const Post = require("../models/Post");
const { AppError } = require("../utils/errors");
const Comment = require("../models/Comment");
const PostReport = require("../models/PostReport");
const User = require("../models/User");
const { getIO } = require("../realtime/socket");
const { postMediaDir } = require("../config/media");
const notificationService = require("../services/notification.service");
const {
  buildModerationWindow,
  getAutoModerationMaxProcessingMs,
  queuePostForAutoModeration,
} = require("../services/postModeration.service");
const {
  ensureAccountNotLocked,
  ensureCanComment,
  ensureCanLike,
  ensureCanCreatePost,
} = require("../utils/accountModeration");

const visibilityEnum = ["public", "friends", "private"];
const PUBLIC_VISIBLE_POST_STATUSES = new Set(["normal", "reported"]);
const POST_INTERACTION_BLOCKED_STATUSES = new Set(["pending_review", "violating"]);
const MEDIA_PUBLIC_BASE_URL = (
  process.env.MEDIA_PUBLIC_BASE_URL || "http://localhost:4000"
).replace(/\/$/, "");

const createPostSchema = z
  .object({
    content: z.string().trim().max(3000).optional().default(""),
    visibility: z.enum(visibilityEnum).optional().default("public"),
    isAnonymous: z.union([z.boolean(), z.string()]).optional().default(false),
    allowComments: z.union([z.boolean(), z.string()]).optional().default(true),
    hideLikeCount: z.union([z.boolean(), z.string()]).optional().default(false),
    location: z.string().trim().max(150).optional().or(z.literal("")).default(""),
    collaborators: z.union([z.string(), z.array(z.string())]).optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    altText: z.string().trim().max(500).optional().or(z.literal("")).default(""),
  })
  .transform((data) => ({
    ...data,
    isAnonymous: normalizeBoolean(data.isAnonymous, false),
    allowComments: normalizeBoolean(data.allowComments, true),
    hideLikeCount: normalizeBoolean(data.hideLikeCount, false),
    collaborators: normalizeStringList(data.collaborators),
    tags: normalizeStringList(data.tags),
  }));

const addCommentSchema = z.object({
  content: z.string().trim().max(1000).optional().default(""),
  parentCommentId: z.string().trim().optional().nullable(),
  replyToCommentId: z.string().trim().optional().nullable(),
});

const updatePostSchema = z
  .object({
    content: z.string().trim().max(3000).optional(),
    visibility: z.enum(visibilityEnum).optional(),
    isAnonymous: z.union([z.boolean(), z.string()]).optional(),
    allowComments: z.union([z.boolean(), z.string()]).optional(),
    hideLikeCount: z.union([z.boolean(), z.string()]).optional(),
    location: z.string().trim().max(150).optional().or(z.literal("")),
    collaborators: z.union([z.string(), z.array(z.string())]).optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .transform((data) => ({
    ...data,
    ...(data.isAnonymous !== undefined
      ? { isAnonymous: normalizeBoolean(data.isAnonymous, false) }
      : {}),
    ...(data.allowComments !== undefined
      ? { allowComments: normalizeBoolean(data.allowComments, true) }
      : {}),
    ...(data.hideLikeCount !== undefined
      ? { hideLikeCount: normalizeBoolean(data.hideLikeCount, false) }
      : {}),
    ...(data.collaborators !== undefined
      ? { collaborators: normalizeStringList(data.collaborators) }
      : {}),
    ...(data.tags !== undefined ? { tags: normalizeStringList(data.tags) } : {}),
  }));

const reportPostSchema = z.object({
  reason: z.string().trim().min(2).max(500).optional().default("Noi dung khong phu hop"),
});

function truncateText(value = "", maxLength = 500) {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 3, 0))}...`;
}

function buildPostReportSnapshot(post = {}, { moderationReason = "", deletedAt = null } = {}) {
  const media = Array.isArray(post.media)
    ? post.media.map((item, index) => ({
        type: item?.type === "video" ? "video" : "image",
        url: String(item?.url || ""),
        thumbnailUrl: String(item?.thumbnailUrl || ""),
        filename: String(item?.filename || ""),
        mimeType: String(item?.mimeType || ""),
        size: Math.max(Number(item?.size) || 0, 0),
        order: Number.isFinite(item?.order) ? item.order : index,
      }))
    : [];

  return {
    authorId: String(post.authorId || ""),
    authorUsername: String(post.authorUsername || ""),
    content: String(post.content || ""),
    media,
    imageUrl: String(post.imageUrl || media.find((item) => item.type === "image")?.url || ""),
    mediaType: detectMediaType(media),
    allowComments: post.allowComments !== false,
    createdAt: post.createdAt || null,
    deletedAt: deletedAt || null,
    moderationReason: truncateText(moderationReason, 500),
  };
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanupUploadedFiles(files = []) {
  for (const file of files) {
    if (file?.path && fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
      } catch (_err) {
        // noop
      }
    }
  }
}

function removeCommentMediaFiles(comments = []) {
  for (const comment of comments || []) {
    const rawUrl = String(comment?.mediaUrl || "").trim();
    if (!rawUrl) continue;
    const filename = path.basename(rawUrl);
    const absolutePath = path.join(postMediaDir, "comments", filename);
    if (fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
      } catch (_err) {
        // noop
      }
    }
  }
}

function removePostMediaFiles(post) {
  for (const item of post?.media || []) {
    if (!item?.url) continue;
    const filename = path.basename(item.url);
    const absolutePath = path.join(postMediaDir, filename);
    if (fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
      } catch (_err) {
        // noop
      }
    }
  }
}

function normalizePublicMediaUrl(url = "") {
  const raw = String(url || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const uploadsIndex = raw.toLowerCase().indexOf("/uploads/");
  if (uploadsIndex >= 0) return `${MEDIA_PUBLIC_BASE_URL}${raw.slice(uploadsIndex)}`;
  if (raw.toLowerCase().startsWith("uploads/")) return `${MEDIA_PUBLIC_BASE_URL}/${raw}`;
  return `${MEDIA_PUBLIC_BASE_URL}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function buildMediaFromFiles(files = [], altText = "") {
  return files.map((file, index) => ({
    type: file.mimetype.startsWith("video/") ? "video" : "image",
    url: normalizePublicMediaUrl(`/uploads/posts/${path.basename(file.path)}`),
    filename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    order: index,
    altText: altText || undefined,
  }));
}

function detectMediaType(media) {
  if (!media?.length) return "text";
  const types = new Set(media.map((item) => item.type));
  if (types.size > 1) return "mixed";
  return types.has("video") ? "video" : "image";
}

function serializeComment(comment, currentUserId, postAuthorId, authorAvatarUrl = "") {
  const obj = comment.toObject ? comment.toObject() : comment;
  const parentCommentId = obj.parentCommentId ? String(obj.parentCommentId) : null;
  const replyToCommentId = obj.replyToCommentId ? String(obj.replyToCommentId) : null;
  return {
    ...obj,
    parentCommentId,
    replyToCommentId,
    isReply: Boolean(parentCommentId),
    replyTo: obj.replyToAuthorUsername
      ? {
          commentId: replyToCommentId,
          authorId: obj.replyToAuthorId || null,
          authorUsername: obj.replyToAuthorUsername,
        }
      : null,
    authorAvatarUrl,
    mediaUrl: normalizePublicMediaUrl(obj.mediaUrl || ""),
    mediaType: obj.mediaType || "",
    likedByMe: Array.isArray(obj.likes) ? obj.likes.includes(currentUserId) : false,
    likesCount: Array.isArray(obj.likes) ? obj.likes.length : 0,
    canDelete: Boolean(currentUserId) && (obj.authorId === currentUserId || postAuthorId === currentUserId),
  };
}

function serializePost(post, userId, commentsCount = 0, authorAvatarUrl = "", authorVerified = false) {
  const obj = post.toObject ? post.toObject() : post;
  const likesArr = obj.likes || [];
  const media = (Array.isArray(obj.media) ? obj.media : []).map((item, index) => ({
    ...item,
    type: item.type === "video" || item.mimeType?.startsWith("video/") ? "video" : "image",
    url: normalizePublicMediaUrl(item.url),
    thumbnailUrl: item.thumbnailUrl ? normalizePublicMediaUrl(item.thumbnailUrl) : "",
    order: Number.isFinite(item.order) ? item.order : index,
  }));
  const imageUrls = media.filter((item) => item.type === "image").map((item) => item.url);
  const firstImageUrl = imageUrls[0] || normalizePublicMediaUrl(obj.imageUrl) || "";

  return {
    ...obj,
    imageUrl: firstImageUrl,
    authorUsername: obj.isAnonymous ? "anonymous" : obj.authorUsername,
    authorAvatarUrl: obj.isAnonymous ? "" : authorAvatarUrl,
    authorVerified: obj.isAnonymous ? false : Boolean(authorVerified),
    media,
    images: imageUrls,
    imageUrl: firstImageUrl,
    mediaCount: media.length,
    mediaType: detectMediaType(media),
    likesCount: likesArr.length,
    displayLikesCount: obj.hideLikeCount ? null : likesArr.length,
    likedByMe: userId ? likesArr.includes(userId) : false,
    commentsCount,
  };
}

async function buildAuthorMetaMapByUsername(usernames = []) {
  const unique = [...new Set((usernames || []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!unique.length) return new Map();
  const users = await User.find({ username: { $in: unique } }).select("username avatarUrl isVerified");
  return new Map(
    users.map((user) => [
      String(user.username),
      {
        avatarUrl: String(user.avatarUrl || ""),
        isVerified: Boolean(user.isVerified),
      },
    ]),
  );
}

function getAuthorMetaByUsername(metaMap, username) {
  const key = String(username || "").trim();
  if (!key) return { avatarUrl: "", isVerified: false };
  const item = metaMap.get(key);
  if (!item) return { avatarUrl: "", isVerified: false };
  return {
    avatarUrl: String(item.avatarUrl || ""),
    isVerified: Boolean(item.isVerified),
  };
}

async function getCommentsCountMap(postIds = []) {
  if (!postIds.length) return new Map();
  const counts = await Comment.aggregate([
    { $match: { postId: { $in: postIds } } },
    { $group: { _id: "$postId", count: { $sum: 1 } } },
  ]);
  return new Map(counts.map((x) => [String(x._id), x.count]));
}

function getStartOfToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

function canManagePost(post, reqUser = {}, currentUser = null) {
  const requestUserId = String(reqUser?.sub || "").trim();
  const requestUsername = String(reqUser?.username || "").trim().toLowerCase();
  const currentUserId = String(currentUser?._id || "").trim();
  const currentUserRole = String(currentUser?.role || "").trim().toLowerCase();

  const postAuthorId = String(post?.authorId || "").trim();
  const postAuthorUsername = String(post?.authorUsername || "").trim().toLowerCase();

  const isOwnerByAuthorId = Boolean(postAuthorId) && Boolean(requestUserId) && postAuthorId === requestUserId;
  const isOwnerByCurrentUserId = Boolean(postAuthorId) && Boolean(currentUserId) && postAuthorId === currentUserId;
  const isOwnerByUsername = Boolean(postAuthorUsername) && Boolean(requestUsername) && postAuthorUsername === requestUsername;
  const isAdmin = currentUserRole === "admin";

  return isOwnerByAuthorId || isOwnerByCurrentUserId || isOwnerByUsername || isAdmin;
}

function getPostModerationStatus(post = {}) {
  const raw = String(post?.moderationStatus || "normal").trim().toLowerCase();
  if (!raw) return "normal";
  return raw;
}

function canViewPostByModeration(post, reqUser = {}, currentUser = null) {
  const status = getPostModerationStatus(post);
  if (PUBLIC_VISIBLE_POST_STATUSES.has(status)) return true;
  return canManagePost(post, reqUser, currentUser);
}

function ensurePostVisibleForViewer(post, reqUser = {}, currentUser = null) {
  if (canViewPostByModeration(post, reqUser, currentUser)) return;
  throw new AppError("Post not found", 404, "NOT_FOUND");
}

function ensurePostInteractable(post) {
  const status = getPostModerationStatus(post);
  if (POST_INTERACTION_BLOCKED_STATUSES.has(status)) {
    if (status === "pending_review") {
      throw new AppError(
        "Post is being reviewed for sensitive content. Please wait for moderation result.",
        423,
        "POST_PENDING_MODERATION",
      );
    }
    throw new AppError(
      "Post is unavailable due to moderation policy.",
      403,
      "POST_UNAVAILABLE",
    );
  }
}

async function createPost(req, res, next) {
  const uploadedFiles = req.files || [];
  let createdPost = null;
  try {
    const body = createPostSchema.parse(req.body || {});
    if (req.currentUser) {
      const todayPosts = await Post.countDocuments({
        authorUsername: req.user.username,
        createdAt: { $gte: getStartOfToday() },
      });
      ensureCanCreatePost(req.currentUser, todayPosts);
    }
    const media = buildMediaFromFiles(uploadedFiles, body.altText);

    if (!body.content && media.length === 0) {
      cleanupUploadedFiles(uploadedFiles);
      throw new AppError(
        "Post must contain text, image, or video",
        400,
        "EMPTY_POST",
      );
    }

    const hasMedia = media.length > 0;
    const moderationWindow = hasMedia ? buildModerationWindow(new Date()) : null;

    createdPost = await Post.create({
      authorId: req.user.sub,
      authorUsername: req.user.username,
      content: body.content,
      visibility: body.visibility || "public",
      isAnonymous: body.isAnonymous,
      allowComments: body.allowComments,
      hideLikeCount: body.hideLikeCount,
      location: body.location || "",
      collaborators: body.collaborators,
      tags: body.tags,
      media,
      mediaCount: media.length,
      mediaType: detectMediaType(media),
      images: media.filter((item) => item.type === "image").map((item) => item.url),
      imageUrl: media.find((item) => item.type === "image")?.url || "",
      moderationStatus: hasMedia ? "pending_review" : "normal",
      moderationReason: hasMedia
        ? "Bai viet dang duoc he thong kiem duyet noi dung nhay cam (toi da 5 phut)."
        : "",
      moderationQueuedAt: moderationWindow?.queuedAt || null,
      moderationDeadlineAt: moderationWindow?.deadlineAt || null,
      moderationProcessedAt: hasMedia ? null : new Date(),
    });

    if (hasMedia) {
      queuePostForAutoModeration(String(createdPost._id));

      const serializedPendingPost = serializePost(
        createdPost,
        req.user.sub,
        0,
        req.currentUser?.avatarUrl || req.user.avatarUrl || "",
        Boolean(req.currentUser?.isVerified),
      );

      return res.status(201).json({
        ok: true,
        message:
          "Bài viết đã được tạo. Hệ thống đang kiểm duyệt ảnh/video và sẽ hoàn tất trong tối đa 5 phút.",
        data: {
          postId: String(createdPost._id),
          ...serializedPendingPost,
          pendingModeration: true,
          moderationStatus: "pending_review",
          moderationDeadlineAt: moderationWindow?.deadlineAt || null,
          maxModerationProcessingMs: getAutoModerationMaxProcessingMs(),
          requestSentToAdmin: false,
          warningSentToUser: false,
          autoRemoved: false,
        },
      });
    }

    res.status(201).json({
      ok: true,
      message: "Post created successfully",
      data: serializePost(
        createdPost,
        req.user.sub,
        0,
        req.currentUser?.avatarUrl || req.user.avatarUrl || "",
        Boolean(req.currentUser?.isVerified),
      ),
    });
  } catch (err) {
    if (!createdPost) {
      cleanupUploadedFiles(uploadedFiles);
    }
    if (err?.name === "ZodError") {
      return next(
        new AppError(
          err.issues?.[0]?.message || err.errors?.[0]?.message || "Invalid input",
          400,
          "VALIDATION_ERROR",
        ),
      );
    }
    next(err);
  }
}

async function listPosts(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50,
    );
    const skip = (page - 1) * limit;
    const sortRaw = String(req.query.sort || "created_desc").trim().toLowerCase();
    const sort =
      sortRaw === "created_asc" ||
      sortRaw === "engagement_desc" ||
      sortRaw === "engagement_asc"
        ? sortRaw
        : "created_desc";
    const mediaOnly = normalizeBoolean(req.query.mediaOnly, false);

    const filters = {};
    const viewerId = req.user?.sub;
    const isAdminViewer = String(req.currentUser?.role || "").trim().toLowerCase() === "admin";
    const requestedVisibility = req.query.visibility;

    if (requestedVisibility && visibilityEnum.includes(requestedVisibility)) {
      filters.visibility = requestedVisibility;
      if (requestedVisibility === "private" && !isAdminViewer) {
        filters.authorId = viewerId || "__no_viewer__";
      }
    } else {
      filters.$or = [{ visibility: "public" }];
      if (viewerId) {
        filters.$or.push({ authorId: viewerId });
      }
    }

    if (!isAdminViewer) {
      filters.$and = filters.$and || [];
      if (viewerId) {
        filters.$and.push({
          $or: [
            { moderationStatus: { $in: ["normal", "reported"] } },
            { authorId: viewerId },
          ],
        });
      } else {
        filters.$and.push({
          moderationStatus: { $in: ["normal", "reported"] },
        });
      }
    }

    if (mediaOnly) {
      filters.$and = filters.$and || [];
      filters.$and.push({
        $or: [
          { mediaCount: { $gt: 0 } },
          { "media.0": { $exists: true } },
          { imageUrl: { $nin: ["", null] } },
        ],
      });
    }

    let items = [];
    let total = 0;
    let commentsCountByPostId = new Map();

    if (sort === "engagement_desc" || sort === "engagement_asc") {
      const sortDirection = sort === "engagement_asc" ? 1 : -1;
      const [rows, count] = await Promise.all([
        Post.aggregate([
          { $match: filters },
          {
            $addFields: {
              likesCount: { $size: { $ifNull: ["$likes", []] } },
            },
          },
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
          {
            $sort: {
              engagementCount: sortDirection,
              createdAt: -1,
              _id: -1,
            },
          },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              commentStats: 0,
            },
          },
        ]),
        Post.countDocuments(filters),
      ]);
      items = rows;
      total = count;
      commentsCountByPostId = new Map(
        rows.map((row) => [String(row._id), Number(row.commentsCount) || 0]),
      );
    } else {
      const sortDirection = sort === "created_asc" ? 1 : -1;
      const [rows, count] = await Promise.all([
        Post.find(filters).sort({ createdAt: sortDirection, _id: sortDirection }).skip(skip).limit(limit),
        Post.countDocuments(filters),
      ]);
      items = rows;
      total = count;

      const postIds = rows.map((post) => post._id);
      commentsCountByPostId = await getCommentsCountMap(postIds);
    }

    const authorMetaMap = await buildAuthorMetaMapByUsername(items.map((p) => p.authorUsername));

    const mapped = items.map((p) => {
      const authorMeta = getAuthorMetaByUsername(authorMetaMap, p.authorUsername);
      const commentsCount = commentsCountByPostId.get(String(p._id)) || 0;
      return serializePost(p, viewerId, commentsCount, authorMeta.avatarUrl, authorMeta.isVerified);
    });

    res.json({
      ok: true,
      data: {
        items: mapped,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getPost(req, res, next) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");

    if (post.visibility === "private" && !canManagePost(post, req.user, req.currentUser)) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }
    ensurePostVisibleForViewer(post, req.user, req.currentUser);

    const comments = await Comment.find({ postId: post._id }).sort({ createdAt: -1 }).limit(30);
    const authorMetaMap = await buildAuthorMetaMapByUsername([post.authorUsername, ...comments.map((item) => item.authorUsername)]);
    const postAuthorMeta = getAuthorMetaByUsername(authorMetaMap, post.authorUsername);

    res.json({
      ok: true,
      data: {
        post: serializePost(post, req.user?.sub, comments.length, postAuthorMeta.avatarUrl, postAuthorMeta.isVerified),
        comments: comments.map((item) =>
          serializeComment(
            item,
            req.user?.sub,
            post.authorId,
            getAuthorMetaByUsername(authorMetaMap, item.authorUsername).avatarUrl,
          ),
        ),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function recordView(req, res, next) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");
    ensurePostVisibleForViewer(post, req.user, req.currentUser);
    ensurePostInteractable(post);

    post.viewsCount = (post.viewsCount || 0) + 1;
    post.lastViewedAt = new Date();
    await post.save();

    const commentsCount = await Comment.countDocuments({ postId: post._id });
    const authorMetaMap = await buildAuthorMetaMapByUsername([post.authorUsername]);
    const postAuthorMeta = getAuthorMetaByUsername(authorMetaMap, post.authorUsername);
    res.json({
      ok: true,
      data: {
        postId: post._id,
        viewsCount: post.viewsCount,
        lastViewedAt: post.lastViewedAt,
        post: serializePost(post, req.user?.sub, commentsCount, postAuthorMeta.avatarUrl, postAuthorMeta.isVerified),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updatePost(req, res, next) {
  try {
    const body = updatePostSchema.parse(req.body || {});
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");

    if (!canManagePost(post, req.user, req.currentUser)) {
      throw new AppError("Forbidden", 403, "FORBIDDEN");
    }

    if (body.content !== undefined) post.content = body.content;
    if (body.visibility !== undefined) post.visibility = body.visibility;
    if (body.isAnonymous !== undefined) post.isAnonymous = body.isAnonymous;
    if (body.allowComments !== undefined) post.allowComments = body.allowComments;
    if (body.hideLikeCount !== undefined) post.hideLikeCount = body.hideLikeCount;
    if (body.location !== undefined) post.location = body.location;
    if (body.collaborators !== undefined) post.collaborators = body.collaborators;
    if (body.tags !== undefined) post.tags = body.tags;

    if (!post.content && (!post.media || post.media.length === 0)) {
      throw new AppError(
        "Post must contain text, image, or video",
        400,
        "EMPTY_POST",
      );
    }

    await post.save();
    const commentsCount = await Comment.countDocuments({ postId: post._id });
    const authorMetaMap = await buildAuthorMetaMapByUsername([post.authorUsername]);
    const postAuthorMeta = getAuthorMetaByUsername(authorMetaMap, post.authorUsername);
    res.json({
      ok: true,
      data: serializePost(post, req.user.sub, commentsCount, postAuthorMeta.avatarUrl, postAuthorMeta.isVerified),
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(
        new AppError(
          err.issues?.[0]?.message || err.errors?.[0]?.message || "Invalid input",
          400,
          "VALIDATION_ERROR",
        ),
      );
    }
    next(err);
  }
}

async function deletePost(req, res, next) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");

    if (!canManagePost(post, req.user, req.currentUser)) {
      throw new AppError("Forbidden", 403, "FORBIDDEN");
    }

    removePostMediaFiles(post);
    const comments = await Comment.find({ postId: post._id }).select("mediaUrl").lean();
    removeCommentMediaFiles(comments);
    await Post.deleteOne({ _id: post._id });
    await Comment.deleteMany({ postId: post._id });
    res.json({ ok: true, data: { id: post._id } });
  } catch (err) {
    next(err);
  }
}

async function toggleLike(req, res, next) {
  try {
    if (req.currentUser) ensureCanLike(req.currentUser);
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");
    ensurePostVisibleForViewer(post, req.user, req.currentUser);
    ensurePostInteractable(post);

    const userId = req.user.sub;
    const idx = post.likes.indexOf(userId);

    if (idx >= 0) {
      throw new AppError("Post already liked by this user", 409, "ALREADY_LIKED");
    }

    post.likes.push(userId);
    await post.save();

    const io = getIO();
    io.to(`post:${post._id}`).emit("post:like", {
      postId: String(post._id),
      likesCount: post.likes.length,
      likedBy: req.user.username,
    });

    notificationService.notifyPostLike({
      post,
      actorId: req.user.sub,
      actorUsername: req.user.username,
    }).catch((error) => {
      console.error("notifyPostLike failed:", error?.message || error);
    });

    res.json({
      ok: true,
      data: {
        postId: post._id,
        liked: true,
        likesCount: post.likes.length,
        displayLikesCount: post.hideLikeCount ? null : post.likes.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function removeLike(req, res, next) {
  try {
    if (req.currentUser) ensureCanLike(req.currentUser);
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");
    ensurePostVisibleForViewer(post, req.user, req.currentUser);
    ensurePostInteractable(post);

    const userId = req.user.sub;
    post.likes = (post.likes || []).filter((item) => item !== userId);
    await post.save();

    const io = getIO();
    io.to(`post:${post._id}`).emit("post:like", {
      postId: String(post._id),
      likesCount: post.likes.length,
      likedBy: req.user.username,
    });

    notificationService.removePostLikeActor({
      postId: post._id,
      recipientId: post.authorId,
      actorId: req.user.sub,
      actorUsername: req.user.username,
    }).catch((error) => {
      console.error("removePostLikeActor failed:", error?.message || error);
    });

    res.json({
      ok: true,
      data: {
        postId: post._id,
        liked: false,
        likesCount: post.likes.length,
        displayLikesCount: post.hideLikeCount ? null : post.likes.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function reportPost(req, res, next) {
  try {
    if (req.currentUser) ensureAccountNotLocked(req.currentUser);
    const body = reportPostSchema.parse(req.body || {});
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");
    ensurePostVisibleForViewer(post, req.user, req.currentUser);
    ensurePostInteractable(post);

    const reporterId = String(req.user?.sub || "");
    const reporterUsername = String(req.user?.username || "");
    if (!reporterId || !reporterUsername) {
      throw new AppError("Username required", 401, "UNAUTHORIZED");
    }

    const existed = await PostReport.findOne({
      postId: post._id,
      reporterId,
      status: "pending",
    }).select("_id");
    if (existed) {
      throw new AppError("You already reported this post", 409, "ALREADY_REPORTED");
    }

    await PostReport.create({
      postId: post._id,
      reporterId,
      reporterUsername,
      reason: body.reason || "Noi dung khong phu hop",
      status: "pending",
      source: "user_report",
      postSnapshot: buildPostReportSnapshot(post),
    });

    post.reportCount = (Number(post.reportCount) || 0) + 1;
    post.lastReportedAt = new Date();
    if (post.moderationStatus === "normal") {
      post.moderationStatus = "reported";
    }
    await post.save();

    res.status(201).json({
      ok: true,
      message: "Reported successfully",
      data: {
        postId: String(post._id),
        reportCount: post.reportCount,
        moderationStatus: post.moderationStatus,
        lastReportedAt: post.lastReportedAt,
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return next(
        new AppError(
          err.issues?.[0]?.message || err.errors?.[0]?.message || "Invalid input",
          400,
          "VALIDATION_ERROR",
        ),
      );
    }
    next(err);
  }
}

async function addComment(req, res, next) {
  try {
    if (req.currentUser) ensureCanComment(req.currentUser);
    const body = addCommentSchema.parse(req.body);

    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");
    ensurePostVisibleForViewer(post, req.user, req.currentUser);
    ensurePostInteractable(post);
    if (!post.allowComments) {
      throw new AppError("Comments are disabled for this post", 400, "COMMENTS_DISABLED");
    }

    let parentComment = null;
    let replyTarget = null;
    if (body.parentCommentId || body.replyToCommentId) {
      const targetId = body.replyToCommentId || body.parentCommentId;
      replyTarget = await Comment.findById(targetId);
      if (!replyTarget || String(replyTarget.postId) !== String(post._id)) {
        throw new AppError("Reply target not found", 404, "REPLY_TARGET_NOT_FOUND");
      }

      if (body.parentCommentId) {
        parentComment = await Comment.findById(body.parentCommentId);
        if (!parentComment || String(parentComment.postId) !== String(post._id)) {
          throw new AppError("Parent comment not found", 404, "PARENT_COMMENT_NOT_FOUND");
        }
      } else {
        parentComment = replyTarget.parentCommentId
          ? await Comment.findById(replyTarget.parentCommentId)
          : replyTarget;
      }

      if (!parentComment || String(parentComment.postId) !== String(post._id)) {
        throw new AppError("Parent comment not found", 404, "PARENT_COMMENT_NOT_FOUND");
      }
    }

    const file = req.file || null;
    const content = String(body.content || "").trim();
    if (!content && !file) {
      throw new AppError("Comment must contain text, image, or video", 400, "EMPTY_COMMENT");
    }
    const mediaType = file ? (file.mimetype?.startsWith("video/") ? "video" : file.mimetype === "image/gif" ? "gif" : "image") : "";
    const mediaUrl = file ? normalizePublicMediaUrl(`/uploads/posts/comments/${path.basename(file.path)}`) : "";

    const c = await Comment.create({
      postId: post._id,
      authorId: req.user.sub,
      authorUsername: req.user.username,
      content,
      parentCommentId: parentComment?._id || null,
      replyToCommentId: replyTarget?._id || null,
      replyToAuthorId: replyTarget?.authorId || null,
      replyToAuthorUsername: replyTarget?.authorUsername || null,
      mediaUrl,
      mediaType,
    });
    const io = getIO();

    io.to(`post:${post._id}`).emit("post:comment", {
      postId: String(post._id),
      comment: {
        _id: String(c._id),
        authorUsername: c.authorUsername,
        content: c.content,
        mediaUrl: c.mediaUrl || "",
        mediaType: c.mediaType || "",
        createdAt: c.createdAt,
        parentCommentId: c.parentCommentId ? String(c.parentCommentId) : null,
        replyToCommentId: c.replyToCommentId ? String(c.replyToCommentId) : null,
        replyToAuthorUsername: c.replyToAuthorUsername || null,
      },
    });

    notificationService.notifyPostComment({
      post,
      actorId: req.user.sub,
      actorUsername: req.user.username,
      previewText: c.content.slice(0, 120),
    }).catch((error) => {
      console.error("notifyPostComment failed:", error?.message || error);
    });

    res.status(201).json({ ok: true, data: serializeComment(c, req.user.sub, post.authorId, req.user?.avatarUrl || "") });
  } catch (err) {
    cleanupUploadedFiles(req.file ? [req.file] : []);
    if (err?.name === "ZodError") {
      return next(
        new AppError(
          err.issues?.[0]?.message || err.errors?.[0]?.message || "Invalid input",
          400,
          "VALIDATION_ERROR",
        ),
      );
    }
    next(err);
  }
}

async function listComments(req, res, next) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");
    ensurePostVisibleForViewer(post, req.user, req.currentUser);
    ensurePostInteractable(post);

    const items = await Comment.find({ postId: post._id }).sort({ createdAt: 1, _id: 1 });
    const authorMetaMap = await buildAuthorMetaMapByUsername(items.map((item) => item.authorUsername));
    res.json({
      ok: true,
      data: items.map((item) =>
        serializeComment(
          item,
          req.user?.sub,
          post.authorId,
          getAuthorMetaByUsername(authorMetaMap, item.authorUsername).avatarUrl,
        ),
      ),
    });
  } catch (err) {
    next(err);
  }
}

async function deleteComment(req, res, next) {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) throw new AppError("Comment not found", 404, "NOT_FOUND");

    const post = await Post.findById(comment.postId).select("authorId");
    const canDelete = comment.authorId === req.user.sub || post?.authorId === req.user.sub;
    if (!canDelete) {
      throw new AppError("Forbidden", 403, "FORBIDDEN");
    }

    const commentsToDelete = await Comment.find({
      $or: [
        { _id: comment._id },
        { parentCommentId: comment._id },
      ],
    }).select("mediaUrl");
    removeCommentMediaFiles(commentsToDelete);
    await Comment.deleteMany({
      _id: { $in: commentsToDelete.map((item) => item._id) },
    });
    res.json({ ok: true, data: { id: comment._id } });
  } catch (err) {
    next(err);
  }
}


async function addCommentLike(req, res, next) {
  try {
    if (req.currentUser) ensureCanLike(req.currentUser);
    const post = await Post.findById(req.params.id).select('_id authorId authorUsername moderationStatus');
    if (!post) throw new AppError('Post not found', 404, 'NOT_FOUND');
    ensurePostVisibleForViewer(post, req.user, req.currentUser);
    ensurePostInteractable(post);
    const comment = await Comment.findById(req.params.commentId);
    if (!comment || String(comment.postId) !== String(post._id)) throw new AppError('Comment not found', 404, 'NOT_FOUND');
    const userId = req.user.sub;
    comment.likes = Array.from(new Set([...(comment.likes || []), userId]));
    await comment.save();
    const authorMetaMap = await buildAuthorMetaMapByUsername([comment.authorUsername]);
    res.json({
      ok: true,
      data: serializeComment(
        comment,
        userId,
        post.authorId,
        getAuthorMetaByUsername(authorMetaMap, comment.authorUsername).avatarUrl,
      ),
    });
  } catch (err) {
    next(err);
  }
}

async function removeCommentLike(req, res, next) {
  try {
    if (req.currentUser) ensureCanLike(req.currentUser);
    const post = await Post.findById(req.params.id).select('_id authorId authorUsername moderationStatus');
    if (!post) throw new AppError('Post not found', 404, 'NOT_FOUND');
    ensurePostVisibleForViewer(post, req.user, req.currentUser);
    ensurePostInteractable(post);
    const comment = await Comment.findById(req.params.commentId);
    if (!comment || String(comment.postId) !== String(post._id)) throw new AppError('Comment not found', 404, 'NOT_FOUND');
    const userId = req.user.sub;
    comment.likes = (comment.likes || []).filter((item) => item !== userId);
    await comment.save();
    const authorMetaMap = await buildAuthorMetaMapByUsername([comment.authorUsername]);
    res.json({
      ok: true,
      data: serializeComment(
        comment,
        userId,
        post.authorId,
        getAuthorMetaByUsername(authorMetaMap, comment.authorUsername).avatarUrl,
      ),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createPost,
  listPosts,
  getPost,
  recordView,
  updatePost,
  deletePost,
  toggleLike,
  removeLike,
  reportPost,
  addComment,
  listComments,
  deleteComment,
  addCommentLike,
  removeCommentLike,
};

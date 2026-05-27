const Post = require("../models/Post");
const Comment = require("../models/Comment");
const PostReport = require("../models/PostReport");
const User = require("../models/User");
const notificationService = require("./notification.service");
const { assessAdultContent } = require("../utils/adultContentModeration");

const SYSTEM_MODERATION_ACTOR_ID = "ai_moderation_system";
const SYSTEM_MODERATION_ACTOR_USERNAME = "ai_moderation";

const MAX_AUTO_MODERATION_MS_CAP = 5 * 60 * 1000;
const DEFAULT_AUTO_MODERATION_MAX_MS = 5 * 60 * 1000;
const DEFAULT_WORKER_INTERVAL_MS = 15000;
const DEFAULT_WORKER_BATCH_SIZE = 5;

let moderationWorkerTimer = null;
let moderationWorkerStarted = false;
const processingPostIds = new Set();

function toNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getAutoModerationMaxProcessingMs() {
  return toNumber(
    process.env.AUTO_MODERATION_MAX_PROCESSING_MS,
    DEFAULT_AUTO_MODERATION_MAX_MS,
    60 * 1000,
    MAX_AUTO_MODERATION_MS_CAP,
  );
}

function getModerationWorkerIntervalMs() {
  return toNumber(
    process.env.AUTO_MODERATION_WORKER_INTERVAL_MS,
    DEFAULT_WORKER_INTERVAL_MS,
    3000,
    60 * 1000,
  );
}

function getModerationWorkerBatchSize() {
  return toNumber(
    process.env.AUTO_MODERATION_WORKER_BATCH_SIZE,
    DEFAULT_WORKER_BATCH_SIZE,
    1,
    20,
  );
}

function buildModerationWindow(baseDate = new Date()) {
  const queuedAt = baseDate instanceof Date ? new Date(baseDate.getTime()) : new Date();
  const deadlineAt = new Date(queuedAt.getTime() + getAutoModerationMaxProcessingMs());
  return { queuedAt, deadlineAt };
}

function truncateText(value = "", maxLength = 500) {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 3, 0))}...`;
}

function detectMediaType(media = []) {
  if (!media?.length) return "text";
  const types = new Set(media.map((item) => (item?.type === "video" ? "video" : "image")));
  if (types.size > 1) return "mixed";
  return types.has("video") ? "video" : "image";
}

function buildAdultModerationReason(moderation = {}) {
  const cleanSignals = (Array.isArray(moderation?.signals) ? moderation.signals : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const source = String(moderation?.source || "heuristic").trim();
  const score = Number(moderation?.score || 0);
  const threshold = Number(moderation?.threshold || 0);
  const providerScore = Number(moderation?.providerScore || 0);
  const providerUsed = Boolean(moderation?.providerUsed);

  const details = [];
  if (threshold > 0) details.push(`diem ${score}/${threshold}`);
  if (providerUsed) details.push(`provider:${providerScore}`);
  details.push(`nguon:${source}`);

  const base =
    "Hệ thống kiểm duyệt tự động phát hiện bài viết có dấu hiệu nội dung 18+/gợi dục. Bài viết đã bị gỡ và chuyển admin xử lý.";
  if (!cleanSignals.length) {
    return truncateText(`${base} ${details.join(", ")}.`, 500);
  }
  return truncateText(
    `${base} ${details.join(", ")}. Từ khóa: ${cleanSignals.join(", ")}.`,
    500,
  );
}

function buildModerationTimeoutReason() {
  return truncateText(
    "Hệ thống không thể hoàn tất xác minh nội dung media trong tối đa 5 phút. Bài viết tạm dừng hiển thị và đã tạo request để admin xem xét thủ công.",
    500,
  );
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

async function resolvePostAuthor(post = {}) {
  const username = String(post.authorUsername || "").trim();
  if (!username) return null;
  const user = await User.findOne({ username }).select("_id moderationStatus").lean();
  if (!user?._id) return null;
  return {
    _id: String(user._id),
    moderationStatus: String(user.moderationStatus || "normal"),
  };
}

async function warnPostAuthorForViolation(post, reason) {
  try {
    const postAuthor = await resolvePostAuthor(post);
    if (!postAuthor?._id) return false;

    const nextModerationStatus =
      String(postAuthor.moderationStatus || "").toLowerCase() === "violating"
        ? "violating"
        : "warning";

    await User.updateOne(
      { _id: postAuthor._id },
      {
        $set: {
          moderationStatus: nextModerationStatus,
          moderationReason: reason,
        },
      },
    );

    await notificationService.notifyModerationAction({
      recipientId: postAuthor._id,
      actorId: SYSTEM_MODERATION_ACTOR_ID,
      actorUsername: SYSTEM_MODERATION_ACTOR_USERNAME,
      postId: String(post._id),
      previewText:
        "Hệ thống đã gỡ bài viết của bạn do phát hiện nội dung 18+ (demo). Admin sẽ đánh giá và quyết định hình thức xử phạt.",
    });
    return true;
  } catch (error) {
    console.error("warnPostAuthorForViolation failed:", error?.message || error);
    return false;
  }
}

async function warnPostAuthorForManualReview(post, reason) {
  try {
    const postAuthor = await resolvePostAuthor(post);
    if (!postAuthor?._id) return false;
    await notificationService.notifyModerationAction({
      recipientId: postAuthor._id,
      actorId: SYSTEM_MODERATION_ACTOR_ID,
      actorUsername: SYSTEM_MODERATION_ACTOR_USERNAME,
      postId: String(post._id),
      previewText: reason
        ? `Bài viết của bạn đang chờ admin kiểm tra nội dung nhạy cảm. ${reason}`
        : "Bài viết của bạn đang chờ admin kiểm tra nội dung nhạy cảm vì quá trình xác minh tự động quá 5 phút.",
    });
    return true;
  } catch (error) {
    console.error("warnPostAuthorForManualReview failed:", error?.message || error);
    return false;
  }
}

async function upsertAutoModerationReport({
  post,
  reason,
  detectionSignals = [],
  autoModeratedAt = new Date(),
}) {
  const snapshot = buildPostReportSnapshot(post, {
    moderationReason: reason,
    deletedAt: autoModeratedAt,
  });

  const report = await PostReport.findOneAndUpdate(
    {
      postId: post._id,
      source: "auto_nsfw",
      reporterId: SYSTEM_MODERATION_ACTOR_ID,
    },
    {
      $set: {
        reporterUsername: SYSTEM_MODERATION_ACTOR_USERNAME,
        reason,
        status: "pending",
        postSnapshot: snapshot,
        detectionSignals: Array.isArray(detectionSignals) ? detectionSignals : [],
        autoModeratedAt,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  return String(report?._id || "");
}

async function markPostAsSafe(post, moderationAssessment = {}, processedAt = new Date()) {
  post.moderationStatus = "normal";
  post.moderationReason = "";
  post.moderationProcessedAt = processedAt;
  post.autoModerationSource = String(moderationAssessment?.source || "heuristic");
  post.autoModerationScore = Number(moderationAssessment?.score || 0);
  post.autoModerationThreshold = Number(moderationAssessment?.threshold || 0);
  post.autoModerationProviderScore = Number(moderationAssessment?.providerScore || 0);
  post.autoModerationSignals = Array.isArray(moderationAssessment?.signals)
    ? moderationAssessment.signals.slice(0, 20)
    : [];
  await post.save();

  return {
    status: "safe",
    autoRemoved: false,
    reportId: "",
    warningSentToUser: false,
    requestSentToAdmin: false,
    reason: "",
    detectionSignals: post.autoModerationSignals,
  };
}

async function markPostForManualReviewTimeout(post, processedAt = new Date()) {
  const reason = buildModerationTimeoutReason();
  const timeoutSignals = ["processing_timeout_5m"];
  let reportId = "";
  let requestSentToAdmin = false;
  let warningSentToUser = false;

  try {
    reportId = await upsertAutoModerationReport({
      post,
      reason,
      detectionSignals: timeoutSignals,
      autoModeratedAt: processedAt,
    });
    requestSentToAdmin = Boolean(reportId);
  } catch (error) {
    console.error("markPostForManualReviewTimeout report failed:", error?.message || error);
  }

  warningSentToUser = await warnPostAuthorForManualReview(post, reason);

  post.moderationStatus = "pending_review";
  post.moderationReason = reason;
  post.moderationProcessedAt = processedAt;
  post.autoModerationSource = "timeout";
  post.autoModerationScore = 0;
  post.autoModerationThreshold = 0;
  post.autoModerationProviderScore = 0;
  post.autoModerationSignals = timeoutSignals;
  await post.save();

  return {
    status: "timeout_manual_review",
    autoRemoved: false,
    reportId,
    warningSentToUser,
    requestSentToAdmin,
    reason,
    detectionSignals: timeoutSignals,
  };
}

async function markPostAsViolatingAndRemove(post, moderationAssessment = {}, processedAt = new Date()) {
  const reason = buildAdultModerationReason(moderationAssessment);
  const detectionSignals = Array.isArray(moderationAssessment?.signals)
    ? moderationAssessment.signals.slice(0, 20)
    : [];

  let reportId = "";
  let requestSentToAdmin = false;
  let warningSentToUser = false;

  try {
    reportId = await upsertAutoModerationReport({
      post,
      reason,
      detectionSignals,
      autoModeratedAt: processedAt,
    });
    requestSentToAdmin = Boolean(reportId);
  } catch (error) {
    console.error("markPostAsViolatingAndRemove report failed:", error?.message || error);
  }

  warningSentToUser = await warnPostAuthorForViolation(post, reason);

  let autoRemoved = false;
  try {
    await Comment.deleteMany({ postId: post._id });
    const deleteResult = await Post.deleteOne({ _id: post._id });
    autoRemoved = Number(deleteResult?.deletedCount || 0) > 0;
  } catch (error) {
    console.error("markPostAsViolatingAndRemove delete failed:", error?.message || error);
  }

  if (!autoRemoved) {
    try {
      post.moderationStatus = "violating";
      post.moderationReason = reason;
      post.moderationProcessedAt = processedAt;
      post.autoModerationSource = String(moderationAssessment?.source || "heuristic");
      post.autoModerationScore = Number(moderationAssessment?.score || 0);
      post.autoModerationThreshold = Number(moderationAssessment?.threshold || 0);
      post.autoModerationProviderScore = Number(moderationAssessment?.providerScore || 0);
      post.autoModerationSignals = detectionSignals;
      await post.save();
    } catch (error) {
      console.error("markPostAsViolatingAndRemove fallback save failed:", error?.message || error);
    }
  }

  return {
    status: "violating_removed",
    autoRemoved,
    reportId,
    warningSentToUser,
    requestSentToAdmin,
    reason,
    detectionSignals,
  };
}

async function processPostAutoModeration(postId) {
  const normalizedPostId = String(postId || "").trim();
  if (!normalizedPostId) {
    return { status: "invalid_post_id" };
  }
  if (processingPostIds.has(normalizedPostId)) {
    return { status: "already_processing" };
  }

  processingPostIds.add(normalizedPostId);
  try {
    const post = await Post.findById(normalizedPostId);
    if (!post) {
      return { status: "post_not_found" };
    }
    if (post.moderationStatus !== "pending_review") {
      return { status: "skip_status" };
    }
    if (post.moderationProcessedAt) {
      return { status: "already_processed" };
    }

    const now = new Date();
    const queuedAt = post.moderationQueuedAt || post.createdAt || now;
    const fallbackDeadline = new Date(new Date(queuedAt).getTime() + getAutoModerationMaxProcessingMs());
    const deadlineAt = post.moderationDeadlineAt || fallbackDeadline;

    if (now > deadlineAt) {
      return await markPostForManualReviewTimeout(post, now);
    }

    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length === 0) {
      return await markPostAsSafe(post, { source: "no_media", score: 0, threshold: 0, signals: [] }, now);
    }

    const moderationAssessment = await assessAdultContent({
      payload: {
        content: post.content || "",
        location: post.location || "",
        tags: Array.isArray(post.tags) ? post.tags : [],
        collaborators: Array.isArray(post.collaborators) ? post.collaborators : [],
        altText: media.map((item) => item?.altText || "").filter(Boolean).join(" "),
      },
      media,
      deadlineAt,
    });

    if (moderationAssessment?.flagged) {
      return await markPostAsViolatingAndRemove(post, moderationAssessment, now);
    }
    return await markPostAsSafe(post, moderationAssessment, now);
  } catch (error) {
    console.error("processPostAutoModeration failed:", error?.message || error);
    return { status: "failed", error: String(error?.message || error) };
  } finally {
    processingPostIds.delete(normalizedPostId);
  }
}

async function processPendingPostsBatch() {
  const posts = await Post.find({
    moderationStatus: "pending_review",
    moderationProcessedAt: null,
  })
    .select("_id")
    .sort({ moderationDeadlineAt: 1, createdAt: 1, _id: 1 })
    .limit(getModerationWorkerBatchSize())
    .lean();

  for (const row of posts) {
    // Sequential processing keeps provider/API load predictable.
    // eslint-disable-next-line no-await-in-loop
    await processPostAutoModeration(row?._id);
  }
}

function queuePostForAutoModeration(postId) {
  const normalizedPostId = String(postId || "").trim();
  if (!normalizedPostId) return false;
  setTimeout(() => {
    processPostAutoModeration(normalizedPostId).catch((error) => {
      console.error("queuePostForAutoModeration failed:", error?.message || error);
    });
  }, 0);
  return true;
}

function initPostModerationWorker() {
  if (moderationWorkerStarted) return;
  moderationWorkerStarted = true;

  const intervalMs = getModerationWorkerIntervalMs();
  moderationWorkerTimer = setInterval(() => {
    processPendingPostsBatch().catch((error) => {
      console.error("post moderation worker tick failed:", error?.message || error);
    });
  }, intervalMs);

  setTimeout(() => {
    processPendingPostsBatch().catch((error) => {
      console.error("post moderation worker initial run failed:", error?.message || error);
    });
  }, 1000);

  console.log(
    `[post-moderation] worker started (interval=${intervalMs}ms, maxWindow=${getAutoModerationMaxProcessingMs()}ms)`,
  );
}

function stopPostModerationWorker() {
  if (moderationWorkerTimer) {
    clearInterval(moderationWorkerTimer);
    moderationWorkerTimer = null;
  }
  moderationWorkerStarted = false;
}

module.exports = {
  buildModerationWindow,
  getAutoModerationMaxProcessingMs,
  queuePostForAutoModeration,
  processPostAutoModeration,
  processPendingPostsBatch,
  initPostModerationWorker,
  stopPostModerationWorker,
};

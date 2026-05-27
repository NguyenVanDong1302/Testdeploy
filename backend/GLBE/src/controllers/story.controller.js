const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const Story = require('../models/Story');
const User = require('../models/User');
const { postMediaDir } = require('../config/media');
const { AppError } = require('../utils/errors');
const { ensureCanLike } = require('../utils/accountModeration');
const notificationService = require('../services/notification.service');

const execFileAsync = promisify(execFile);
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const STORY_LIFETIME_MS = 10 * 60 * 1000;
const MAX_STORY_VIDEO_DURATION_SECONDS = Math.max(
  5,
  Number.parseInt(String(process.env.STORY_VIDEO_MAX_DURATION_SECONDS || ''), 10) || 60,
);
const thumbnailDir = path.join(postMediaDir, 'thumbnails');
fs.mkdirSync(thumbnailDir, { recursive: true });

function normalizePublicMediaUrl(url = '') {
  const raw = String(url || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(data:|blob:)/i.test(raw)) return raw;
  const uploadsIndex = raw.toLowerCase().indexOf('/uploads/');
  if (uploadsIndex >= 0) return `${MEDIA_PUBLIC_BASE_URL}${raw.slice(uploadsIndex)}`;
  if (raw.toLowerCase().startsWith('uploads/')) return `${MEDIA_PUBLIC_BASE_URL}/${raw}`;
  return `${MEDIA_PUBLIC_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function toLocalMediaPath(url = '') {
  const raw = String(url || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  const marker = '/uploads/posts/';
  const markerIndex = raw.toLowerCase().indexOf(marker);
  const relative = markerIndex >= 0 ? raw.slice(markerIndex + marker.length) : raw.toLowerCase().startsWith('uploads/posts/') ? raw.slice('uploads/posts/'.length) : '';
  if (!relative) return '';
  const absolute = path.resolve(postMediaDir, relative);
  const root = path.resolve(postMediaDir);
  return absolute.startsWith(root) ? absolute : '';
}

function safeUnlink(filePath = '') {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_error) {
    // ignore remove failures
  }
}

async function getVideoDurationSeconds(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
    const duration = Number.parseFloat(String(stdout || '').trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch (_error) {
    return 0;
  }
}

async function buildVideoThumbnail(filePath, fileBaseName) {
  const safeBase = path.basename(fileBaseName, path.extname(fileBaseName));
  const thumbnailFilename = `${safeBase}-thumb.jpg`;
  const thumbnailAbsolutePath = path.join(thumbnailDir, thumbnailFilename);
  const duration = await getVideoDurationSeconds(filePath);
  const seekSeconds = duration > 1 ? Math.max(0.7, Math.min(duration * 0.25, duration - 0.25)) : 0.4;
  try {
    await execFileAsync('ffmpeg', ['-y', '-ss', seekSeconds.toFixed(2), '-i', filePath, '-frames:v', '1', '-vf', 'thumbnail,scale=720:-1:force_original_aspect_ratio=decrease', '-q:v', '2', thumbnailAbsolutePath]);
    if (fs.existsSync(thumbnailAbsolutePath) && fs.statSync(thumbnailAbsolutePath).size > 0) {
      return normalizePublicMediaUrl(`/uploads/posts/thumbnails/${thumbnailFilename}`);
    }
  } catch (_err) {
    // ignore
  }
  return '';
}

function getArchiveCutoff(now = new Date()) {
  return new Date(now.getTime() - STORY_LIFETIME_MS);
}

async function archiveExpiredStories(now = new Date()) {
  const cutoff = getArchiveCutoff(now);
  await Story.updateMany(
    {
      archivedAt: null,
      $or: [
        { expiresAt: { $lte: now } },
        { createdAt: { $lte: cutoff } },
      ],
    },
    {
      $set: {
        archivedAt: now,
        expiresAt: now,
      },
    },
  );
}

function normalizeStoryViews(story) {
  const rows = Array.isArray(story?.views) ? story.views : [];
  const byUserId = new Map();
  for (const row of rows) {
    const userId = String(row?.userId || '').trim();
    if (!userId) continue;
    const next = {
      userId,
      username: String(row?.username || '').trim(),
      viewedAt: row?.viewedAt ? new Date(row.viewedAt) : null,
    };
    const current = byUserId.get(userId);
    const nextTs = next.viewedAt?.getTime() || 0;
    const currentTs = current?.viewedAt?.getTime?.() || 0;
    if (!current || nextTs >= currentTs) byUserId.set(userId, next);
  }
  return Array.from(byUserId.values()).sort((a, b) => (b.viewedAt?.getTime() || 0) - (a.viewedAt?.getTime() || 0));
}

function hasViewedStory(story, viewerId = '') {
  const normalizedViewerId = String(viewerId || '').trim();
  if (!normalizedViewerId) return false;
  if (String(story?.authorId || '') === normalizedViewerId) return true;
  return normalizeStoryViews(story).some((row) => row.userId === normalizedViewerId);
}

function serializeStory(story, viewerId = '') {
  const views = normalizeStoryViews(story);
  return {
    _id: String(story._id),
    id: String(story._id),
    authorId: String(story.authorId),
    authorUsername: story.authorUsername,
    mediaType: story.mediaType,
    mediaUrl: normalizePublicMediaUrl(story.mediaUrl),
    thumbnailUrl: normalizePublicMediaUrl(story.thumbnailUrl || story.mediaUrl),
    caption: story.caption || '',
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    archivedAt: story.archivedAt || null,
    isArchived: Boolean(story.archivedAt),
    likesCount: Array.isArray(story.likes) ? story.likes.length : 0,
    likedByMe: Boolean(viewerId) && Array.isArray(story.likes) ? story.likes.includes(String(viewerId)) : false,
    viewersCount: views.length,
    viewedByMe: hasViewedStory(story, viewerId),
  };
}

function serializeStoryViewer(view, user) {
  return {
    userId: String(view.userId),
    username: user?.username || view.username || 'user',
    avatarUrl: normalizePublicMediaUrl(user?.avatarUrl || ''),
    viewedAt: view.viewedAt || null,
  };
}

async function resolveViewer(req) {
  const rawUsername = String(req.user?.username || req.headers['x-username'] || '').trim();
  if (!rawUsername) throw new AppError('Username required', 401, 'USERNAME_REQUIRED');
  const viewer = await User.findOne({ username: rawUsername })
    .select('_id username avatarUrl hiddenStoryAuthorIds restrictions accountLocked accountLockedAt accountLockedReason');
  if (!viewer) throw new AppError('Viewer not found', 404, 'VIEWER_NOT_FOUND');
  return viewer;
}

function isActiveStory(story, now = new Date()) {
  if (!story) return false;
  if (story.archivedAt) return false;
  if (!story.expiresAt) return false;
  return new Date(story.expiresAt).getTime() > now.getTime();
}

async function listStories(req, res, next) {
  try {
    const now = new Date();
    const viewer = await resolveViewer(req);
    await archiveExpiredStories(now);
    const hiddenAuthorIds = new Set((viewer.hiddenStoryAuthorIds || []).map(String));
    const rows = await Story.find({ archivedAt: null, expiresAt: { $gt: now } }).sort({ createdAt: -1 }).lean();
    const grouped = new Map();
    for (const row of rows) {
      const key = String(row.authorId);
      if (hiddenAuthorIds.has(key)) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }

    const ids = Array.from(grouped.keys());
    const users = await User.find({ _id: { $in: ids } }).select('_id username avatarUrl').lean();
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    const viewerId = String(viewer._id);

    const items = ids
      .map((authorId) => {
        const stories = (grouped.get(authorId) || []).map((story) => serializeStory(story, viewerId));
        const author = userMap.get(authorId);
        const latest = stories[0];
        return {
          id: authorId,
          authorId,
          username: author?.username || latest?.authorUsername || 'user',
          avatarUrl: normalizePublicMediaUrl(author?.avatarUrl || ''),
          hasUnseen: authorId === viewerId ? false : stories.some((story) => !story.viewedByMe),
          latestCreatedAt: latest?.createdAt,
          stories,
        };
      })
      .sort((a, b) => new Date(b.latestCreatedAt || 0).getTime() - new Date(a.latestCreatedAt || 0).getTime());

    const myIndex = items.findIndex((entry) => entry.authorId === viewerId);
    if (myIndex > 0) {
      const [mine] = items.splice(myIndex, 1);
      items.unshift(mine);
    }

    res.json({ ok: true, data: { items } });
  } catch (err) {
    next(err);
  }
}

async function listArchivedStories(req, res, next) {
  try {
    const now = new Date();
    const viewer = await resolveViewer(req);
    await archiveExpiredStories(now);
    const rows = await Story.find({ authorId: String(viewer._id), archivedAt: { $ne: null } })
      .sort({ archivedAt: -1, createdAt: -1 })
      .lean();
    res.json({
      ok: true,
      data: {
        items: rows.map((story) => serializeStory(story, String(viewer._id))),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function createStory(req, res, next) {
  let shouldCleanupUpload = false;
  let generatedThumbnailPath = '';
  try {
    const viewer = await resolveViewer(req);
    const file = req.file;
    if (!file) throw new AppError('Story media is required', 400, 'STORY_MEDIA_REQUIRED');
    shouldCleanupUpload = true;
    const isVideo = String(file.mimetype || '').startsWith('video/');
    const mediaUrl = normalizePublicMediaUrl(`/uploads/posts/stories/${path.basename(file.path)}`);
    const caption = String(req.body?.caption || '').trim();
    if (caption.length > 300) {
      throw new AppError('Story caption is too long', 400, 'INVALID_STORY_CAPTION');
    }

    let thumbnailUrl = mediaUrl;
    if (isVideo) {
      const durationSec = await getVideoDurationSeconds(file.path);
      if (durationSec > MAX_STORY_VIDEO_DURATION_SECONDS) {
        throw new AppError(
          `Story video must be ${MAX_STORY_VIDEO_DURATION_SECONDS} seconds or shorter`,
          400,
          'STORY_VIDEO_TOO_LONG',
        );
      }

      thumbnailUrl = await buildVideoThumbnail(file.path, path.basename(file.path));
      generatedThumbnailPath = thumbnailUrl && thumbnailUrl !== mediaUrl ? toLocalMediaPath(thumbnailUrl) : '';
    }

    const story = await Story.create({
      authorId: String(viewer._id),
      authorUsername: viewer.username,
      mediaType: isVideo ? 'video' : 'image',
      mediaUrl,
      thumbnailUrl,
      caption,
      expiresAt: new Date(Date.now() + STORY_LIFETIME_MS),
      archivedAt: null,
    });
    shouldCleanupUpload = false;
    generatedThumbnailPath = '';

    res.status(201).json({ ok: true, data: { item: serializeStory(story, String(viewer._id)) } });
  } catch (err) {
    if (shouldCleanupUpload && req.file?.path) safeUnlink(req.file.path);
    if (generatedThumbnailPath) safeUnlink(generatedThumbnailPath);
    next(err);
  }
}

async function markStoryViewed(req, res, next) {
  try {
    const now = new Date();
    const viewer = await resolveViewer(req);
    await archiveExpiredStories(now);
    const story = await Story.findById(String(req.params.storyId));
    if (!story || !isActiveStory(story, now)) throw new AppError('Story not found', 404, 'STORY_NOT_FOUND');

    const viewerId = String(viewer._id);
    if (String(story.authorId) !== viewerId) {
      const nextViews = normalizeStoryViews(story).filter((row) => row.userId !== viewerId);
      nextViews.unshift({
        userId: viewerId,
        username: viewer.username,
        viewedAt: now,
      });
      story.views = nextViews;
      await story.save();
    }

    res.json({
      ok: true,
      data: {
        storyId: String(story._id),
        viewedByMe: true,
        viewersCount: normalizeStoryViews(story).length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function listStoryViewers(req, res, next) {
  try {
    const now = new Date();
    const viewer = await resolveViewer(req);
    await archiveExpiredStories(now);
    const story = await Story.findById(String(req.params.storyId)).lean();
    if (!story) throw new AppError('Story not found', 404, 'STORY_NOT_FOUND');
    if (String(story.authorId) !== String(viewer._id)) throw new AppError('Forbidden', 403, 'FORBIDDEN');

    const views = normalizeStoryViews(story);
    const users = await User.find({ _id: { $in: views.map((row) => row.userId) } }).select('_id username avatarUrl').lean();
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    const items = views.map((row) => serializeStoryViewer(row, userMap.get(row.userId)));

    res.json({
      ok: true,
      data: {
        count: items.length,
        items,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function toggleStoryLike(req, res, next) {
  try {
    const now = new Date();
    const viewer = await resolveViewer(req);
    ensureCanLike(viewer);
    await archiveExpiredStories(now);
    const story = await Story.findById(String(req.params.storyId));
    if (!story || !isActiveStory(story, now)) throw new AppError('Story not found', 404, 'STORY_NOT_FOUND');
    const me = String(viewer._id);
    const idx = (story.likes || []).indexOf(me);
    let liked = false;
    if (idx >= 0) story.likes.splice(idx, 1);
    else {
      story.likes.push(me);
      liked = true;
    }
    await story.save();

    const actorId = String(viewer._id);
    const actorUsername = viewer.username;
    if (liked) {
      notificationService.notifyStoryLike({
        story,
        actorId,
        actorUsername,
      }).catch((error) => {
        console.error('notifyStoryLike failed:', error?.message || error);
      });
    } else {
      notificationService.removeNotificationActor({
        type: 'like',
        targetType: 'story',
        targetId: String(story._id),
        recipientId: String(story.authorId),
        actorId,
        actorUsername,
      }).catch((error) => {
        console.error('removeStoryLikeNotification failed:', error?.message || error);
      });
    }

    res.json({ ok: true, data: { liked, likesCount: story.likes.length } });
  } catch (err) {
    next(err);
  }
}

async function hideStory(req, res, next) {
  try {
    const now = new Date();
    const viewer = await resolveViewer(req);
    await archiveExpiredStories(now);
    const story = await Story.findById(String(req.params.storyId)).lean();
    if (!story || !isActiveStory(story, now)) throw new AppError('Story not found', 404, 'STORY_NOT_FOUND');
    const authorId = String(story.authorId);
    const viewerId = String(viewer._id);
    if (authorId === viewerId) throw new AppError('Cannot hide your own story', 400, 'CANNOT_HIDE_OWN_STORY');

    const current = new Set((viewer.hiddenStoryAuthorIds || []).map(String));
    current.add(authorId);
    viewer.hiddenStoryAuthorIds = Array.from(current);
    await viewer.save();

    res.json({ ok: true, data: { hiddenAuthorId: authorId } });
  } catch (err) {
    next(err);
  }
}

async function deleteStory(req, res, next) {
  try {
    const now = new Date();
    const viewer = await resolveViewer(req);
    await archiveExpiredStories(now);
    const story = await Story.findById(String(req.params.storyId));
    if (!story) throw new AppError('Story not found', 404, 'STORY_NOT_FOUND');
    if (String(story.authorId) !== String(viewer._id)) throw new AppError('Forbidden', 403, 'FORBIDDEN');

    safeUnlink(toLocalMediaPath(story.mediaUrl));
    if (story.thumbnailUrl && story.thumbnailUrl !== story.mediaUrl) safeUnlink(toLocalMediaPath(story.thumbnailUrl));
    await story.deleteOne();

    res.json({ ok: true, data: { removedId: String(req.params.storyId) } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listStories,
  listArchivedStories,
  createStory,
  markStoryViewed,
  listStoryViewers,
  toggleStoryLike,
  hideStory,
  deleteStory,
};

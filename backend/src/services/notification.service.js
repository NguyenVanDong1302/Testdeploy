const crypto = require('crypto');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { getIO } = require('../realtime/socket');

let indexesEnsured = false;
const notificationFeedFilter = {
  $or: [
    { type: 'follow', targetType: 'user' },
    { type: { $in: ['like', 'comment'] }, targetType: 'post' },
  ],
};

function legacyUserId(username) {
  return crypto.createHash('sha256').update(String(username || '').trim()).digest('hex').slice(0, 16);
}

function isNotificationFeedItem(notification = {}) {
  const type = String(notification.type || '');
  const targetType = String(notification.targetType || '');
  if (type === 'follow' && targetType === 'user') return true;
  return (type === 'like' || type === 'comment') && targetType === 'post';
}

function withNotificationFeedFilter(filter = {}) {
  return {
    ...filter,
    $or: notificationFeedFilter.$or,
  };
}

function buildRecipientFilter(recipientIds) {
  return {
    recipientId: recipientIds.length > 1 ? { $in: recipientIds } : (recipientIds[0] || ''),
  };
}

async function ensureIndexes() {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    await Notification.collection.dropIndex('recipientId_1_type_1_targetType_1_targetId_1');
  } catch (_err) {
    // ignore if missing
  }
  try {
    await Notification.syncIndexes();
  } catch (err) {
    console.error('Notification syncIndexes failed:', err?.message || err);
  }
}

function buildNotifyMessage(notification) {
  const names = Array.isArray(notification.actorUsernames)
    ? notification.actorUsernames.filter(Boolean)
    : [];

  const first = names[0] || 'Ai đó';
  const others = Math.max((notification.totalEvents || names.length || 1) - 1, 0);

  if (notification.type === 'follow') {
    return others > 0
      ? `${first} và ${others} người khác đã theo dõi bạn.`
      : `${first} đã theo dõi bạn.`;
  }

  if (notification.type === 'like') {
    if (notification.targetType === 'story') {
      return others > 0
        ? `${first} và ${others} người khác đã thích tin của bạn.`
        : `${first} đã thích tin của bạn.`;
    }
    return others > 0
      ? `${first} và ${others} người khác đã thích bài viết của bạn.`
      : `${first} đã thích bài viết của bạn.`;
  }

  if (notification.type === 'comment') {
    return others > 0
      ? `${first} và ${others} người khác đã bình luận về bài viết của bạn.`
      : `${first} đã bình luận về bài viết của bạn.`;
  }

  if (notification.type === 'moderation') {
    return String(notification.previewText || 'Tài khoản của bạn có cập nhật từ hệ thống quản trị.');
  }

  return `${first} đã gửi cho bạn một tin nhắn mới.`;
}

function isSameActor({ recipientId, actorId, recipientUsername = '', actorUsername = '' }) {
  if (recipientId && actorId && String(recipientId) === String(actorId)) return true;
  if (recipientUsername && actorUsername && String(recipientUsername).trim().toLowerCase() === String(actorUsername).trim().toLowerCase()) return true;
  return false;
}

async function getRecipientRooms(recipientId) {
  const normalizedRecipientId = String(recipientId || '').trim();
  const rooms = new Set();
  if (!normalizedRecipientId) return [];

  rooms.add(`user:${normalizedRecipientId}`);

  const user = await User.findById(normalizedRecipientId).select('_id username').lean().catch(() => null);
  if (user?._id) rooms.add(`user:${String(user._id)}`);
  if (user?.username) {
    rooms.add(`username:${String(user.username)}`);
    rooms.add(`user:${legacyUserId(user.username)}`);
  }

  return Array.from(rooms);
}

async function emitToRecipient(io, recipientId, event, payload) {
  if (!io) return;
  const rooms = await getRecipientRooms(recipientId);
  if (!rooms.length) return;
  for (const room of rooms) {
    io.to(room).emit(event, payload);
  }
}

async function emitNotification(recipientId, notification) {
  let io;
  try {
    io = getIO();
  } catch (_err) {
    return;
  }

  const unreadCount = await Notification.countDocuments(withNotificationFeedFilter({ recipientId, isRead: false }));
  if (isNotificationFeedItem(notification)) {
    await emitToRecipient(io, recipientId, 'notification:new', notification);
  }
  await emitToRecipient(io, recipientId, 'notification:count', { unreadCount });
  if (isNotificationFeedItem(notification)) {
    await emitToRecipient(io, recipientId, 'notify', {
      id: notification._id,
      type: notification.type,
      postId: notification.postId,
      targetType: notification.targetType,
      targetId: notification.targetId,
      message: buildNotifyMessage(notification),
      createdAt: notification.lastEventAt,
    });
  }
}

async function upsertNotification({
  type,
  targetType,
  targetId,
  recipientId,
  actorId,
  actorUsername,
  postId = '',
  previewText = '',
}) {
  if (!recipientId || !targetId || !type || !actorId) return null;
  if (String(recipientId) === String(actorId)) return null;

  await ensureIndexes();

  const now = new Date();
  try {
    await Notification.findOneAndUpdate(
      {
        recipientId,
        type,
        targetType,
        targetId: String(targetId),
      },
      {
        $setOnInsert: {
          recipientId,
          type,
          targetType,
          targetId: String(targetId),
          postId: postId ? String(postId) : '',
        },
        $addToSet: {
          actors: String(actorId),
          actorUsernames: String(actorUsername || actorId),
        },
        $set: {
          previewText: previewText || '',
          isRead: false,
          readAt: null,
          lastEventAt: now,
        },
        $inc: { totalEvents: 1 },
      },
      { upsert: true, new: false },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const notification = await Notification.findOne({
    recipientId,
    type,
    targetType,
    targetId: String(targetId),
  }).lean();

  if (notification) {
    await emitNotification(recipientId, notification);
  }

  return notification;
}

async function removeNotificationActor({ type, targetType, targetId, recipientId, actorId, actorUsername }) {
  if (!recipientId || !targetId || !actorId) return null;
  await ensureIndexes();

  const update = {
    $pull: {
      actors: String(actorId),
    },
    $inc: { totalEvents: -1 },
  };

  if (actorUsername) update.$pull.actorUsernames = String(actorUsername);

  const doc = await Notification.findOneAndUpdate(
    {
      recipientId,
      type,
      targetType,
      targetId: String(targetId),
    },
    update,
    { new: true },
  );

  if (!doc) return null;

  doc.totalEvents = Math.max(0, doc.totalEvents || 0);
  if (!doc.actors?.length || doc.totalEvents <= 0) {
    await Notification.deleteOne({ _id: doc._id });
  } else {
    await doc.save();
    await emitNotification(recipientId, doc.toObject ? doc.toObject() : doc);
  }

  return doc;
}

async function notifyPostLike({ post, actorId, actorUsername }) {
  if (!post?.authorId) return null;
  if (isSameActor({ recipientId: post.authorId, actorId, recipientUsername: post.authorUsername, actorUsername })) return null;
  return upsertNotification({
    type: 'like',
    targetType: 'post',
    targetId: post._id,
    postId: post._id,
    recipientId: post.authorId,
    actorId,
    actorUsername,
  });
}

async function notifyPostComment({ post, actorId, actorUsername, previewText }) {
  if (!post?.authorId) return null;
  if (isSameActor({ recipientId: post.authorId, actorId, recipientUsername: post.authorUsername, actorUsername })) return null;
  return upsertNotification({
    type: 'comment',
    targetType: 'post',
    targetId: post._id,
    postId: post._id,
    recipientId: post.authorId,
    actorId,
    actorUsername,
    previewText,
  });
}

async function notifyStoryLike({ story, actorId, actorUsername }) {
  if (!story?.authorId) return null;
  if (isSameActor({ recipientId: story.authorId, actorId, recipientUsername: story.authorUsername, actorUsername })) return null;
  return upsertNotification({
    type: 'like',
    targetType: 'story',
    targetId: String(story._id),
    recipientId: String(story.authorId),
    actorId: String(actorId),
    actorUsername,
    previewText: '',
  });
}

async function notifyFollow({ recipientId, actorId, actorUsername, recipientUsername = '' }) {
  if (!recipientId || !actorId) return null;
  if (isSameActor({ recipientId, actorId, recipientUsername, actorUsername })) return null;
  return upsertNotification({
    type: 'follow',
    targetType: 'user',
    targetId: recipientId,
    recipientId,
    actorId,
    actorUsername,
  });
}

async function notifyModerationAction({
  recipientId,
  actorId = 'admin_system',
  actorUsername = 'admin',
  postId = '',
  previewText = '',
}) {
  if (!recipientId || !previewText) return null;

  await ensureIndexes();
  const now = new Date();

  const doc = await Notification.create({
    recipientId: String(recipientId),
    type: 'moderation',
    targetType: 'moderation',
    targetId: `moderation:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
    postId: postId ? String(postId) : '',
    actors: [String(actorId || 'admin_system')],
    actorUsernames: [String(actorUsername || 'admin')],
    totalEvents: 1,
    previewText: String(previewText || ''),
    isRead: false,
    readAt: null,
    lastEventAt: now,
  });

  const payload = doc.toObject ? doc.toObject() : doc;
  await emitNotification(String(recipientId), payload);
  return payload;
}

async function removeFollowNotification({ recipientId, actorId, actorUsername }) {
  if (!recipientId || !actorId) return null;
  return removeNotificationActor({
    type: 'follow',
    targetType: 'user',
    targetId: recipientId,
    recipientId,
    actorId,
    actorUsername,
  });
}

function normalizeRecipientIds(userIds) {
  const list = Array.isArray(userIds) ? userIds : [userIds];
  return Array.from(new Set(list.map((item) => String(item || '').trim()).filter(Boolean)));
}

async function listNotifications({ userIds, userId, onlyUnread = false }) {
  await ensureIndexes();
  const recipientIds = normalizeRecipientIds(userIds || userId);
  const filter = withNotificationFeedFilter(buildRecipientFilter(recipientIds));
  if (onlyUnread) filter.isRead = false;

  const [items, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ lastEventAt: -1, createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments(withNotificationFeedFilter({ ...buildRecipientFilter(recipientIds), isRead: false })),
  ]);

  return { items, unreadCount };
}

async function markRead({ userIds, userId, id, isRead }) {
  await ensureIndexes();
  const recipientIds = normalizeRecipientIds(userIds || userId);
  const notification = await Notification.findOneAndUpdate(
    withNotificationFeedFilter({ _id: id, ...buildRecipientFilter(recipientIds) }),
    {
      $set: {
        isRead: Boolean(isRead),
        readAt: isRead ? new Date() : null,
      },
    },
    { new: true },
  ).lean();

  if (notification) {
    const emitRecipientId = String(notification.recipientId || recipientIds[0] || '');
    await emitNotification(emitRecipientId, notification);
  }
  return notification;
}

async function markAllRead({ userIds, userId }) {
  await ensureIndexes();
  const recipientIds = normalizeRecipientIds(userIds || userId);
  await Notification.updateMany(
    withNotificationFeedFilter({ ...buildRecipientFilter(recipientIds), isRead: false }),
    { $set: { isRead: true, readAt: new Date() } },
  );
  const unreadCount = await Notification.countDocuments(withNotificationFeedFilter({ ...buildRecipientFilter(recipientIds), isRead: false }));
  try {
    const io = getIO();
    for (const recipientId of recipientIds) {
      await emitToRecipient(io, recipientId, 'notification:count', { unreadCount });
    }
  } catch (_err) {
    // ignore
  }
  return { unreadCount };
}

module.exports = {
  ensureIndexes,
  notifyPostLike,
  notifyPostComment,
  notifyStoryLike,
  removeNotificationActor,
  removePostLikeActor: ({ postId, recipientId, actorId, actorUsername }) =>
    removeNotificationActor({ type: 'like', targetType: 'post', targetId: postId, recipientId, actorId, actorUsername }),
  notifyFollow,
  notifyModerationAction,
  removeFollowNotification,
  listNotifications,
  markRead,
  markAllRead,
  buildNotifyMessage,
};

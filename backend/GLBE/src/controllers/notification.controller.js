const User = require('../models/User');
const { AppError } = require('../utils/errors');
const notificationService = require('../services/notification.service');

function legacyUserId(username) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(username || '')).digest('hex').slice(0, 16);
}

async function resolveRecipientIds(req) {
  const username = String(req.user?.username || req.headers['x-username'] || '').trim();
  if (!username) throw new AppError('Username required', 401, 'USERNAME_REQUIRED');
  const user = await User.findOne({ username }).select('_id');
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  return [String(user._id), legacyUserId(username)];
}

async function listNotifications(req, res, next) {
  try {
    const userIds = await resolveRecipientIds(req);
    const onlyUnread = ['1', 'true', 'yes'].includes(String(req.query.onlyUnread || '').toLowerCase());
    const data = await notificationService.listNotifications({ userIds, onlyUnread });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

async function markNotificationRead(req, res, next) {
  try {
    const userIds = await resolveRecipientIds(req);
    const item = await notificationService.markRead({ userIds, id: req.params.id, isRead: true });
    if (!item) throw new AppError('Notification not found', 404, 'NOT_FOUND');
    res.json({ ok: true, data: item });
  } catch (err) {
    next(err);
  }
}

async function markNotificationUnread(req, res, next) {
  try {
    const userIds = await resolveRecipientIds(req);
    const item = await notificationService.markRead({ userIds, id: req.params.id, isRead: false });
    if (!item) throw new AppError('Notification not found', 404, 'NOT_FOUND');
    res.json({ ok: true, data: item });
  } catch (err) {
    next(err);
  }
}

async function markAllNotificationsRead(req, res, next) {
  try {
    const userIds = await resolveRecipientIds(req);
    const data = await notificationService.markAllRead({ userIds });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listNotifications,
  markNotificationRead,
  markNotificationUnread,
  markAllNotificationsRead,
};

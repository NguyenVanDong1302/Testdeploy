const express = require('express');
const { sessionUser } = require('../middlewares/sessionUser');
const {
  listNotifications,
  markNotificationRead,
  markNotificationUnread,
  markAllNotificationsRead,
} = require('../controllers/notification.controller');

const router = express.Router();
router.use(sessionUser);

router.get('/', listNotifications);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);
router.patch('/:id/unread', markNotificationUnread);

module.exports = router;

const express = require('express');
const { sessionUser } = require('../middlewares/sessionUser');
const { uploadStoryMedia } = require('../middlewares/uploadStoryMedia');
const {
  listStories,
  listArchivedStories,
  createStory,
  markStoryViewed,
  listStoryViewers,
  toggleStoryLike,
  hideStory,
  deleteStory,
} = require('../controllers/story.controller');

const router = express.Router();
router.use(sessionUser);
router.get('/', listStories);
router.get('/archive', listArchivedStories);
router.post('/', uploadStoryMedia.single('media'), createStory);
router.post('/:storyId/view', markStoryViewed);
router.get('/:storyId/viewers', listStoryViewers);
router.post('/:storyId/like', toggleStoryLike);
router.post('/:storyId/hide', hideStory);
router.delete('/:storyId', deleteStory);

module.exports = router;

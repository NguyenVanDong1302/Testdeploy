const express = require("express");
const { sessionUser } = require("../middlewares/sessionUser");
const { uploadPostMedia } = require("../middlewares/uploadPostMedia");
const { uploadCommentMedia } = require("../middlewares/uploadCommentMedia");
const {
  createPost,
  listPosts,
  getPost,
  updatePost,
  recordView,
  deletePost,
  toggleLike,
  removeLike,
  reportPost,
  addComment,
  listComments,
  deleteComment,
  addCommentLike,
  removeCommentLike,
} = require("../controllers/post.controller");

const router = express.Router();
router.use(sessionUser);

router.post("/", uploadPostMedia.array("media", 10), createPost);
router.get("/", listPosts);
router.get("/:id", getPost);
router.post("/:id/view", recordView);
router.post("/:id/report", reportPost);
router.patch("/:id", updatePost);
router.delete("/:id", deletePost);

router.post("/:id/like", toggleLike);
router.delete("/:id/like", removeLike);

router.post("/:id/comments", uploadCommentMedia.single("media"), addComment);
router.get("/:id/comments", listComments);
router.delete("/:id/comments/:commentId", deleteComment);
router.post("/:id/comments/:commentId/like", addCommentLike);
router.delete("/:id/comments/:commentId/like", removeCommentLike);

module.exports = router;

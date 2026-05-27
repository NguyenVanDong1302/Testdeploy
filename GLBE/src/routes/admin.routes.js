const express = require("express");
const { auth } = require("../middlewares/auth");
const { requireAdmin } = require("../middlewares/requireAdmin");
const {
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
} = require("../controllers/admin.controller");

const router = express.Router();

router.use(auth, requireAdmin);

router.get("/accounts/stats", getAccountStats);
router.get("/accounts", listAccountsForAdmin);
router.get("/posts", listPostsForAdmin);
router.get("/posts/:id", getPostDetailForAdmin);
router.patch("/posts/:id/actions", applyPostActionForAdmin);
router.get("/reports/posts", listReportedPosts);
router.get("/violations", listViolations);
router.patch("/posts/:id/moderation", updatePostModeration);
router.post("/reports/posts/:id/resolve", resolveReportedPost);
router.patch("/users/:id/restrictions", updateUserRestrictions);
router.patch("/users/:id/moderation", updateUserModeration);

module.exports = router;

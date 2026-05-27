const express = require("express");
const postRoutes = require("./post.routes");
const { sessionUser } = require("../middlewares/sessionUser");
const userRoutes = require("./user.routes");
const notificationRoutes = require("./notification.routes");
const authRoutes = require("./auth.routes");
const messageRoutes = require("./message.routes");
const storyRoutes = require("./story.routes");
const adminRoutes = require("./admin.routes");

const router = express.Router();

router.get("/health", (req, res) =>
  res.json({ ok: true, message: "API is healthy" }),
);

router.use("/auth", authRoutes);
router.use("/posts", postRoutes);
router.use("/users", userRoutes);
router.use("/notifications", notificationRoutes);
router.use("/messages", messageRoutes);
router.use("/stories", storyRoutes);
router.use("/admin", adminRoutes);

router.get("/whoami", sessionUser, (req, res) => {
  res.json({
    ok: true,
    data: { userId: req.user.sub, username: req.user.username },
  });
});

module.exports = router;

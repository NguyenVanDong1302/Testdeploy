const express = require("express");
const { sessionUser } = require("../middlewares/sessionUser");
const { listFollowingFeed } = require("../controllers/feed.controller");

const router = express.Router();
router.use(sessionUser);

router.get("/following", listFollowingFeed);

module.exports = router;

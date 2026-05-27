const express = require("express");
const {
  getProfile,
  follow,
  unfollow,
  listFollowers,
  listFollowing,
  listUsers,
  updateMyProfile,
  changeMyPassword,
  changeMyUsername,
} = require("../controllers/user.controller");
const { sessionUser } = require("../middlewares/sessionUser");
const { uploadAvatarImage } = require("../middlewares/uploadAvatarImage");

const router = express.Router();

router.get("/", listUsers);

router.get("/:username", getProfile);
router.get("/:username/followers", listFollowers);
router.get("/:username/following", listFollowing);

router.patch("/me/profile", sessionUser, uploadAvatarImage.single("avatar"), updateMyProfile);
router.patch("/me/password", sessionUser, changeMyPassword);
router.patch("/me/username", sessionUser, changeMyUsername);
router.post("/follow", sessionUser, follow);
router.delete("/follow", sessionUser, unfollow);

module.exports = router;

const express = require("express");
const { register, login, sessionStatus } = require("../controllers/auth.controller");
const { sessionUser } = require("../middlewares/sessionUser");
const { authRateLimit } = require("../middlewares/authRateLimit");

const router = express.Router();

router.post("/register", authRateLimit, register);
router.post("/login", authRateLimit, login);
router.get("/session-status", sessionUser, sessionStatus);

module.exports = router;

const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { AppError } = require("../utils/errors");
const { avatarMediaDir } = require("../config/media");

const uploadDir = avatarMediaDir;
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeBase = path
      .basename(file.originalname || "avatar", ext)
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "avatar";

    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBase}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ];

  if (!allowed.includes(file.mimetype)) {
    return cb(new AppError("Only image files are allowed for avatar", 400, "INVALID_AVATAR_TYPE"));
  }

  cb(null, true);
}

const uploadAvatarImage = multer({
  storage,
  fileFilter,
  limits: {
    files: 1,
    fileSize: 15 * 1024 * 1024,
  },
});

module.exports = { uploadAvatarImage };

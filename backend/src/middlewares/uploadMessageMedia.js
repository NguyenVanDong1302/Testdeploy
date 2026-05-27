const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { AppError } = require("../utils/errors");
const { mediaRoot } = require("../config/media");

const uploadDir = path.join(mediaRoot, "messages");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeBase = path
      .basename(file.originalname || 'file', ext)
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'message';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBase}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowed = [
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/webm", "video/quicktime", "video/x-m4v", "video/ogg"
  ];
  if (!allowed.includes(file.mimetype)) {
    return cb(new AppError("Chỉ cho phép gửi ảnh hoặc video trong tin nhắn", 400, "INVALID_MESSAGE_MEDIA_TYPE"));
  }
  cb(null, true);
}

const uploadMessageMedia = multer({
  storage,
  fileFilter,
  limits: { files: 10, fileSize: 80 * 1024 * 1024 },
});

module.exports = { uploadMessageMedia };

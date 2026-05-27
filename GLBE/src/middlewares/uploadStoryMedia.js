const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { AppError } = require('../utils/errors');
const { postMediaDir } = require('../config/media');

const uploadDir = path.join(postMediaDir, 'stories');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeBase = path.basename(file.originalname || 'story', ext)
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'story';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBase}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowed = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
  ];
  if (!allowed.includes(file.mimetype)) {
    return cb(new AppError('Only image/video story files are allowed', 400, 'INVALID_STORY_MEDIA'));
  }
  cb(null, true);
}

const uploadStoryMedia = multer({
  storage,
  fileFilter,
  limits: { files: 1, fileSize: 50 * 1024 * 1024 },
});

module.exports = { uploadStoryMedia };

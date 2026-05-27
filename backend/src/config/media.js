const path = require('path');
const os = require('os');

const mediaRoot = path.resolve(
  process.env.MEDIA_STORAGE_ROOT
  || (process.env.VERCEL ? path.join(os.tmpdir(), 'social-backend-uploads') : path.join(__dirname, '..', '..', 'public', 'uploads')),
);
const postMediaDir = path.join(mediaRoot, 'posts');
const avatarMediaDir = path.join(mediaRoot, 'avatars');
const uploadsMountPath = '/uploads/posts';

module.exports = {
  mediaRoot,
  postMediaDir,
  avatarMediaDir,
  uploadsMountPath,
};

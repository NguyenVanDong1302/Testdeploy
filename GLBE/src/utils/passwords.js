const bcrypt = require("bcrypt");

function getPasswordSaltRounds() {
  const raw = Number.parseInt(String(process.env.BCRYPT_SALT_ROUNDS || ""), 10);
  if (!Number.isFinite(raw)) return 10;
  return Math.min(Math.max(raw, 10), 14);
}

function hashPassword(password) {
  return bcrypt.hash(String(password || ""), getPasswordSaltRounds());
}

module.exports = {
  getPasswordSaltRounds,
  hashPassword,
};

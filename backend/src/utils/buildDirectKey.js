function buildDirectKey(userId1, userId2) {
  return [String(userId1), String(userId2)].sort().join(":");
}

module.exports = { buildDirectKey };

const presenceMap = new Map();

function setPresence(userId, value) {
  if (!userId) return;
  presenceMap.set(String(userId), {
    screen: value?.screen || "other",
    activeConversationId: value?.activeConversationId || "",
    updatedAt: new Date(),
  });
}

function getPresence(userId) {
  if (!userId) return null;
  return presenceMap.get(String(userId)) || null;
}

function clearPresence(userId) {
  if (!userId) return;
  presenceMap.delete(String(userId));
}

module.exports = { setPresence, getPresence, clearPresence };

const crypto = require("crypto");

const callSessions = new Map();
const sessionIdByUserId = new Map();
const sessionIdBySocketId = new Map();

function normalizeId(value) {
  return String(value || "").trim();
}

function generateSessionId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function bindSocket(sessionId, socketId) {
  const normalizedSessionId = normalizeId(sessionId);
  const normalizedSocketId = normalizeId(socketId);
  if (!normalizedSessionId || !normalizedSocketId) return;
  sessionIdBySocketId.set(normalizedSocketId, normalizedSessionId);
}

function unbindSocket(socketId) {
  const normalizedSocketId = normalizeId(socketId);
  if (!normalizedSocketId) return;
  sessionIdBySocketId.delete(normalizedSocketId);
}

function createCallSession(input = {}) {
  const session = {
    sessionId: generateSessionId(),
    conversationId: normalizeId(input.conversationId),
    mode: input.mode === "video" ? "video" : "audio",
    status: "ringing",
    createdAt: new Date().toISOString(),
    answeredAt: null,
    caller: input.caller || null,
    callee: input.callee || null,
    callerSocketId: normalizeId(input.callerSocketId),
    calleeSocketId: normalizeId(input.calleeSocketId),
  };

  callSessions.set(session.sessionId, session);

  if (session.caller?.id) sessionIdByUserId.set(normalizeId(session.caller.id), session.sessionId);
  if (session.callee?.id) sessionIdByUserId.set(normalizeId(session.callee.id), session.sessionId);
  if (session.callerSocketId) bindSocket(session.sessionId, session.callerSocketId);
  if (session.calleeSocketId) bindSocket(session.sessionId, session.calleeSocketId);

  return session;
}

function getCallSession(sessionId) {
  const normalizedSessionId = normalizeId(sessionId);
  if (!normalizedSessionId) return null;
  return callSessions.get(normalizedSessionId) || null;
}

function updateCallSession(sessionId, patch = {}) {
  const current = getCallSession(sessionId);
  if (!current) return null;

  const next = {
    ...current,
    ...patch,
  };

  callSessions.set(current.sessionId, next);

  if (Object.prototype.hasOwnProperty.call(patch, "callerSocketId")) {
    if (current.callerSocketId && current.callerSocketId !== next.callerSocketId) unbindSocket(current.callerSocketId);
    if (next.callerSocketId) bindSocket(current.sessionId, next.callerSocketId);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "calleeSocketId")) {
    if (current.calleeSocketId && current.calleeSocketId !== next.calleeSocketId) unbindSocket(current.calleeSocketId);
    if (next.calleeSocketId) bindSocket(current.sessionId, next.calleeSocketId);
  }

  return next;
}

function clearCallSession(sessionId) {
  const current = getCallSession(sessionId);
  if (!current) return null;

  callSessions.delete(current.sessionId);
  if (current.caller?.id) sessionIdByUserId.delete(normalizeId(current.caller.id));
  if (current.callee?.id) sessionIdByUserId.delete(normalizeId(current.callee.id));
  if (current.callerSocketId) unbindSocket(current.callerSocketId);
  if (current.calleeSocketId) unbindSocket(current.calleeSocketId);

  return current;
}

function getUserCallSession(userId) {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return null;
  const sessionId = sessionIdByUserId.get(normalizedUserId);
  return sessionId ? getCallSession(sessionId) : null;
}

function getSocketCallSession(socketId) {
  const normalizedSocketId = normalizeId(socketId);
  if (!normalizedSocketId) return null;
  const sessionId = sessionIdBySocketId.get(normalizedSocketId);
  return sessionId ? getCallSession(sessionId) : null;
}

module.exports = {
  createCallSession,
  getCallSession,
  updateCallSession,
  clearCallSession,
  getUserCallSession,
  getSocketCallSession,
};

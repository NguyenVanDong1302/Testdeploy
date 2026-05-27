const Conversation = require("../../models/Conversation");
const User = require("../../models/User");
const { sendMessage } = require("../../services/message.service");
const { AppError } = require("../../utils/errors");
const {
  createCallSession,
  getCallSession,
  updateCallSession,
  clearCallSession,
  getUserCallSession,
  getSocketCallSession,
} = require("./callSessionStore");

function normalizeId(value) {
  return String(value || "").trim();
}

function serializeCallUser(user) {
  return {
    id: normalizeId(user?._id || user?.id),
    username: String(user?.username || "").trim(),
    avatarUrl: String(user?.avatarUrl || "").trim(),
    bio: String(user?.bio || "").trim(),
  };
}

function buildSessionPayload(session) {
  return {
    sessionId: session.sessionId,
    conversationId: session.conversationId,
    mode: session.mode === "video" ? "video" : "audio",
    status: session.status || "ringing",
    createdAt: session.createdAt,
    answeredAt: session.answeredAt || null,
    caller: session.caller,
    callee: session.callee,
  };
}

function buildEndedPayload(session, extra = {}) {
  return {
    sessionId: session.sessionId,
    conversationId: session.conversationId,
    reason: String(extra.reason || "ended"),
    endedBy: normalizeId(extra.endedBy),
    endedAt: new Date().toISOString(),
  };
}

function emitToUserRoom(io, userId, event, payload) {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return;
  io.to(`user:${normalizedUserId}`).emit(event, payload);
}

function emitToSocket(io, socketId, event, payload) {
  const normalizedSocketId = normalizeId(socketId);
  if (!normalizedSocketId) return;
  io.to(normalizedSocketId).emit(event, payload);
}

function isUserOnline(io, userId) {
  return Number(io.sockets.adapter.rooms.get(`user:${normalizeId(userId)}`)?.size || 0) > 0;
}

async function resolveConversationCallContext({ currentUserId, conversationId, targetUserId }) {
  const normalizedConversationId = normalizeId(conversationId);
  const normalizedUserId = normalizeId(currentUserId);

  if (!normalizedConversationId) {
    throw new AppError("Thiếu đoạn chat để gọi", 400, "CALL_CONVERSATION_REQUIRED");
  }

  const conversation = await Conversation.findById(normalizedConversationId).lean();
  if (!conversation || !Array.isArray(conversation.memberIds) || !conversation.memberIds.includes(normalizedUserId)) {
    throw new AppError("Không tìm thấy đoạn chat để gọi", 404, "CALL_CONVERSATION_NOT_FOUND");
  }

  const peerId = conversation.memberIds.find((memberId) => normalizeId(memberId) !== normalizedUserId);
  if (!peerId) {
    throw new AppError("Không tìm thấy người nhận cuộc gọi", 404, "CALL_PEER_NOT_FOUND");
  }

  if (targetUserId && normalizeId(targetUserId) !== normalizeId(peerId)) {
    throw new AppError("Người nhận cuộc gọi không hợp lệ", 400, "CALL_TARGET_MISMATCH");
  }

  const [caller, callee] = await Promise.all([
    User.findById(normalizedUserId).select("_id username avatarUrl bio").lean(),
    User.findById(peerId).select("_id username avatarUrl bio").lean(),
  ]);

  if (!caller) throw new AppError("Không tìm thấy người gọi", 404, "CALLER_NOT_FOUND");
  if (!callee) throw new AppError("Không tìm thấy người nhận cuộc gọi", 404, "CALLEE_NOT_FOUND");

  return {
    conversationId: normalizeId(conversation._id),
    caller: serializeCallUser(caller),
    callee: serializeCallUser(callee),
  };
}

function getOtherParticipant(session, userId) {
  const normalizedUserId = normalizeId(userId);
  if (normalizeId(session?.caller?.id) === normalizedUserId) return session.callee;
  if (normalizeId(session?.callee?.id) === normalizedUserId) return session.caller;
  return null;
}

function assertSessionParticipant(session, userId) {
  const normalizedUserId = normalizeId(userId);
  const isCaller = normalizeId(session?.caller?.id) === normalizedUserId;
  const isCallee = normalizeId(session?.callee?.id) === normalizedUserId;
  if (!isCaller && !isCallee) {
    throw new AppError("Bạn không thuộc cuộc gọi này", 403, "CALL_FORBIDDEN");
  }
  return { isCaller, isCallee };
}

async function persistCallHistoryMessage(session, extra = {}) {
  const callerId = normalizeId(session?.caller?.id);
  const conversationId = normalizeId(session?.conversationId);
  if (!callerId || !conversationId) return null;

  const callerUser = await User.findById(callerId)
    .select("_id username email avatarUrl bio accountLocked accountLockedAt accountLockedReason restrictions");
  if (!callerUser) return null;

  const prefix = session?.mode === "video" ? "📹 Cuộc gọi video" : "📞 Cuộc gọi thoại";
  const answeredAt = session?.answeredAt ? new Date(session.answeredAt).getTime() : 0;
  const wasAnswered = Boolean(answeredAt > 0 || session?.status === "accepted");
  const durationSec = answeredAt > 0 ? Math.max(0, Math.round((Date.now() - answeredAt) / 1000)) : 0;
  let text = prefix;

  if (wasAnswered) {
    if (durationSec > 0) {
      const minutes = Math.floor(durationSec / 60);
      const seconds = durationSec % 60;
      text = `${prefix} · ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
  } else {
    const reason = String(extra.reason || "").trim();
    if (reason === "rejected") text = `${prefix} bị từ chối`;
    else if (reason === "busy") text = `${prefix} đang bận`;
    else if (reason === "failed") text = `${prefix} không kết nối được`;
    else text = `${prefix} nhỡ`;
  }

  try {
    return await sendMessage({
      currentUser: callerUser,
      conversationId,
      text,
    });
  } catch (error) {
    console.error("persistCallHistoryMessage failed:", error?.message || error);
    return null;
  }
}

async function endSession(io, sessionId, extra = {}) {
  const session = clearCallSession(sessionId);
  if (!session) return null;

  const payload = buildEndedPayload(session, extra);
  emitToUserRoom(io, session.caller?.id, "call:ended", payload);
  emitToUserRoom(io, session.callee?.id, "call:ended", payload);
  await persistCallHistoryMessage(session, extra);

  return { session, payload };
}

function registerCallHandlers(io, socket) {
  socket.on("call:start", async (payload = {}, ack) => {
    try {
      const currentUserId = normalizeId(socket.data.userId);
      if (!currentUserId) throw new AppError("Cần đăng nhập để gọi", 401, "CALL_UNAUTHORIZED");

      if (getUserCallSession(currentUserId)) {
        throw new AppError("Bạn đang trong một cuộc gọi khác", 409, "CALLER_BUSY");
      }

      const mode = payload.mode === "video" ? "video" : "audio";
      const { conversationId, caller, callee } = await resolveConversationCallContext({
        currentUserId,
        conversationId: payload.conversationId,
        targetUserId: payload.targetUserId,
      });

      if (!isUserOnline(io, callee.id)) {
        throw new AppError("Người dùng hiện không trực tuyến", 409, "CALLEE_OFFLINE");
      }

      if (getUserCallSession(callee.id)) {
        throw new AppError("Người dùng đang bận", 409, "CALLEE_BUSY");
      }

      const session = createCallSession({
        conversationId,
        mode,
        caller,
        callee,
        callerSocketId: socket.id,
      });

      emitToUserRoom(io, callee.id, "call:incoming", buildSessionPayload(session));

      if (typeof ack === "function") {
        ack({ ok: true, data: { session: buildSessionPayload(session) } });
      }
    } catch (error) {
      if (typeof ack === "function") {
        ack({
          ok: false,
          message: error?.message || "Không thể bắt đầu cuộc gọi",
          code: error?.code || "CALL_START_FAILED",
        });
      }
    }
  });

  socket.on("call:accept", async (payload = {}, ack) => {
    try {
      const currentUserId = normalizeId(socket.data.userId);
      if (!currentUserId) throw new AppError("Cần đăng nhập để nhận cuộc gọi", 401, "CALL_UNAUTHORIZED");

      const session = getCallSession(payload.sessionId);
      if (!session) throw new AppError("Cuộc gọi không còn tồn tại", 404, "CALL_SESSION_NOT_FOUND");

      const { isCallee } = assertSessionParticipant(session, currentUserId);
      if (!isCallee) throw new AppError("Chỉ người nhận mới có thể chấp nhận cuộc gọi", 403, "CALL_ACCEPT_FORBIDDEN");
      if (session.status !== "ringing") throw new AppError("Cuộc gọi này không còn chờ phản hồi", 409, "CALL_NOT_RINGING");

      const answeredSession = updateCallSession(session.sessionId, {
        status: "accepted",
        answeredAt: new Date().toISOString(),
        calleeSocketId: socket.id,
      });

      socket.to(`user:${currentUserId}`).emit("call:ended", {
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        reason: "answered_elsewhere",
        endedBy: currentUserId,
        endedAt: answeredSession?.answeredAt || new Date().toISOString(),
      });

      emitToSocket(io, answeredSession?.callerSocketId, "call:accepted", buildSessionPayload(answeredSession));

      if (typeof ack === "function") {
        ack({ ok: true, data: { session: buildSessionPayload(answeredSession) } });
      }
    } catch (error) {
      if (typeof ack === "function") {
        ack({
          ok: false,
          message: error?.message || "Không thể nhận cuộc gọi",
          code: error?.code || "CALL_ACCEPT_FAILED",
        });
      }
    }
  });

  socket.on("call:reject", async (payload = {}, ack) => {
    try {
      const currentUserId = normalizeId(socket.data.userId);
      if (!currentUserId) throw new AppError("Cần đăng nhập để từ chối cuộc gọi", 401, "CALL_UNAUTHORIZED");

      const session = getCallSession(payload.sessionId);
      if (!session) throw new AppError("Cuộc gọi không còn tồn tại", 404, "CALL_SESSION_NOT_FOUND");

      assertSessionParticipant(session, currentUserId);
      await endSession(io, session.sessionId, {
        reason: payload.reason || "rejected",
        endedBy: currentUserId,
      });

      if (typeof ack === "function") ack({ ok: true });
    } catch (error) {
      if (typeof ack === "function") {
        ack({
          ok: false,
          message: error?.message || "Không thể từ chối cuộc gọi",
          code: error?.code || "CALL_REJECT_FAILED",
        });
      }
    }
  });

  socket.on("call:end", async (payload = {}, ack) => {
    try {
      const currentUserId = normalizeId(socket.data.userId);
      if (!currentUserId) throw new AppError("Cần đăng nhập để kết thúc cuộc gọi", 401, "CALL_UNAUTHORIZED");

      const session = getCallSession(payload.sessionId);
      if (!session) throw new AppError("Cuộc gọi không còn tồn tại", 404, "CALL_SESSION_NOT_FOUND");

      assertSessionParticipant(session, currentUserId);
      await endSession(io, session.sessionId, {
        reason: payload.reason || "ended",
        endedBy: currentUserId,
      });

      if (typeof ack === "function") ack({ ok: true });
    } catch (error) {
      if (typeof ack === "function") {
        ack({
          ok: false,
          message: error?.message || "Không thể kết thúc cuộc gọi",
          code: error?.code || "CALL_END_FAILED",
        });
      }
    }
  });

  socket.on("call:signal", (payload = {}, ack) => {
    try {
      const currentUserId = normalizeId(socket.data.userId);
      if (!currentUserId) throw new AppError("Cần đăng nhập để gửi tín hiệu cuộc gọi", 401, "CALL_UNAUTHORIZED");

      const session = getCallSession(payload.sessionId);
      if (!session) throw new AppError("Cuộc gọi không còn tồn tại", 404, "CALL_SESSION_NOT_FOUND");

      assertSessionParticipant(session, currentUserId);
      const target = getOtherParticipant(session, currentUserId);
      if (!target?.id) throw new AppError("Không tìm thấy người nhận tín hiệu", 404, "CALL_SIGNAL_TARGET_NOT_FOUND");

      const eventPayload = {
        sessionId: session.sessionId,
        fromUserId: currentUserId,
        description: payload.description || null,
        candidate: payload.candidate || null,
      };

      if (normalizeId(target.id) === normalizeId(session.caller?.id) && session.callerSocketId) {
        emitToSocket(io, session.callerSocketId, "call:signal", eventPayload);
      } else if (normalizeId(target.id) === normalizeId(session.callee?.id) && session.calleeSocketId) {
        emitToSocket(io, session.calleeSocketId, "call:signal", eventPayload);
      } else {
        emitToUserRoom(io, target.id, "call:signal", eventPayload);
      }

      if (typeof ack === "function") ack({ ok: true });
    } catch (error) {
      if (typeof ack === "function") {
        ack({
          ok: false,
          message: error?.message || "Không thể gửi tín hiệu cuộc gọi",
          code: error?.code || "CALL_SIGNAL_FAILED",
        });
      }
    }
  });

  socket.on("call:media-state", (payload = {}, ack) => {
    try {
      const currentUserId = normalizeId(socket.data.userId);
      if (!currentUserId) throw new AppError("Cần đăng nhập để cập nhật media", 401, "CALL_UNAUTHORIZED");

      const session = getCallSession(payload.sessionId);
      if (!session) throw new AppError("Cuộc gọi không còn tồn tại", 404, "CALL_SESSION_NOT_FOUND");

      assertSessionParticipant(session, currentUserId);
      const target = getOtherParticipant(session, currentUserId);
      if (!target?.id) throw new AppError("Không tìm thấy người nhận cập nhật media", 404, "CALL_MEDIA_TARGET_NOT_FOUND");

      const eventPayload = {
        sessionId: session.sessionId,
        userId: currentUserId,
        videoEnabled: Boolean(payload.videoEnabled),
        audioEnabled: typeof payload.audioEnabled === "boolean" ? payload.audioEnabled : undefined,
      };

      if (normalizeId(target.id) === normalizeId(session.caller?.id) && session.callerSocketId) {
        emitToSocket(io, session.callerSocketId, "call:media-state", eventPayload);
      } else if (normalizeId(target.id) === normalizeId(session.callee?.id) && session.calleeSocketId) {
        emitToSocket(io, session.calleeSocketId, "call:media-state", eventPayload);
      } else {
        emitToUserRoom(io, target.id, "call:media-state", eventPayload);
      }

      if (typeof ack === "function") ack({ ok: true });
    } catch (error) {
      if (typeof ack === "function") {
        ack({
          ok: false,
          message: error?.message || "Không thể cập nhật media cuộc gọi",
          code: error?.code || "CALL_MEDIA_FAILED",
        });
      }
    }
  });

  socket.on("disconnect", () => {
    const session = getSocketCallSession(socket.id);
    if (!session) return;
    void endSession(io, session.sessionId, {
      reason: "disconnected",
      endedBy: normalizeId(socket.data.userId),
    });
  });
}

module.exports = { registerCallHandlers };

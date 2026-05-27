const crypto = require("crypto");
const User = require("../models/User");
const {
  sendMessage,
  markConversationRead,
} = require("../services/message.service");
const { registerCallHandlers } = require("./calls/registerCallHandlers");
const { setIO, getIO } = require("./io");
const { setPresence, clearPresence } = require("../utils/presenceStore");
const {
  isProbablyJwt,
  verifyAccessToken,
} = require("../utils/authToken");

function legacyUserId(username) {
  return crypto
    .createHash("sha256")
    .update(String(username || "").trim())
    .digest("hex")
    .slice(0, 16);
}

async function resolveSocketUser(socket) {
  const auth = socket.handshake.auth || {};
  const token = String(auth.token || "").trim();
  const username = String(auth.username || "").trim();

  if (token && isProbablyJwt(token)) {
    try {
      const payload = verifyAccessToken(token);
      const byId = payload?.sub ? await User.findById(String(payload.sub)).select("_id username") : null;
      if (byId) return byId;
    } catch (_err) {
      return null;
    }
  }

  if (username) {
    const byUsername = await User.findOne({ username }).select("_id username");
    if (byUsername) return byUsername;
  }

  return null;
}

function initSocket(io) {
  setIO(io);

  io.on("connection", async (socket) => {
    const me = await resolveSocketUser(socket);

    if (me) {
      const normalizedUserId = String(me._id);
      const normalizedUsername = String(me.username || "").trim();
      const normalizedLegacyUserId = legacyUserId(normalizedUsername);

      socket.data.userId = normalizedUserId;
      socket.data.username = normalizedUsername;
      socket.data.legacyUserId = normalizedLegacyUserId;

      socket.join(`user:${normalizedUserId}`);
      socket.join(`user:${normalizedLegacyUserId}`);
      socket.join(`username:${normalizedUsername}`);
      setPresence(normalizedUserId, { screen: "other", activeConversationId: "" });
    }

    socket.on("presence:update", (payload = {}) => {
      if (!socket.data.userId) return;
      setPresence(String(socket.data.userId), {
        screen: payload.screen || "other",
        activeConversationId: payload.activeConversationId || "",
      });
    });

    socket.on("conversation:join", ({ conversationId }) => {
      if (!conversationId) return;
      socket.join(`conversation:${conversationId}`);
      if (socket.data.userId) {
        setPresence(String(socket.data.userId), { screen: "messages", activeConversationId: String(conversationId) });
      }
    });

    socket.on("conversation:leave", ({ conversationId }) => {
      if (!conversationId) return;
      socket.leave(`conversation:${conversationId}`);
      if (socket.data.userId) {
        setPresence(String(socket.data.userId), { screen: "messages", activeConversationId: "" });
      }
    });

    socket.on("message:send", async (payload = {}, ack) => {
      try {
        if (!socket.data.username) throw new Error("UNAUTHORIZED");
        const currentUser = await User.findOne({ username: socket.data.username }).select("_id username email avatarUrl bio");
        if (!currentUser) throw new Error("CURRENT_USER_NOT_FOUND");
        const message = await sendMessage({
          currentUser,
          conversationId: payload.conversationId,
          text: payload.text,
          replyToMessageId: payload.replyToMessageId,
        });
        if (typeof ack === "function") ack({ ok: true, data: { message } });
      } catch (err) {
        if (typeof ack === "function") ack({ ok: false, message: err?.message || "SEND_FAILED" });
      }
    });

    socket.on("message:read", async (payload = {}, ack) => {
      try {
        if (!socket.data.username) throw new Error("UNAUTHORIZED");
        const currentUser = await User.findOne({ username: socket.data.username }).select("_id username email avatarUrl bio");
        if (!currentUser) throw new Error("CURRENT_USER_NOT_FOUND");
        const data = await markConversationRead({
          currentUser,
          conversationId: payload.conversationId,
        });
        if (typeof ack === "function") ack({ ok: true, data });
      } catch (err) {
        if (typeof ack === "function") ack({ ok: false, message: err?.message || "READ_FAILED" });
      }
    });

    registerCallHandlers(io, socket);

    socket.on("disconnect", () => {
      if (socket.data.userId) clearPresence(String(socket.data.userId));
    });
  });
}

module.exports = { initSocket, getIO };

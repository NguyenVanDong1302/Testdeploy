const {
  resolveCurrentUserFromReq,
  searchUsers,
  getOrCreateDirectConversation,
  listConversations,
  getConversationDetail,
  listMessages,
  sendMessage,
  setMessageReaction,
  toggleMessageHeart: toggleMessageHeartService,
  markConversationRead,
  getUnreadSummary,
  getConversationSettings,
  updateConversationSettings,
  clearConversationHistory,
  deleteMessage,
} = require("../services/message.service");

async function cleanupUploadedFiles(files = []) {
  const list = Array.isArray(files) ? files : [files];
  await Promise.all(
    list
      .filter((file) => file?.path)
      .map((file) =>
        require("fs").promises.unlink(file.path).catch(() => {}),
      ),
  );
}

async function searchMessageUsers(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const data = await searchUsers({
      currentUser,
      q: req.query.q || "",
      limit: req.query.limit || 8,
    });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

async function createOrGetDirectConversation(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const result = await getOrCreateDirectConversation({
      currentUser,
      targetUserId: req.body?.targetUserId,
      targetUsername: req.body?.username || req.body?.targetUsername,
    });
    res.json({
      ok: true,
      data: {
        conversation: {
          id: String(result.conversation._id),
          type: result.conversation.type,
          peer: result.peer,
          lastMessageText: result.conversation.lastMessageText || "",
          lastMessageAt: result.conversation.lastMessageAt,
          unreadCount: 0,
          nickname: result.member?.peerNickname || "",
          isBlocked: Boolean(result.member?.blockedPeer),
          blockedAt: result.member?.blockedAt || null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getConversationList(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const items = await listConversations({ currentUser, limit: req.query.limit || 30 });
    res.json({ ok: true, data: { items } });
  } catch (err) {
    next(err);
  }
}

async function getConversation(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const item = await getConversationDetail({ currentUser, conversationId: req.params.conversationId });
    res.json({ ok: true, data: item });
  } catch (err) {
    next(err);
  }
}

async function getConversationMessages(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const data = await listMessages({
      currentUser,
      conversationId: req.params.conversationId,
      limit: req.query.limit || 50,
      beforeMessageId: req.query.beforeMessageId || "",
    });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

async function postConversationMessage(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const message = await sendMessage({
      currentUser,
      conversationId: req.params.conversationId,
      text: req.body?.text || "",
      files: req.files || [],
      replyToMessageId: req.body?.replyToMessageId || "",
    });
    res.status(201).json({ ok: true, data: { message } });
  } catch (err) {
    await cleanupUploadedFiles(req.files || req.file || []);
    next(err);
  }
}


async function toggleMessageHeart(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const message = await toggleMessageHeartService({
      currentUser,
      conversationId: req.params.conversationId,
      messageId: req.params.messageId,
      shouldLike: req.method !== "DELETE",
    });
    res.json({ ok: true, data: { message } });
  } catch (err) {
    next(err);
  }
}

async function reactToMessage(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const message = await setMessageReaction({
      currentUser,
      conversationId: req.params.conversationId,
      messageId: req.params.messageId,
      emoji: req.body?.emoji || "",
    });
    res.json({ ok: true, data: { message } });
  } catch (err) {
    next(err);
  }
}

async function removeMessageReaction(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const message = await setMessageReaction({
      currentUser,
      conversationId: req.params.conversationId,
      messageId: req.params.messageId,
      emoji: "",
    });
    res.json({ ok: true, data: { message } });
  } catch (err) {
    next(err);
  }
}

async function readConversation(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const data = await markConversationRead({ currentUser, conversationId: req.params.conversationId });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

async function unreadSummary(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const data = await getUnreadSummary({ currentUser });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

async function getSettings(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const data = await getConversationSettings({ currentUser, conversationId: req.params.conversationId });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

async function patchSettings(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const data = await updateConversationSettings({
      currentUser,
      conversationId: req.params.conversationId,
      nickname: req.body?.nickname,
      isBlocked: typeof req.body?.isBlocked === 'boolean' ? req.body.isBlocked : undefined,
    });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

async function deleteHistory(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const data = await clearConversationHistory({ currentUser, conversationId: req.params.conversationId });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

async function deleteConversationMessage(req, res, next) {
  try {
    const currentUser = await resolveCurrentUserFromReq(req);
    const data = await deleteMessage({
      currentUser,
      conversationId: req.params.conversationId,
      messageId: req.params.messageId,
    });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  searchMessageUsers,
  createOrGetDirectConversation,
  getConversationList,
  getConversation,
  getConversationMessages,
  postConversationMessage,
  toggleMessageHeart,
  reactToMessage,
  removeMessageReaction,
  readConversation,
  unreadSummary,
  getSettings,
  patchSettings,
  deleteHistory,
  deleteConversationMessage,
};

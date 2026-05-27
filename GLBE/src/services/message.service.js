const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const User = require("../models/User");
const Follow = require("../models/Follow");
const Notification = require("../models/Notification");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const ConversationMember = require("../models/ConversationMember");
const { AppError } = require("../utils/errors");
const { buildDirectKey } = require("../utils/buildDirectKey");
const { getPresence } = require("../utils/presenceStore");
const { getIO } = require("../realtime/io");
const { ensureCanMessage } = require("../utils/accountModeration");

const MAX_MESSAGE_MEDIA_FILES = 10;
const MAX_MESSAGE_VIDEO_BYTES = 15 * 1024 * 1024;
const MESSAGE_REACTION_EMOJIS = ["\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F621}", "\u{1F44D}"];

async function resolveCurrentUserFromReq(req) {
  const rawUsername = (req.user?.username || req.headers["x-username"] || "").toString().trim();
  if (!rawUsername) {
    throw new AppError("Username required", 401, "USERNAME_REQUIRED");
  }
  const user = await User.findOne({ username: rawUsername })
    .select("_id username email avatarUrl bio accountLocked accountLockedAt accountLockedReason restrictions");
  if (!user) {
    throw new AppError("Không tìm thấy người dùng hiện tại", 404, "CURRENT_USER_NOT_FOUND");
  }
  return user;
}

async function ensureConversationMembers(conversation, users) {
  await Promise.all(
    users.map((user) =>
      ConversationMember.updateOne(
        { conversationId: String(conversation._id), userId: String(user._id) },
        {
          $setOnInsert: {
            conversationId: String(conversation._id),
            userId: String(user._id),
            unreadCount: 0,
            peerNickname: "",
            blockedPeer: false,
            blockedAt: null,
          },
          $set: { username: user.username },
        },
        { upsert: true },
      ),
    ),
  );
}

function serializeUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    email: user.email || "",
    bio: user.bio || "",
    avatarUrl: user.avatarUrl || "",
  };
}


function normalizePublicMediaUrl(raw = "") {
  const clean = String(raw || "").trim().replace(/\\/g, "/");
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  const base = String(process.env.MEDIA_PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
  const uploadsIndex = clean.toLowerCase().indexOf('/uploads/');
  if (uploadsIndex >= 0) return `${base}${clean.slice(uploadsIndex)}`;
  if (clean.toLowerCase().startsWith('uploads/')) return `${base}/${clean}`;
  return `${base}${clean.startsWith('/') ? clean : `/${clean}`}`;
}

function normalizeMediaItems(row) {
  const items = Array.isArray(row?.mediaItems)
    ? row.mediaItems
        .map((item) => ({
          type: item?.type === "video" ? "video" : "image",
          mediaUrl: normalizePublicMediaUrl(item?.mediaUrl || item?.url || ""),
          thumbnailUrl: normalizePublicMediaUrl(item?.thumbnailUrl || ""),
          fileName: item?.fileName || "",
          mimeType: item?.mimeType || "",
          durationSec: Number(item?.durationSec || 0),
        }))
        .filter((item) => item.mediaUrl)
    : [];

  if (items.length) return items;

  const mediaUrl = normalizePublicMediaUrl(row?.mediaUrl || "");
  if (!mediaUrl) return [];

  return [
    {
      type: row?.type === "video" ? "video" : "image",
      mediaUrl,
      thumbnailUrl: normalizePublicMediaUrl(row?.thumbnailUrl || ""),
      fileName: row?.fileName || "",
      mimeType: row?.mimeType || "",
      durationSec: Number(row?.durationSec || 0),
    },
  ];
}

function normalizeReactions(row) {
  if (Array.isArray(row?.reactions) && row.reactions.length) {
    return row.reactions
      .map((item) => ({
        userId: String(item?.userId || "").trim(),
        username: String(item?.username || "").trim(),
        emoji: String(item?.emoji || "").trim(),
      }))
      .filter((item) => item.userId && item.emoji);
  }

  return Array.isArray(row?.reactionUserIds)
    ? row.reactionUserIds
        .map((userId) => String(userId || "").trim())
        .filter(Boolean)
        .map((userId) => ({ userId, username: "", emoji: MESSAGE_REACTION_EMOJIS[0] }))
    : [];
}

function summarizeReactions(reactions = []) {
  const counts = new Map();
  for (const reaction of reactions) {
    if (!reaction?.emoji) continue;
    counts.set(reaction.emoji, (counts.get(reaction.emoji) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([emoji, count]) => ({ emoji, count }));
}

function serializeMessage(row, currentUserId = "") {
  const mediaItems = normalizeMediaItems(row);
  const firstMedia = mediaItems[0];
  const reactions = normalizeReactions(row);
  const reactionSummary = summarizeReactions(reactions);
  const myReaction = reactions.find((item) => item.userId === String(currentUserId || ""))?.emoji || "";
  return {
    id: String(row._id),
    conversationId: String(row.conversationId),
    senderId: row.senderId,
    senderUsername: row.senderUsername,
    receiverId: row.receiverId,
    receiverUsername: row.receiverUsername,
    type: row.type || (firstMedia ? firstMedia.type : "text"),
    text: row.text || "",
    mediaUrl: firstMedia?.mediaUrl || normalizePublicMediaUrl(row.mediaUrl || ""),
    thumbnailUrl: firstMedia?.thumbnailUrl || normalizePublicMediaUrl(row.thumbnailUrl || ""),
    fileName: firstMedia?.fileName || row.fileName || "",
    mimeType: firstMedia?.mimeType || row.mimeType || "",
    durationSec: firstMedia ? Number(firstMedia.durationSec || 0) : Number(row.durationSec || 0),
    mediaItems,
    reactions,
    reactionSummary,
    reactionCount: reactions.length,
    myReaction,
    heartCount: reactions.length,
    heartedByMe: myReaction === MESSAGE_REACTION_EMOJIS[0],
    replyToMessageId: row.replyToMessageId || "",
    replyToText: row.replyToText || "",
    replyToSenderUsername: row.replyToSenderUsername || "",
    replyToType: row.replyToType || "",
    replyToMediaUrl: normalizePublicMediaUrl(row.replyToMediaUrl || ""),
    storyReply: row.storyReply || undefined,
    status: row.status,
    seenAt: row.seenAt,
    createdAt: row.createdAt,
  };
}

function getMessagePreview(message) {
  const mediaItems = normalizeMediaItems(message);
  if (mediaItems.length === 1) return mediaItems[0].type === 'video' ? 'Đã gửi 1 video' : 'Đã gửi 1 ảnh';
  if (mediaItems.length > 1) {
    const videoCount = mediaItems.filter((item) => item.type === 'video').length;
    const imageCount = mediaItems.length - videoCount;
    if (videoCount === mediaItems.length) return `Da gui ${videoCount} video`;
    if (imageCount === mediaItems.length) return `Da gui ${imageCount} anh`;
    return `Da gui ${mediaItems.length} tep`;
  }
  return String(message?.text || '').trim();
}

function probeVideoDuration(filePath) {
  return new Promise((resolve) => {
    if (!filePath) return resolve(0);
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], (error, stdout) => {
      if (error) return resolve(0);
      const value = Number(String(stdout || '').trim());
      resolve(Number.isFinite(value) ? value : 0);
    });
  });
}

async function cleanupUploadedMessageFiles(files = []) {
  const list = Array.isArray(files) ? files : [files];
  await Promise.all(
    list
      .filter((file) => file?.path)
      .map((file) => fs.promises.unlink(file.path).catch(() => {})),
  );
}

function serializeConversation(row, currentUserId, currentUsername, peer, member) {
  const peerId = row.memberIds.find((id) => String(id) !== String(currentUserId)) || "";
  return {
    id: String(row._id),
    type: row.type,
    peer: peer
      ? {
          id: String(peer._id),
          username: peer.username,
          email: peer.email || "",
          bio: peer.bio || "",
          avatarUrl: peer.avatarUrl || "",
        }
      : {
          id: String(peerId),
          username: row.memberUsernames.find((u) => u !== currentUsername) || "Người dùng",
          email: "",
          bio: "",
          avatarUrl: "",
        },
    lastMessageText: row.lastMessageText || "",
    lastMessageAt: row.lastMessageAt,
    unreadCount: Number(member?.unreadCount || 0),
    nickname: member?.peerNickname || "",
    isBlocked: Boolean(member?.blockedPeer),
    blockedAt: member?.blockedAt || null,
  };
}

async function searchUsers({ currentUser, q = "", limit = 8 }) {
  const keyword = String(q || "").trim();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 20));

  const followRows = await Follow.find({ followerId: String(currentUser._id) }).select("followingId").lean();
  const followingIds = followRows.map((row) => String(row.followingId));

  const regex = keyword ? new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

  const followingFilter = {
    _id: { $in: followingIds },
    ...(regex ? { username: regex } : {}),
  };

  const suggestedFilter = {
    _id: { $nin: [String(currentUser._id), ...followingIds] },
    ...(regex ? { username: regex } : {}),
  };

  const [followingUsers, suggestedUsers] = await Promise.all([
    User.find(followingFilter).select("_id username email bio avatarUrl").sort({ username: 1 }).limit(safeLimit).lean(),
    User.find(suggestedFilter).select("_id username email bio avatarUrl").sort({ createdAt: -1 }).limit(safeLimit).lean(),
  ]);

  return {
    following: followingUsers.map((u) => ({ id: String(u._id), username: u.username, email: u.email || "", bio: u.bio || "", avatarUrl: u.avatarUrl || "" })),
    suggested: suggestedUsers.map((u) => ({ id: String(u._id), username: u.username, email: u.email || "", bio: u.bio || "", avatarUrl: u.avatarUrl || "" })),
  };
}

async function getOrCreateDirectConversation({ currentUser, targetUserId, targetUsername }) {
  ensureCanMessage(currentUser);
  const safeTargetUserId = String(targetUserId || "").trim();
  const safeTargetUsername = String(targetUsername || "").trim();

  if (!safeTargetUserId && !safeTargetUsername) {
    throw new AppError("Thiếu người dùng cần nhắn", 400, "MISSING_TARGET_USER");
  }

  const clauses = [];
  if (safeTargetUserId) {
    if (/^[a-f\d]{24}$/i.test(safeTargetUserId)) {
      clauses.push({ _id: safeTargetUserId });
    } else if (!safeTargetUsername) {
      throw new AppError("ID người dùng không hợp lệ", 400, "INVALID_TARGET_USER_ID");
    }
  }
  if (safeTargetUsername) clauses.push({ username: safeTargetUsername });

  const target = await User.findOne({ $or: clauses }).select("_id username email bio avatarUrl");
  if (!target) {
    throw new AppError("Không tìm thấy người dùng cần nhắn", 404, "TARGET_USER_NOT_FOUND");
  }
  if (String(target._id) === String(currentUser._id)) {
    throw new AppError("Không thể tự tạo chat với chính mình", 400, "SELF_CHAT_NOT_ALLOWED");
  }

  const directKey = buildDirectKey(currentUser._id, target._id);
  let conversation = await Conversation.findOne({ directKey });

  if (!conversation) {
    conversation = await Conversation.create({
      type: "direct",
      memberIds: [String(currentUser._id), String(target._id)],
      memberUsernames: [currentUser.username, target.username],
      directKey,
      lastMessageText: "",
      lastMessageAt: null,
      lastMessageSenderId: "",
    });
  }

  await ensureConversationMembers(conversation, [currentUser, target]);
  const member = await ConversationMember.findOne({ conversationId: String(conversation._id), userId: String(currentUser._id) }).lean();

  return {
    conversation,
    peer: serializeUser(target),
    member,
  };
}

async function listConversations({ currentUser, limit = 30 }) {
  const rows = await Conversation.find({ memberIds: String(currentUser._id) })
    .sort({ lastMessageAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(Math.max(1, Math.min(Number(limit) || 30, 100)))
    .lean();

  const memberRows = await ConversationMember.find({ userId: String(currentUser._id), conversationId: { $in: rows.map((r) => String(r._id)) } }).lean();
  const memberMap = new Map(memberRows.map((row) => [String(row.conversationId), row]));

  const peerIds = rows.map((row) => row.memberIds.find((id) => String(id) !== String(currentUser._id))).filter(Boolean);
  const peers = await User.find({ _id: { $in: peerIds } }).select("_id username email bio avatarUrl").lean();
  const peerMap = new Map(peers.map((u) => [String(u._id), u]));

  return rows.map((row) => {
    const peerId = row.memberIds.find((id) => String(id) !== String(currentUser._id)) || "";
    const peer = peerMap.get(String(peerId));
    const member = memberMap.get(String(row._id));
    return serializeConversation(row, currentUser._id, currentUser.username, peer, member);
  });
}

async function getConversationOrThrow({ currentUser, conversationId }) {
  const conversation = await Conversation.findById(String(conversationId));
  if (!conversation || !conversation.memberIds.includes(String(currentUser._id))) {
    throw new AppError("Không tìm thấy cuộc trò chuyện", 404, "CONVERSATION_NOT_FOUND");
  }
  return conversation;
}

async function getConversationDetail({ currentUser, conversationId }) {
  const conversation = await getConversationOrThrow({ currentUser, conversationId });
  const peerId = conversation.memberIds.find((id) => String(id) !== String(currentUser._id));
  const [peer, member] = await Promise.all([
    User.findById(peerId).select("_id username email bio avatarUrl").lean(),
    ConversationMember.findOne({ conversationId: String(conversation._id), userId: String(currentUser._id) }).lean(),
  ]);

  return serializeConversation(conversation, currentUser._id, currentUser.username, peer, member);
}

async function listMessages({
  currentUser,
  conversationId,
  limit = 50,
  beforeMessageId = "",
}) {
  await getConversationOrThrow({ currentUser, conversationId });

  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const filter = { conversationId: String(conversationId) };

  if (beforeMessageId) {
    const anchor = await Message.findOne({
      _id: String(beforeMessageId),
      conversationId: String(conversationId),
    })
      .select("_id createdAt")
      .lean();

    if (!anchor) {
      throw new AppError("Khong tim thay moc phan trang tin nhan", 404, "MESSAGE_CURSOR_NOT_FOUND");
    }

    filter.$or = [
      { createdAt: { $lt: anchor.createdAt } },
      { createdAt: anchor.createdAt, _id: { $lt: anchor._id } },
    ];
  }

  const rows = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit + 1)
    .lean();

  const hasMore = rows.length > safeLimit;
  const slice = hasMore ? rows.slice(0, safeLimit) : rows;
  const ordered = slice.reverse();
  const items = ordered.map((row) => serializeMessage(row, currentUser._id));

  return {
    items,
    pageInfo: {
      hasMore,
      nextBeforeMessageId: hasMore ? items[0]?.id || "" : "",
      limit: safeLimit,
    },
  };
}

function getSocketIOOrNull() {
  try {
    return getIO();
  } catch (_err) {
    return null;
  }
}

function emitToUser(io, userId, username, event, payload) {
  if (!io) return;
  if (userId) io.to(`user:${userId}`).emit(event, payload);
  if (username) io.to(`username:${username}`).emit(event, payload);
}

async function emitConversationSnapshot(io, conversationId, usernames) {
  if (!io) return;
  if (conversationId) io.to(`conversation:${conversationId}`).emit("conversation:updated", { conversationId });
  for (const name of usernames || []) {
    if (!name) continue;
    io.to(`username:${name}`).emit("inbox:refresh", { reason: "conversation-updated" });
  }
}

async function createMessageNotification({ recipient, sender, message }) {
  const doc = await Notification.create({
    recipientId: String(recipient._id),
    type: "message",
    targetType: "conversation",
    targetId: String(message._id),
    postId: "",
    actors: [String(sender._id)],
    actorUsernames: [sender.username],
    totalEvents: 1,
    previewText: getMessagePreview(message),
    isRead: false,
    readAt: null,
    lastEventAt: new Date(),
  });

  const io = getSocketIOOrNull();
  if (io) {
    emitToUser(io, String(recipient._id), recipient.username, "notify", {
      id: String(doc._id),
      type: "message",
      messageId: String(message._id),
      conversationId: message.conversationId,
      message: `${sender.username} ${message?.type === "text" ? "đã gửi cho bạn một tin nhắn mới." : message?.type === "image" ? "đã gửi cho bạn một ảnh." : "đã gửi cho bạn một video."}`,
      createdAt: doc.createdAt,
    });
  }
}

async function getConversationMember(conversationId, userId) {
  return ConversationMember.findOne({ conversationId: String(conversationId), userId: String(userId) }).lean();
}

async function getMemberState(conversationId, userId) {
  return getConversationMember(conversationId, userId);
}

async function sendMessage({ currentUser, conversationId, text, files = [], replyToMessageId = "" }) {
  ensureCanMessage(currentUser);
  const trimmed = String(text || "").trim();
  const conversation = await getConversationOrThrow({ currentUser, conversationId });
  const receiverId = conversation.memberIds.find((id) => String(id) !== String(currentUser._id));
  const receiver = await User.findById(receiverId).select("_id username email bio avatarUrl");
  if (!receiver) {
    throw new AppError("Người nhận không tồn tại", 404, "RECEIVER_NOT_FOUND");
  }

  const myMember = await getConversationMember(conversation._id, currentUser._id);
  const receiverMember = await getConversationMember(conversation._id, receiver._id);
  if (myMember?.blockedPeer) {
    throw new AppError("Bạn đã chặn người dùng này.", 403, "YOU_BLOCKED_PEER");
  }
  if (receiverMember?.blockedPeer) {
    throw new AppError("Bạn không thể nhắn tin cho người dùng này.", 403, "BLOCKED_BY_PEER");
  }

  const uploadedFiles = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (uploadedFiles.length > MAX_MESSAGE_MEDIA_FILES) {
    await cleanupUploadedMessageFiles(uploadedFiles);
    throw new AppError(`Chỉ được gửi tối đa ${MAX_MESSAGE_MEDIA_FILES} ảnh/video mỗi lần`, 400, "TOO_MANY_MESSAGE_MEDIA");
  }

  const mediaItems = [];
  for (const file of uploadedFiles) {
    const itemType = file.mimetype?.startsWith('video/') ? 'video' : 'image';
    if (itemType === 'video' && Number(file.size || 0) > MAX_MESSAGE_VIDEO_BYTES) {
      await cleanupUploadedMessageFiles(uploadedFiles);
      throw new AppError('Mỗi video trong tin nhắn chỉ được tối đa 15MB', 400, 'MESSAGE_VIDEO_TOO_LARGE');
    }

    let durationSec = 0;
    if (itemType === 'video') {
      durationSec = await probeVideoDuration(file.path);
      if (durationSec > 60.2) {
        await cleanupUploadedMessageFiles(uploadedFiles);
        throw new AppError('Video gửi trong tin nhắn chỉ được tối đa 1 phút', 400, 'MESSAGE_VIDEO_TOO_LONG');
      }
    }

    mediaItems.push({
      type: itemType,
      mediaUrl: normalizePublicMediaUrl(`/uploads/messages/${path.basename(file.path)}`),
      thumbnailUrl: '',
      fileName: file.originalname || '',
      mimeType: file.mimetype || '',
      durationSec,
    });
  }

  const firstMedia = mediaItems[0] || null;
  const messageType = firstMedia ? firstMedia.type : 'text';

  if (!trimmed && !mediaItems.length) {
    throw new AppError("Tin nhắn không được để trống", 400, "EMPTY_MESSAGE");
  }

  let replySource = null;
  if (replyToMessageId) {
    replySource = await Message.findOne({ _id: String(replyToMessageId), conversationId: String(conversation._id) });
    if (!replySource) {
      throw new AppError('Không tìm thấy tin nhắn cần trả lời', 404, 'REPLY_MESSAGE_NOT_FOUND');
    }
  }

  const presence = getPresence(String(receiver._id));
  const isViewingSameConversation = presence?.screen === "messages" && String(presence?.activeConversationId || "") === String(conversation._id);
  const nextStatus = isViewingSameConversation ? "seen" : presence?.screen === "messages" ? "delivered" : "sent";

  const message = await Message.create({
    conversationId: String(conversation._id),
    senderId: String(currentUser._id),
    senderUsername: currentUser.username,
    receiverId: String(receiver._id),
    receiverUsername: receiver.username,
    type: messageType,
    text: trimmed,
    mediaUrl: firstMedia?.mediaUrl || '',
    thumbnailUrl: firstMedia?.thumbnailUrl || '',
    fileName: firstMedia?.fileName || '',
    mimeType: firstMedia?.mimeType || '',
    durationSec: firstMedia ? Number(firstMedia.durationSec || 0) : 0,
    mediaItems,
    replyToMessageId: replySource ? String(replySource._id) : '',
    replyToText: replySource?.text || '',
    replyToSenderUsername: replySource?.senderUsername || '',
    replyToType: replySource?.type || '',
    replyToMediaUrl: normalizeMediaItems(replySource)[0]?.mediaUrl || normalizePublicMediaUrl(replySource?.mediaUrl || ''),
    status: nextStatus,
    seenAt: nextStatus === "seen" ? new Date() : null,
  });

  const previewText = getMessagePreview(message);
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessageText: previewText,
        lastMessageAt: message.createdAt,
        lastMessageSenderId: String(currentUser._id),
        memberUsernames: [currentUser.username, receiver.username],
      },
    },
  );

  await ConversationMember.updateOne(
    { conversationId: String(conversation._id), userId: String(currentUser._id) },
    {
      $set: {
        username: currentUser.username,
        lastReadMessageId: String(message._id),
        lastReadAt: new Date(),
      },
    },
  );

  const receiverMemberUpdate = {
    $set: { username: receiver.username },
  };
  if (nextStatus !== "seen") {
    receiverMemberUpdate.$inc = { unreadCount: 1 };
  }

  await ConversationMember.updateOne(
    { conversationId: String(conversation._id), userId: String(receiver._id) },
    receiverMemberUpdate,
  );

  if (nextStatus === 'seen') {
    await Message.updateMany(
      { conversationId: String(conversation._id), receiverId: String(currentUser._id), status: { $in: ["sent", "delivered"] } },
      { $set: { status: "seen", seenAt: new Date() } },
    );
  }

  if (String(receiver._id) !== String(currentUser._id) && nextStatus !== "seen") {
    await createMessageNotification({ recipient: receiver, sender: currentUser, message });
  }

  const payload = serializeMessage(message.toObject ? message.toObject() : message, currentUser._id);
  const io = getSocketIOOrNull();
  if (io) {
    io.to(`conversation:${conversation._id}`).emit("message:new", payload);
    emitToUser(io, String(receiver._id), receiver.username, "message:new", payload);
    emitToUser(io, String(currentUser._id), currentUser.username, "message:new", payload);
    emitToUser(io, String(receiver._id), receiver.username, "inbox:update", { conversationId: String(conversation._id) });
    emitToUser(io, String(currentUser._id), currentUser.username, "inbox:update", { conversationId: String(conversation._id) });
    await emitConversationSnapshot(io, String(conversation._id), [receiver.username, currentUser.username]);
  }

  return payload;
}

async function setMessageReaction({ currentUser, conversationId, messageId, emoji = "" }) {
  await getConversationOrThrow({ currentUser, conversationId });
  const message = await Message.findOne({ _id: String(messageId), conversationId: String(conversationId) });
  if (!message) {
    throw new AppError('Khong tim thay tin nhan', 404, 'MESSAGE_NOT_FOUND');
  }

  const normalizedEmoji = String(emoji || "").trim();
  if (normalizedEmoji && !MESSAGE_REACTION_EMOJIS.includes(normalizedEmoji)) {
    throw new AppError('Invalid reaction', 400, 'INVALID_MESSAGE_REACTION');
  }

  const userId = String(currentUser._id);
  const currentReactions = normalizeReactions(message);
  const existingReaction = currentReactions.find((item) => item.userId === userId);
  const nextReactions = currentReactions.filter((item) => item.userId !== userId);

  if (normalizedEmoji && existingReaction?.emoji !== normalizedEmoji) {
    nextReactions.push({
      userId,
      username: currentUser.username,
      emoji: normalizedEmoji,
    });
  }

  message.reactions = nextReactions;
  message.reactionUserIds = nextReactions.map((item) => item.userId);
  await message.save();

  const payload = serializeMessage(message.toObject ? message.toObject() : message, currentUser._id);
  const io = getSocketIOOrNull();
  if (io) {
    const conversation = await Conversation.findById(String(conversationId)).lean();
    const memberIds = Array.isArray(conversation?.memberIds) ? conversation.memberIds : [];
    for (const memberId of memberIds) {
      const user = await User.findById(memberId).select("_id username").lean();
      if (!user) continue;
      emitToUser(io, String(user._id), user.username, 'message:reaction', serializeMessage(message.toObject ? message.toObject() : message, String(user._id)));
    }
    io.to(`conversation:${conversationId}`).emit('conversation:updated', { conversationId });
  }
  return payload;
}

async function toggleMessageHeart({ currentUser, conversationId, messageId, shouldLike = true }) {
  return setMessageReaction({
    currentUser,
    conversationId,
    messageId,
    emoji: shouldLike ? MESSAGE_REACTION_EMOJIS[0] : '',
  });
}

async function deleteMessage({ currentUser, conversationId, messageId }) {
  const conversation = await getConversationOrThrow({ currentUser, conversationId });
  const message = await Message.findOne({ _id: String(messageId), conversationId: String(conversation._id) });
  if (!message) {
    throw new AppError('Khong tim thay tin nhan', 404, 'MESSAGE_NOT_FOUND');
  }
  if (String(message.senderId) !== String(currentUser._id)) {
    throw new AppError('You can only revoke your own message', 403, 'FORBIDDEN_MESSAGE_DELETE');
  }

  const files = new Set();
  collectPossibleMediaPaths(message.toObject ? message.toObject() : message).forEach((rawPath) => {
    const resolved = resolveLocalPath(rawPath);
    if (resolved) files.add(resolved);
  });

  await Message.deleteOne({ _id: message._id });
  await Promise.all(Array.from(files).map((filePath) => safeUnlink(filePath)));
  await Notification.deleteMany({ type: 'message', targetType: 'conversation', targetId: String(message._id) }).catch(() => {});

  if (message.status !== 'seen') {
    const receiverMember = await ConversationMember.findOne({
      conversationId: String(conversation._id),
      userId: String(message.receiverId),
    });
    if (receiverMember?.unreadCount > 0) {
      await ConversationMember.updateOne(
        { conversationId: String(conversation._id), userId: String(message.receiverId) },
        { $inc: { unreadCount: -1 } },
      );
    }
  }

  const latestMessage = await Message.findOne({ conversationId: String(conversation._id) }).sort({ createdAt: -1 });
  const nextLastMessageText = latestMessage ? getMessagePreview(latestMessage) : '';
  const nextLastMessageAt = latestMessage?.createdAt || null;
  const nextLastMessageSenderId = latestMessage?.senderId || '';

  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessageText: nextLastMessageText,
        lastMessageAt: nextLastMessageAt,
        lastMessageSenderId: nextLastMessageSenderId,
      },
    },
  );

  await ConversationMember.updateMany(
    { conversationId: String(conversation._id), lastReadMessageId: String(message._id) },
    {
      $set: {
        lastReadMessageId: latestMessage ? String(latestMessage._id) : '',
      },
    },
  );

  const payload = {
    conversationId: String(conversation._id),
    messageId: String(message._id),
    deletedBy: String(currentUser._id),
    lastMessageText: nextLastMessageText,
    lastMessageAt: nextLastMessageAt,
  };

  const io = getSocketIOOrNull();
  if (io) {
    io.to(`conversation:${conversation._id}`).emit('message:deleted', payload);
    const peerId = conversation.memberIds.find((id) => String(id) !== String(currentUser._id));
    const peer = peerId ? await User.findById(peerId).select('_id username').lean() : null;
    if (peer) emitToUser(io, String(peer._id), peer.username, 'message:deleted', payload);
    emitToUser(io, String(currentUser._id), currentUser.username, 'message:deleted', payload);
    await emitConversationSnapshot(io, String(conversation._id), conversation.memberUsernames || []);
  }

  return payload;
}

async function markConversationRead({ currentUser, conversationId }) {
  const conversation = await getConversationOrThrow({ currentUser, conversationId });
  const rows = await Message.find({
    conversationId: String(conversation._id),
    receiverId: String(currentUser._id),
    status: { $ne: "seen" },
  }).sort({ createdAt: 1 });

  const now = new Date();
  if (rows.length) {
    await Message.updateMany(
      {
        _id: { $in: rows.map((row) => row._id) },
      },
      {
        $set: {
          status: "seen",
          seenAt: now,
        },
      },
    );
  }

  const lastMessage = rows[rows.length - 1] || (await Message.findOne({ conversationId: String(conversation._id) }).sort({ createdAt: -1 }));

  await ConversationMember.updateOne(
    { conversationId: String(conversation._id), userId: String(currentUser._id) },
    {
      $set: {
        unreadCount: 0,
        lastReadAt: now,
        lastReadMessageId: lastMessage ? String(lastMessage._id) : "",
        username: currentUser.username,
      },
    },
    { upsert: true },
  );

  const io = getSocketIOOrNull();
  if (io) {
    const payload = {
      conversationId: String(conversation._id),
      userId: String(currentUser._id),
      username: currentUser.username,
      seenAt: now,
    };
    io.to(`conversation:${conversation._id}`).emit("message:seen", payload);
    const peerId = conversation.memberIds.find((id) => String(id) !== String(currentUser._id));
    if (peerId) {
      const peer = await User.findById(peerId).select("_id username").lean();
      if (peer) {
        emitToUser(io, String(peer._id), peer.username, "message:seen", payload);
        emitToUser(io, String(peer._id), peer.username, "inbox:refresh", { reason: "read" });
      }
    }
    emitToUser(io, String(currentUser._id), currentUser.username, "inbox:refresh", { reason: "read" });
  }

  return { ok: true, seenAt: now };
}

async function getUnreadSummary({ currentUser }) {
  const rows = await ConversationMember.find({ userId: String(currentUser._id), unreadCount: { $gt: 0 } }).lean();
  return {
    totalUnreadMessages: rows.reduce((sum, row) => sum + Number(row.unreadCount || 0), 0),
    totalUnreadConversations: rows.length,
  };
}

async function getConversationSettings({ currentUser, conversationId }) {
  const conversation = await getConversationOrThrow({ currentUser, conversationId });
  const peerId = conversation.memberIds.find((id) => String(id) !== String(currentUser._id));
  const [member, peer] = await Promise.all([
    ConversationMember.findOne({ conversationId: String(conversation._id), userId: String(currentUser._id) }).lean(),
    User.findById(peerId).select("_id username avatarUrl bio").lean(),
  ]);

  return {
    conversationId: String(conversation._id),
    nickname: member?.peerNickname || "",
    isBlocked: Boolean(member?.blockedPeer),
    blockedAt: member?.blockedAt || null,
    peer: peer
      ? {
          id: String(peer._id),
          username: peer.username,
          avatarUrl: peer.avatarUrl || "",
          bio: peer.bio || "",
        }
      : null,
  };
}

async function updateConversationSettings({ currentUser, conversationId, nickname, isBlocked }) {
  const conversation = await getConversationOrThrow({ currentUser, conversationId });
  const update = { username: currentUser.username };
  if (typeof nickname !== "undefined") {
    update.peerNickname = String(nickname || "").trim().slice(0, 80);
  }
  if (typeof isBlocked === "boolean") {
    update.blockedPeer = isBlocked;
    update.blockedAt = isBlocked ? new Date() : null;
  }
  await ConversationMember.updateOne(
    { conversationId: String(conversation._id), userId: String(currentUser._id) },
    { $set: update },
    { upsert: true },
  );
  return getConversationSettings({ currentUser, conversationId });
}

function collectPossibleMediaPaths(messageDoc) {
  const values = [
    messageDoc?.mediaUrl,
    messageDoc?.fileUrl,
    messageDoc?.thumbnailUrl,
    messageDoc?.imageUrl,
    messageDoc?.videoUrl,
    messageDoc?.storyReply?.mediaUrl,
    messageDoc?.storyReply?.thumbnailUrl,
    ...(Array.isArray(messageDoc?.mediaItems)
      ? messageDoc.mediaItems.flatMap((item) => [item?.mediaUrl, item?.thumbnailUrl])
      : []),
  ].filter(Boolean);
  return values.map((v) => String(v));
}

function resolveLocalPath(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/\\/g, "/").trim();
  if (!clean) return null;
  if (/^data:/i.test(clean) || /^blob:/i.test(clean)) return null;

  let normalized = clean;
  if (/^https?:\/\//i.test(normalized)) {
    try {
      normalized = new URL(normalized).pathname || "";
    } catch (_err) {
      return null;
    }
  }

  const uploadsIndex = normalized.toLowerCase().indexOf("/uploads/");
  const relative = uploadsIndex >= 0 ? normalized.slice(uploadsIndex + 1) : normalized.replace(/^\/+/, "");
  const uploadsRoot = path.resolve(process.cwd(), "public", "uploads");
  const candidate = path.resolve(uploadsRoot, relative.replace(/^uploads\//, ""));
  if (!candidate.toLowerCase().startsWith(uploadsRoot.toLowerCase())) return null;
  return candidate;
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (_err) {}
}

async function clearConversationHistory({ currentUser, conversationId }) {
  const conversation = await getConversationOrThrow({ currentUser, conversationId });
  const messages = await Message.find({ conversationId: String(conversation._id) }).lean();
  const messageIds = messages.map((message) => String(message._id)).filter(Boolean);
  const files = new Set();
  messages.forEach((message) => {
    collectPossibleMediaPaths(message).forEach((p) => {
      const resolved = resolveLocalPath(p);
      if (resolved) files.add(resolved);
    });
  });

  await Message.deleteMany({ conversationId: String(conversation._id) });
  if (messageIds.length) {
    await Notification.deleteMany({
      type: "message",
      targetType: "conversation",
      targetId: { $in: messageIds },
    }).catch(() => {});
  }
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessageText: "",
        lastMessageAt: null,
        lastMessageSenderId: "",
      },
    },
  );
  await ConversationMember.updateMany(
    { conversationId: String(conversation._id) },
    {
      $set: {
        unreadCount: 0,
        lastReadMessageId: "",
      },
    },
  );
  await Promise.all(Array.from(files).map((p) => safeUnlink(p)));

  const io = getSocketIOOrNull();
  if (io) {
    io.to(`conversation:${conversation._id}`).emit("conversation:history-cleared", {
      conversationId: String(conversation._id),
      clearedBy: String(currentUser._id),
    });
    await emitConversationSnapshot(io, String(conversation._id), conversation.memberUsernames || []);
  }

  return { ok: true };
}

module.exports = {
  resolveCurrentUserFromReq,
  searchUsers,
  getOrCreateDirectConversation,
  listConversations,
  getConversationDetail,
  listMessages,
  sendMessage,
  setMessageReaction,
  toggleMessageHeart,
  markConversationRead,
  getUnreadSummary,
  getConversationSettings,
  updateConversationSettings,
  clearConversationHistory,
  deleteMessage,
};

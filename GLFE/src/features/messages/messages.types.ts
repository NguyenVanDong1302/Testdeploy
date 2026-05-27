export type MessageUser = {
  id: string
  username: string
  email?: string
  bio?: string
  avatarUrl?: string
}

export type ConversationItem = {
  id: string
  type: 'direct'
  peer: MessageUser
  lastMessageText: string
  lastMessageAt?: string | null
  unreadCount: number
  nickname?: string
  isBlocked?: boolean
  blockedAt?: string | null
}

export type ChatMessageMediaItem = {
  type: 'image' | 'video'
  mediaUrl: string
  thumbnailUrl?: string
  fileName?: string
  mimeType?: string
  durationSec?: number
}

export type ChatMessageReaction = {
  userId: string
  username?: string
  emoji: string
}

export type ChatMessageReactionSummary = {
  emoji: string
  count: number
}

export type ChatMessage = {
  id: string
  conversationId: string
  senderId: string
  senderUsername: string
  receiverId: string
  receiverUsername: string
  type: 'text' | 'image' | 'video'
  text: string
  mediaUrl?: string
  thumbnailUrl?: string
  fileName?: string
  mimeType?: string
  durationSec?: number
  mediaItems?: ChatMessageMediaItem[]
  reactions?: ChatMessageReaction[]
  reactionSummary?: ChatMessageReactionSummary[]
  reactionCount?: number
  myReaction?: string
  heartCount?: number
  heartedByMe?: boolean
  replyToMessageId?: string
  replyToText?: string
  replyToSenderUsername?: string
  replyToType?: '' | 'text' | 'image' | 'video'
  replyToMediaUrl?: string
  status: 'sent' | 'delivered' | 'seen'
  seenAt?: string | null
  createdAt: string
  optimistic?: boolean
}

export type DeletedMessageEvent = {
  conversationId: string
  messageId: string
  deletedBy?: string
  lastMessageText?: string
  lastMessageAt?: string | null
}

export type ConversationMessagesPageInfo = {
  hasMore: boolean
  nextBeforeMessageId?: string
  limit?: number
}

export type ConversationMessagesPage = {
  items: ChatMessage[]
  pageInfo: ConversationMessagesPageInfo
}

export type SearchUsersResponse = {
  following: MessageUser[]
  suggested: MessageUser[]
}

export type ConversationSettings = {
  conversationId: string
  nickname: string
  isBlocked: boolean
  blockedAt?: string | null
  peer: MessageUser | null
}

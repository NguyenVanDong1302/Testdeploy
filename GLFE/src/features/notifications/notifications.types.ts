export type NotificationItem = {
  _id: string
  recipientId: string
  type: 'like' | 'comment' | 'follow' | 'message' | 'moderation' | string
  targetType: 'post' | 'user' | 'conversation' | 'story' | 'moderation' | string
  targetId: string
  postId: string
  actors?: string[]
  actorUsernames?: string[]
  totalEvents?: number
  previewText?: string
  isRead: boolean
  readAt?: string | null
  lastEventAt?: string
  createdAt?: string
  updatedAt?: string
}

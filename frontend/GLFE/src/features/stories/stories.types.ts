export type StoryItem = {
  id: string
  authorId: string
  authorUsername: string
  mediaType: 'image' | 'video'
  mediaUrl: string
  thumbnailUrl?: string
  caption?: string
  likesCount: number
  likedByMe: boolean
  viewersCount: number
  viewedByMe: boolean
  createdAt: string
  expiresAt: string
  archivedAt?: string | null
  isArchived?: boolean
}

export type StoryViewerUser = {
  userId: string
  username: string
  avatarUrl?: string
  viewedAt?: string | null
}

export type StoryGroup = {
  id: string
  authorId: string
  username: string
  avatarUrl?: string
  hasUnseen?: boolean
  latestCreatedAt?: string
  stories: StoryItem[]
}

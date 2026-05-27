export type PostVisibility = 'public' | 'friends' | 'private'

export type CreatePostPayload = {
  content?: string
  visibility?: PostVisibility
  isAnonymous?: boolean
  allowComments?: boolean
  hideLikeCount?: boolean
  location?: string
  collaborators?: string[]
  tags?: string[]
  altText?: string
  files?: File[]
}

export type CreatePostResponse = {
  ok: boolean
  message?: string
  data: {
    postId?: string
    pendingModeration?: boolean
    moderationStatus?: 'normal' | 'reported' | 'pending_review' | 'violating' | string
    moderationDeadlineAt?: string | null
    maxModerationProcessingMs?: number
    autoRemoved?: boolean
    reason?: string
    reportId?: string
    requestSentToAdmin?: boolean
    warningSentToUser?: boolean
    detectionSignals?: string[]
    detectionSource?: string
    detectionScore?: number
    detectionThreshold?: number
    [key: string]: unknown
  }
}

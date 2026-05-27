import { useMemo } from 'react'
import { useApi } from '../../lib/api'

export type AccountMonthlyStat = {
  month: string
  newAccounts: number
  loginCount: number
}

export type UserRestrictions = {
  commentBlocked: boolean
  messagingBlocked: boolean
  likeBlocked: boolean
  dailyPostLimit: number
}

export type ReportResolutionAction = 'no_violation' | 'delete_post' | 'strike_account' | 'lock_account'

export type AccountStatsResponse = {
  summary: {
    totalAccounts: number
    totalLogins: number
    activeLast30Days: number
  }
  monthly: AccountMonthlyStat[]
  topLoginUsers: Array<{
    id: string
    username: string
    role: 'user' | 'admin' | string
    loginCount: number
    lastLoginAt?: string | null
  }>
}

export type AdminAccountRow = {
  id: string
  username: string
  email: string
  role: string
  moderationStatus: string
  moderationReason: string
  isVerified: boolean
  verifiedAt?: string | null
  verifiedBy?: string
  strikesCount: number
  accountLocked: boolean
  accountLockedAt?: string | null
  accountLockedReason?: string
  restrictions: UserRestrictions
  loginCount: number
  lastLoginAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type PaginatedAdminAccounts = {
  items: AdminAccountRow[]
  page: number
  limit: number
  total: number
  totalPages: number
  filters?: {
    keyword?: string
    status?: 'all' | 'active' | 'locked' | string
  }
}

export type AdminPostRow = {
  id: string
  title: string
  fullTitle?: string
  thumbnailUrl?: string
  mediaType?: 'image' | 'video' | 'text' | string
  authorUsername: string
  createdAt?: string | null
  likesCount: number
  commentsCount: number
  engagementCount: number
  reportCount?: number
  allowComments?: boolean
  pendingCount?: number
  latestReason?: string
  lastReportedAt?: string | null
  statuses?: string[]
  moderationStatus?: string
  moderationReason?: string
  postExists?: boolean
  reportSource?: 'user_report' | 'auto_nsfw' | string
  autoModeratedAt?: string | null
}

export type AdminPostDetail = {
  post: {
    id: string
    title: string
    fullTitle?: string
    content?: string
    thumbnailUrl?: string
    mediaType?: 'image' | 'video' | 'text' | string
    media?: Array<{
      type?: 'image' | 'video' | string
      url?: string
      thumbnailUrl?: string
    }>
    imageUrl?: string
    authorId?: string
    authorUsername: string
    createdAt?: string | null
    updatedAt?: string | null
    likesCount: number
    commentsCount: number
    engagementCount: number
    reportCount: number
    lastReportedAt?: string | null
    allowComments: boolean
    moderationStatus?: string
    moderationReason?: string
    postPath?: string
    postExists?: boolean
    reportSource?: 'user_report' | 'auto_nsfw' | string
    autoModeratedAt?: string | null
  }
  reports: Array<{
    id: string
    reporterId?: string
    reporterUsername: string
    reason: string
    status: 'pending' | 'reviewed' | 'accepted' | 'rejected' | string
    reviewedBy?: string
    reviewedAt?: string | null
    createdAt?: string | null
    source?: 'user_report' | 'auto_nsfw' | string
    detectionSignals?: string[]
    autoModeratedAt?: string | null
    hasSnapshot?: boolean
  }>
}

export type PaginatedAdminPosts = {
  items: AdminPostRow[]
  page: number
  limit: number
  total: number
  totalPages: number
  filters?: {
    startDate?: string
    endDate?: string
    sort?: 'engagement_desc' | 'engagement_asc' | string
    status?: string
    source?: 'all' | 'user_report' | 'auto_nsfw' | string
  }
}

export type AdminViolationsResponse = {
  summary: {
    violatingAccounts: number
    violatingPosts: number
  }
  accounts: AdminAccountRow[]
  posts: Array<{
    id: string
    title: string
    thumbnailUrl?: string
    mediaType?: string
    authorUsername: string
    moderationStatus: string
    moderationReason: string
    reportCount: number
    likesCount: number
    commentsCount: number
    engagementCount: number
    createdAt?: string | null
    updatedAt?: string | null
  }>
}

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    query.set(key, String(value))
  })
  const raw = query.toString()
  return raw ? `?${raw}` : ''
}

export function useAdminApi() {
  const api = useApi()

  return useMemo(
    () => ({
      getAccountStats: async (months = 12) => {
        const res = await api.get(`/admin/accounts/stats${buildQuery({ months })}`)
        return res?.data as AccountStatsResponse
      },
      getAccounts: async (params?: {
        page?: number
        limit?: number
        keyword?: string
        status?: 'all' | 'active' | 'locked'
      }) => {
        const res = await api.get(`/admin/accounts${buildQuery(params || {})}`)
        return res?.data as PaginatedAdminAccounts
      },
      getPosts: async (params: {
        page?: number
        limit?: number
        startDate?: string
        endDate?: string
        sort?: 'engagement_desc' | 'engagement_asc'
      }) => {
        const res = await api.get(`/admin/posts${buildQuery(params || {})}`)
        return res?.data as PaginatedAdminPosts
      },
      getReportedPosts: async (params: {
        page?: number
        limit?: number
        startDate?: string
        endDate?: string
        status?: 'all' | 'pending' | 'reviewed' | 'accepted' | 'rejected'
        source?: 'all' | 'user_report' | 'auto_nsfw'
      }) => {
        const res = await api.get(`/admin/reports/posts${buildQuery(params || {})}`)
        return res?.data as PaginatedAdminPosts
      },
      getViolations: async (includeWarning = true) => {
        const res = await api.get(`/admin/violations${buildQuery({ includeWarning })}`)
        return res?.data as AdminViolationsResponse
      },
      getPostDetail: async (postId: string) => {
        const res = await api.get(`/admin/posts/${encodeURIComponent(postId)}`)
        return res?.data as AdminPostDetail
      },
      applyPostAction: async (
        postId: string,
        payload: {
          action: 'delete_post' | 'lock_comments' | 'unlock_comments'
          reason?: string
          notification?: string
        },
      ) => {
        const res = await api.patch(`/admin/posts/${encodeURIComponent(postId)}/actions`, payload)
        return res?.data
      },
      resolveReportedPost: async (
        postId: string,
        payload: {
          actions: ReportResolutionAction[]
          reason?: string
          decision?: ReportResolutionAction
        },
      ) => {
        const res = await api.post(`/admin/reports/posts/${encodeURIComponent(postId)}/resolve`, payload)
        return res?.data
      },
      updatePostModeration: async (postId: string, payload: { status: 'normal' | 'reported' | 'pending_review' | 'violating'; reason?: string }) => {
        const res = await api.patch(`/admin/posts/${encodeURIComponent(postId)}/moderation`, payload)
        return res?.data
      },
      updateUserModeration: async (userId: string, payload: { status: 'normal' | 'warning' | 'violating'; reason?: string }) => {
        const res = await api.patch(`/admin/users/${encodeURIComponent(userId)}/moderation`, payload)
        return res?.data
      },
      updateUserRestrictions: async (
        userId: string,
        payload: {
          commentBlocked?: boolean
          messagingBlocked?: boolean
          likeBlocked?: boolean
          verified?: boolean
          dailyPostLimit?: number | null
          accountLocked?: boolean
          lockReason?: string
        },
      ) => {
        const res = await api.patch(`/admin/users/${encodeURIComponent(userId)}/restrictions`, payload)
        return res?.data as AdminAccountRow
      },
    }),
    [api],
  )
}

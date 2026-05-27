import { useMemo } from 'react'
import { useApi } from '../../lib/api'

export type UserSummary = {
  _id: string
  id: string
  username: string
  email?: string
  fullName?: string
  website?: string
  bio?: string
  gender?: string
  showThreadsBadge?: boolean
  showSuggestedAccountsOnProfile?: boolean
  isPrivateAccount?: boolean
  showActivityStatus?: boolean
  isVerified?: boolean
  avatarUrl?: string
  createdAt?: string | null
}

export type UserRelationship = {
  isMe: boolean
  isFollowing: boolean
  isFollowedBy: boolean
}

export type UserProfile = UserSummary & {
  counts: {
    followers: number
    following: number
  }
  relationship: UserRelationship
}

export type UpdateMyProfilePayload = {
  fullName?: string
  website?: string
  bio?: string
  gender?: string
  avatarUrl?: string
  avatarFile?: File | null
  showThreadsBadge?: boolean
  showSuggestedAccountsOnProfile?: boolean
  isPrivateAccount?: boolean
  showActivityStatus?: boolean
}

export function useUsersApi() {
  const api = useApi()

  return useMemo(
    () => ({
      getAllUsers: async () => {
        const res = await api.get('/users')
        return (res?.data || []) as UserSummary[]
      },
      getProfile: async (username: string) => {
        const res = await api.get(`/users/${encodeURIComponent(username)}`)
        return res?.data as UserProfile
      },
      getFollowers: async (username: string) => {
        const res = await api.get(`/users/${encodeURIComponent(username)}/followers`)
        return (res?.data || []) as UserSummary[]
      },
      getFollowing: async (username: string) => {
        const res = await api.get(`/users/${encodeURIComponent(username)}/following`)
        return (res?.data || []) as UserSummary[]
      },
      followUser: async (payload: { followingId?: string; username?: string }) => {
        const res = await api.post('/users/follow', payload)
        return res?.data as {
          targetUser: UserSummary
          counts: { followers: number; following: number }
          relationship: UserRelationship
        }
      },

      updateMyProfile: async (payload: UpdateMyProfilePayload) => {
        const formData = new FormData()

        if (payload.fullName !== undefined) formData.append('fullName', payload.fullName)
        if (payload.website !== undefined) formData.append('website', payload.website)
        if (payload.bio !== undefined) formData.append('bio', payload.bio)
        if (payload.gender !== undefined) formData.append('gender', payload.gender)
        if (payload.avatarUrl !== undefined) formData.append('avatarUrl', payload.avatarUrl)
        if (payload.showThreadsBadge !== undefined) formData.append('showThreadsBadge', String(Boolean(payload.showThreadsBadge)))
        if (payload.showSuggestedAccountsOnProfile !== undefined) {
          formData.append('showSuggestedAccountsOnProfile', String(Boolean(payload.showSuggestedAccountsOnProfile)))
        }
        if (payload.isPrivateAccount !== undefined) formData.append('isPrivateAccount', String(Boolean(payload.isPrivateAccount)))
        if (payload.showActivityStatus !== undefined) formData.append('showActivityStatus', String(Boolean(payload.showActivityStatus)))
        if (payload.avatarFile) formData.append('avatar', payload.avatarFile)

        const res = await api.patchForm('/users/me/profile', formData)
        return res?.data as UserProfile
      },

      changeMyPassword: async (payload: {
        currentPassword: string
        newPassword: string
        confirmPassword?: string
      }) => {
        const res = await api.patch('/users/me/password', payload)
        return res?.data as Record<string, never>
      },

      changeMyUsername: async (payload: { username: string }) => {
        const res = await api.patch('/users/me/username', payload)
        return res?.data as UserProfile
      },

      unfollowUser: async (payload: { followingId?: string; username?: string }) => {
        const res = await api.del('/users/follow', payload)
        return res?.data as {
          targetUser: UserSummary
          counts: { followers: number; following: number }
          relationship: UserRelationship
        }
      },
    }),
    [api],
  )
}


import { useMemo } from 'react'
import { useApi } from '../../lib/api'
import type { StoryGroup, StoryItem, StoryViewerUser } from './stories.types'

export function useStoriesApi() {
  const api = useApi()
  return useMemo(() => ({
    async list(): Promise<StoryGroup[]> {
      const res = await api.get('/stories')
      return (res?.data?.items || []) as StoryGroup[]
    },
    async listArchive(): Promise<StoryItem[]> {
      const res = await api.get('/stories/archive')
      return (res?.data?.items || []) as StoryItem[]
    },
    async create(media: File, caption = ''): Promise<StoryItem> {
      const form = new FormData()
      form.append('media', media)
      if (caption) form.append('caption', caption)
      const res = await api.postForm('/stories', form)
      return res?.data?.item as StoryItem
    },
    async markViewed(storyId: string): Promise<{ storyId: string; viewedByMe: boolean; viewersCount: number }> {
      const res = await api.post(`/stories/${storyId}/view`, {})
      return res?.data || { storyId, viewedByMe: true, viewersCount: 0 }
    },
    async getViewers(storyId: string): Promise<{ count: number; items: StoryViewerUser[] }> {
      const res = await api.get(`/stories/${storyId}/viewers`)
      return res?.data || { count: 0, items: [] }
    },
    async toggleLike(storyId: string): Promise<{ liked: boolean; likesCount: number }> {
      const res = await api.post(`/stories/${storyId}/like`, {})
      return res?.data || { liked: false, likesCount: 0 }
    },
    async hide(storyId: string): Promise<{ hiddenAuthorId?: string }> {
      const res = await api.post(`/stories/${storyId}/hide`, {})
      return res?.data || {}
    },
    async remove(storyId: string): Promise<{ removedId?: string }> {
      const res = await api.del(`/stories/${storyId}`)
      return res?.data || {}
    },
  }), [api])
}

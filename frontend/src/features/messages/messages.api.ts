import { useMemo } from 'react'
import { useApi } from '../../lib/api'
import type {
  ChatMessage,
  ConversationItem,
  ConversationMessagesPage,
  ConversationSettings,
  SearchUsersResponse,
} from './messages.types'

export function useMessagesApi() {
  const api = useApi()

  return useMemo(
    () => ({
      searchUsers: async (q: string) => {
        const res = await api.get(`/messages/search-users?q=${encodeURIComponent(q)}`)
        return (res?.data || { following: [], suggested: [] }) as SearchUsersResponse
      },
      getConversations: async () => {
        const res = await api.get('/messages/conversations')
        return (res?.data?.items || []) as ConversationItem[]
      },
      getConversation: async (conversationId: string) => {
        const res = await api.get(`/messages/conversations/${conversationId}`)
        return res?.data as ConversationItem
      },
      getMessages: async (
        conversationId: string,
        options?: { limit?: number; beforeMessageId?: string },
      ) => {
        const query = new URLSearchParams()
        if (options?.limit) query.set('limit', String(options.limit))
        if (options?.beforeMessageId) query.set('beforeMessageId', options.beforeMessageId)
        const suffix = query.toString() ? `?${query.toString()}` : ''
        const res = await api.get(`/messages/conversations/${conversationId}/messages${suffix}`)
        return {
          items: (res?.data?.items || []) as ChatMessage[],
          pageInfo: {
            hasMore: Boolean(res?.data?.pageInfo?.hasMore),
            nextBeforeMessageId: String(res?.data?.pageInfo?.nextBeforeMessageId || ''),
            limit: Number(res?.data?.pageInfo?.limit || options?.limit || 50),
          },
        } as ConversationMessagesPage
      },
      createDirectConversation: async (payload: string | { targetUserId?: string; username?: string }) => {
        const body = typeof payload === 'string' ? { targetUserId: payload } : payload
        const res = await api.post('/messages/conversations/direct', body)
        return res?.data?.conversation as ConversationItem
      },
      sendMessageHttp: async (
        conversationId: string,
        payload: { text?: string; media?: File[] | null; replyToMessageId?: string | null },
      ) => {
        const body = new FormData()
        if (payload.text) body.append('text', payload.text)
        if (payload.replyToMessageId) body.append('replyToMessageId', payload.replyToMessageId)
        for (const file of payload.media || []) body.append('media', file)
        const res = await api.postForm(`/messages/conversations/${conversationId}/messages`, body)
        return res?.data?.message as ChatMessage
      },
      toggleMessageHeart: async (conversationId: string, messageId: string, shouldLike: boolean) => {
        const res = shouldLike
          ? await api.post(`/messages/conversations/${conversationId}/messages/${messageId}/heart`, {})
          : await api.del(`/messages/conversations/${conversationId}/messages/${messageId}/heart`)
        return res?.data?.message as ChatMessage
      },
      setMessageReaction: async (conversationId: string, messageId: string, emoji: string) => {
        const res = await api.post(`/messages/conversations/${conversationId}/messages/${messageId}/reaction`, { emoji })
        return res?.data?.message as ChatMessage
      },
      removeMessageReaction: async (conversationId: string, messageId: string) => {
        const res = await api.del(`/messages/conversations/${conversationId}/messages/${messageId}/reaction`)
        return res?.data?.message as ChatMessage
      },
      deleteMessage: async (conversationId: string, messageId: string) => {
        const res = await api.del(`/messages/conversations/${conversationId}/messages/${messageId}`)
        return res?.data as { conversationId: string; messageId: string; lastMessageText?: string; lastMessageAt?: string | null }
      },
      markRead: async (conversationId: string) => {
        await api.post(`/messages/conversations/${conversationId}/read`, {})
      },
      unreadSummary: async () => {
        const res = await api.get('/messages/unread-summary')
        return res?.data || { totalUnreadMessages: 0, totalUnreadConversations: 0 }
      },
      getSettings: async (conversationId: string) => {
        const res = await api.get(`/messages/conversations/${conversationId}/settings`)
        return res?.data as ConversationSettings
      },
      updateSettings: async (conversationId: string, payload: Partial<ConversationSettings>) => {
        const res = await api.patch(`/messages/conversations/${conversationId}/settings`, payload)
        return res?.data as ConversationSettings
      },
      clearHistory: async (conversationId: string) => {
        const res = await api.del(`/messages/conversations/${conversationId}/history`)
        return res?.data
      },
    }),
    [api],
  )
}

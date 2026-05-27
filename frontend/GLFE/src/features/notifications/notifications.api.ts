import { useMemo } from 'react'
import { useApi } from '../../lib/api'
import type { NotificationItem } from './notifications.types'

export function useNotificationsApi() {
  const api = useApi()

  return useMemo(
    () => ({
      async list(onlyUnread = false): Promise<{ items: NotificationItem[]; unreadCount: number }> {
        const res = await api.get(`/notifications${onlyUnread ? '?onlyUnread=true' : ''}`)
        return res?.data || { items: [], unreadCount: 0 }
      },
      async read(id: string): Promise<NotificationItem> {
        const res = await api.patch(`/notifications/${id}/read`, {})
        return res?.data
      },
      async unread(id: string): Promise<NotificationItem> {
        const res = await api.patch(`/notifications/${id}/unread`, {})
        return res?.data
      },
      async readAll(): Promise<{ unreadCount: number }> {
        const res = await api.patch('/notifications/read-all', {})
        return res?.data || { unreadCount: 0 }
      },
    }),
    [api],
  )
}

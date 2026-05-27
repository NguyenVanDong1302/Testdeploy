import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNotificationsApi } from './notifications.api'
import type { NotificationItem } from './notifications.types'
import { useSocket } from '../../state/socket'
import { useAppStore } from '../../state/store'

type NotificationCtxValue = {
  items: NotificationItem[]
  unreadCount: number
  loading: boolean
  refresh: (onlyUnread?: boolean) => Promise<void>
  markRead: (id: string) => Promise<void>
  markUnread: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const NotificationCtx = createContext<NotificationCtxValue | null>(null)

function isNotificationFeedItem(item?: Partial<NotificationItem> | null) {
  const type = String(item?.type || '')
  const targetType = String(item?.targetType || '')
  if (type === 'follow') return true
  return (type === 'like' || type === 'comment') && (targetType === 'post' || Boolean(item?.postId))
}

function filterNotificationFeedItems(items: NotificationItem[]) {
  return items.filter((item) => isNotificationFeedItem(item))
}

function mergeItems(prev: NotificationItem[], incoming: NotificationItem) {
  const next = [incoming, ...prev.filter((item) => item._id !== incoming._id)]
  next.sort(
    (a, b) =>
      new Date(b.lastEventAt || b.createdAt || 0).getTime() -
      new Date(a.lastEventAt || a.createdAt || 0).getTime(),
  )
  return next
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const api = useNotificationsApi()
  const { socket } = useSocket()
  const { state } = useAppStore()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const refreshTimerRef = useRef<number | null>(null)

  const refresh = useCallback(
    async (onlyUnread = false) => {
      setLoading(true)
      try {
        const data = await api.list(onlyUnread)
        const nextItems = filterNotificationFeedItems(Array.isArray(data.items) ? data.items : [])
        const serverUnreadCount = Number(data.unreadCount)
        setItems(nextItems)
        setUnreadCount(Number.isFinite(serverUnreadCount) ? serverUnreadCount : nextItems.filter((item) => !item.isRead).length)
      } finally {
        setLoading(false)
      }
    },
    [api],
  )

  const scheduleRefresh = useCallback(
    (onlyUnread = false, delay = 120) => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => {
        refresh(onlyUnread).catch(() => undefined)
      }, delay)
    },
    [refresh],
  )

  useEffect(() => {
    if (!state.username) return
    refresh().catch(() => undefined)
  }, [refresh, state.username])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!socket) return

    const onNew = (payload: NotificationItem) => {
      if (!isNotificationFeedItem(payload)) return
      if (!payload?._id) {
        scheduleRefresh(false, 0)
        return
      }
      setItems((prev) => {
        const existed = prev.find((item) => item._id === payload._id)
        setUnreadCount((count) => {
          if (!payload.isRead && (!existed || existed.isRead)) return count + 1
          if (payload.isRead && existed && !existed.isRead) return Math.max(0, count - 1)
          return count
        })
        return mergeItems(prev, payload)
      })
    }

    const onCount = () => {
      scheduleRefresh(false, 0)
    }

    const onNotify = (payload: Partial<NotificationItem> = {}) => {
      if (!isNotificationFeedItem(payload)) return
      scheduleRefresh(false, 0)
    }

    const onReconnect = () => {
      scheduleRefresh(false, 0)
    }

    socket.on('notification:new', onNew)
    socket.on('notification:count', onCount)
    socket.on('notify', onNotify)
    socket.on('connect', onReconnect)

    return () => {
      socket.off('notification:new', onNew)
      socket.off('notification:count', onCount)
      socket.off('notify', onNotify)
      socket.off('connect', onReconnect)
    }
  }, [socket, scheduleRefresh])

  const markRead = useCallback(
    async (id: string) => {
      const item = await api.read(id)
      setItems((prev) => prev.map((entry) => (entry._id === id ? item : entry)))
      setUnreadCount((count) => Math.max(0, count - 1))
    },
    [api],
  )

  const markUnread = useCallback(
    async (id: string) => {
      const item = await api.unread(id)
      setItems((prev) => prev.map((entry) => (entry._id === id ? item : entry)))
      setUnreadCount((count) => count + 1)
    },
    [api],
  )

  const markAllRead = useCallback(async () => {
    await api.readAll()
    const now = new Date().toISOString()
    setItems((prev) => prev.map((item) => ({ ...item, isRead: true, readAt: now })))
    setUnreadCount(0)
  }, [api])

  const value = useMemo(
    () => ({ items, unreadCount, loading, refresh, markRead, markUnread, markAllRead }),
    [items, unreadCount, loading, refresh, markRead, markUnread, markAllRead],
  )

  return <NotificationCtx.Provider value={value}>{children}</NotificationCtx.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationCtx)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}

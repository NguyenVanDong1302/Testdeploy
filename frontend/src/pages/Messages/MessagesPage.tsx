import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../../state/store'
import { useSocket } from '../../state/socket'
import { useMessagesApi } from '../../features/messages/messages.api'
import { joinConversation, leaveConversation, markConversationReadRealtime, sendRealtimeMessage } from '../../features/messages/messages.socket'
import type {
  ChatMessage,
  ChatMessageMediaItem,
  ConversationItem,
  ConversationMessagesPageInfo,
  ConversationSettings,
  DeletedMessageEvent,
  MessageUser,
  SearchUsersResponse,
} from '../../features/messages/messages.types'
import { useCalls } from '../../features/calls/CallsProvider'
import { resolveMediaUrl } from '../../lib/api'
import './Messages.scss'
import '../../styles/messages-desktop.css'
import '../../styles/messages-tablet.css'
import '../../styles/messages-mobile.css'

const TIME_SEPARATOR_MS = 10 * 60 * 1000
const MAX_MESSAGE_MEDIA_FILES = 10
const MAX_MESSAGE_VIDEO_BYTES = 15 * 1024 * 1024
const MESSAGE_REACTIONS = ['\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F621}', '\u{1F44D}'] as const
const COMPACT_MESSAGES_QUERY = '(max-width: 1024px)'

type PendingMediaItem = {
  id: string
  file: File
  previewUrl: string
  type: 'image' | 'video'
}

type MessagesRouteState = {
  conversationId?: string
  directUser?: MessageUser
}

const MESSAGES_CACHE_TTL_MS = 30 * 1000

const messagesPageCache: {
  viewerUsername: string
  hasConversationList: boolean
  conversationListFetchedAt: number
  conversations: ConversationItem[]
  activeId: string
  messagesByConversation: Record<string, ChatMessage[]>
  messagePageInfoByConversation: Record<string, ConversationMessagesPageInfo>
  settingsByConversation: Record<string, ConversationSettings>
  loadedMessagesByConversation: Record<string, boolean>
  messageFetchedAtByConversation: Record<string, number>
  mutedConversationIds: Record<string, boolean>
} = {
  viewerUsername: '',
  hasConversationList: false,
  conversationListFetchedAt: 0,
  conversations: [],
  activeId: '',
  messagesByConversation: {},
  messagePageInfoByConversation: {},
  settingsByConversation: {},
  loadedMessagesByConversation: {},
  messageFetchedAtByConversation: {},
  mutedConversationIds: {},
}

function resetMessagesPageCache() {
  messagesPageCache.hasConversationList = false
  messagesPageCache.conversationListFetchedAt = 0
  messagesPageCache.conversations = []
  messagesPageCache.activeId = ''
  messagesPageCache.messagesByConversation = {}
  messagesPageCache.messagePageInfoByConversation = {}
  messagesPageCache.settingsByConversation = {}
  messagesPageCache.loadedMessagesByConversation = {}
  messagesPageCache.messageFetchedAtByConversation = {}
  messagesPageCache.mutedConversationIds = {}
}

function touchConversationListCache() {
  messagesPageCache.hasConversationList = true
  messagesPageCache.conversationListFetchedAt = Date.now()
}

function touchMessageCache(conversationId: string) {
  if (!conversationId) return
  messagesPageCache.messageFetchedAtByConversation[conversationId] = Date.now()
}

function isFreshMessageCache(conversationId: string) {
  const fetchedAt = messagesPageCache.messageFetchedAtByConversation[conversationId] || 0
  return fetchedAt > 0 && Date.now() - fetchedAt < MESSAGES_CACHE_TTL_MS
}

function buildConversationSettings(item: ConversationItem): ConversationSettings {
  return {
    conversationId: item.id,
    nickname: item.nickname || '',
    isBlocked: Boolean(item.isBlocked),
    blockedAt: item.blockedAt || null,
    peer: item.peer,
  }
}

function formatTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function formatConversationTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

function sortConversationsByLastMessage(items: ConversationItem[]) {
  return [...items].sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime())
}

function avatarOf(user?: Pick<MessageUser, 'avatarUrl' | 'username'> | null) {
  const resolved = resolveMediaUrl(user?.avatarUrl)
  if (resolved) return resolved
  const seed = encodeURIComponent(user?.username || 'instagram_user')
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${seed}`
}

function getCompactMessagesMatches() {
  if (typeof window === 'undefined') return false
  return window.matchMedia(COMPACT_MESSAGES_QUERY).matches
}

function shouldShowCenterTime(messages: ChatMessage[], index: number) {
  const current = messages[index]
  const previous = messages[index - 1]
  if (!current) return false
  if (!previous) return true
  const currentTs = new Date(current.createdAt).getTime()
  const previousTs = new Date(previous.createdAt).getTime()
  if (!Number.isFinite(currentTs) || !Number.isFinite(previousTs)) return false
  return currentTs - previousTs >= TIME_SEPARATOR_MS
}

function getMessageMediaItems(message: ChatMessage): ChatMessageMediaItem[] {
  if (Array.isArray(message.mediaItems) && message.mediaItems.length) {
    return message.mediaItems.filter((item) => Boolean(item?.mediaUrl))
  }
  if (!message.mediaUrl) return []
  return [{
    type: message.type === 'video' ? 'video' : 'image',
    mediaUrl: message.mediaUrl,
    thumbnailUrl: message.thumbnailUrl,
    fileName: message.fileName,
    mimeType: message.mimeType,
    durationSec: message.durationSec,
  }]
}

function getMessageReactionDisplay(message: ChatMessage) {
  const summary = message.reactionSummary || []
  if (!summary.length) return ''
  const emojis = summary.slice(0, 3).map((item) => item.emoji).join(' ')
  const count = Number(message.reactionCount || summary.reduce((total, item) => total + Number(item.count || 0), 0))
  return count > 1 ? `${emojis} ${count}` : emojis
}

function buildMessagePreview(message: ChatMessage) {
  const mediaItems = getMessageMediaItems(message)
  if (mediaItems.length === 1) return mediaItems[0].type === 'video' ? 'Đã gửi 1 video' : 'Đã gửi 1 ảnh'
  if (mediaItems.length > 1) {
    const videoCount = mediaItems.filter((item) => item.type === 'video').length
    const imageCount = mediaItems.length - videoCount
    if (videoCount === mediaItems.length) return `Đã gửi ${videoCount} video`
    if (imageCount === mediaItems.length) return `Đã gửi ${imageCount} ảnh`
    return `Đã gửi ${mediaItems.length} tệp`
  }
  return message.text
}

function isCallEventMessage(message: ChatMessage) {
  const text = String(message.text || '').trim()
  return message.type === 'text' && (text.startsWith('📞 ') || text.startsWith('📹 '))
}

function RichMessageMedia({ message }: { message: ChatMessage }) {
  const mediaItems = getMessageMediaItems(message)
  if (!mediaItems.length) return null

  if (mediaItems.length === 1) {
    const item = mediaItems[0]
    return item.type === 'video' ? (
      <video className="ig-msg__media" src={item.mediaUrl} controls playsInline />
    ) : (
      <img className="ig-msg__media" src={item.mediaUrl} alt={item.fileName || 'message media'} />
    )
  }

  return (
    <div className="ig-msg__mediaGrid">
      {mediaItems.map((item, index) => (
        item.type === 'video' ? (
          <video key={`${item.mediaUrl}-${index}`} className="ig-msg__mediaGridItem" src={item.mediaUrl} controls playsInline />
        ) : (
          <img key={`${item.mediaUrl}-${index}`} className="ig-msg__mediaGridItem" src={item.mediaUrl} alt={item.fileName || `message media ${index + 1}`} />
        )
      ))}
    </div>
  )
}

function CallEventMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="ig-msg__callEvent">
      <div className="ig-msg__callEventText">{message.text}</div>
      <div className="ig-msg__callEventTime">{formatTime(message.createdAt)}</div>
    </div>
  )
}

function PhoneCallIcon() {
  return (
    <svg className="ig-msg__callIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.2 3.6h3.1l1.1 4.2-2 1.8a15.5 15.5 0 0 0 5 5l1.8-2 4.2 1.1v3.1a1.8 1.8 0 0 1-1.8 1.8A15.8 15.8 0 0 1 3.6 5.4 1.8 1.8 0 0 1 5.4 3.6Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

function VideoCallIcon() {
  return (
    <svg className="ig-msg__callIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.8 7.2A2.4 2.4 0 0 1 7.2 4.8h7.6a2.4 2.4 0 0 1 2.4 2.4v9.6a2.4 2.4 0 0 1-2.4 2.4H7.2a2.4 2.4 0 0 1-2.4-2.4Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="m17.2 10 3-2v8l-3-2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

export default function MessagesPage() {
  const api = useMessagesApi()
  const location = useLocation()
  const navigate = useNavigate()
  const { state } = useAppStore()
  const { socket } = useSocket()
  const { activeCall, startCall, expandCallWindow } = useCalls()
  const currentViewer = String(state.username || '')
  if (messagesPageCache.viewerUsername && currentViewer && messagesPageCache.viewerUsername !== currentViewer) {
    resetMessagesPageCache()
  }
  messagesPageCache.viewerUsername = currentViewer
  const routeState = location.state as MessagesRouteState | null
  const routeConversationId = String(routeState?.conversationId || '')
  const initialActiveId = routeConversationId || messagesPageCache.activeId
  const [isCompactLayout, setIsCompactLayout] = useState(getCompactMessagesMatches)
  const [compactView, setCompactView] = useState<'inbox' | 'thread'>(() => (getCompactMessagesMatches() ? 'inbox' : 'thread'))
  const [loading, setLoading] = useState(() => !messagesPageCache.hasConversationList)
  const [sending, setSending] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [savingDetail, setSavingDetail] = useState(false)
  const [conversations, setConversations] = useState<ConversationItem[]>(() => messagesPageCache.conversations)
  const [activeId, setActiveId] = useState(initialActiveId)
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatMessage[]>>(() => messagesPageCache.messagesByConversation)
  const [messagePageInfoByConversation, setMessagePageInfoByConversation] = useState<Record<string, ConversationMessagesPageInfo>>(() => messagesPageCache.messagePageInfoByConversation)
  const [settingsByConversation, setSettingsByConversation] = useState<Record<string, ConversationSettings>>(() => messagesPageCache.settingsByConversation)
  const [mutedConversationIds, setMutedConversationIds] = useState<Record<string, boolean>>(() => messagesPageCache.mutedConversationIds)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchUsersResponse>({ following: [], suggested: [] })
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState(() => messagesPageCache.settingsByConversation[initialActiveId]?.nickname || '')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [hoveredMessageId, setHoveredMessageId] = useState('')
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState('')
  const [actionMenuMessageId, setActionMenuMessageId] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [mediaFiles, setMediaFiles] = useState<PendingMediaItem[]>([])
  const [isNicknameEditorOpen, setIsNicknameEditorOpen] = useState(false)
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingMediaRef = useRef<PendingMediaItem[]>([])
  const conversationsRef = useRef(conversations)
  const messagesByConversationRef = useRef(messagesByConversation)
  const settingsByConversationRef = useRef(settingsByConversation)
  const loadedMessagesRef = useRef<Record<string, boolean>>(messagesPageCache.loadedMessagesByConversation)

  const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId) || null, [conversations, activeId])
  const activeMessages = useMemo(() => messagesByConversation[activeId] || [], [messagesByConversation, activeId])
  const activeMessagePageInfo = useMemo(
    () => messagePageInfoByConversation[activeId] || { hasMore: false, nextBeforeMessageId: '' },
    [messagePageInfoByConversation, activeId],
  )
  const settings = useMemo(() => settingsByConversation[activeId] || null, [settingsByConversation, activeId])
  const displayPeerName = activeConversation?.nickname?.trim() || activeConversation?.peer.username || ''
  const isCurrentConversationInCall = Boolean(activeCall && activeConversation && activeCall.conversationId === activeConversation.id)
  const isAnotherConversationInCall = Boolean(activeCall && activeConversation && activeCall.conversationId !== activeConversation.id)
  const headerPeerSubtitle = isCurrentConversationInCall
    ? activeCall?.phase === 'incoming'
      ? 'Cuộc gọi đến'
      : activeCall?.phase === 'outgoing'
        ? 'Đang gọi...'
        : activeCall?.phase === 'connecting'
          ? 'Đang kết nối cuộc gọi'
          : 'Đang trong cuộc gọi'
    : activeConversation?.peer.bio || 'Người dùng T'
  const isBlocked = Boolean(settings?.isBlocked ?? activeConversation?.isBlocked)
  const isMuted = Boolean(mutedConversationIds[activeId])
  const shouldShowInbox = !isCompactLayout || compactView === 'inbox'
  const shouldShowThread = !isCompactLayout || compactView === 'thread'
  const shouldLoadActiveConversation = Boolean(activeId) && shouldShowThread

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const prevRootOverflow = root.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevBodyHeight = body.style.height
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.height = '100dvh'
    return () => {
      root.style.overflow = prevRootOverflow
      body.style.overflow = prevBodyOverflow
      body.style.height = prevBodyHeight
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const mediaQuery = window.matchMedia(COMPACT_MESSAGES_QUERY)
    const handleChange = (event?: MediaQueryListEvent) => {
      const nextMatches = event?.matches ?? mediaQuery.matches
      setIsCompactLayout(nextMatches)
      setCompactView(nextMatches ? 'inbox' : 'thread')
    }

    handleChange()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  useEffect(() => {
    if (!isCompactLayout) return
    setIsDetailOpen(false)
  }, [isCompactLayout])

  useEffect(() => {
    pendingMediaRef.current = mediaFiles
  }, [mediaFiles])

  useEffect(() => {
    conversationsRef.current = conversations
    messagesPageCache.conversations = conversations
  }, [conversations])

  useEffect(() => {
    messagesByConversationRef.current = messagesByConversation
    messagesPageCache.messagesByConversation = messagesByConversation
  }, [messagesByConversation])

  useEffect(() => {
    messagesPageCache.messagePageInfoByConversation = messagePageInfoByConversation
  }, [messagePageInfoByConversation])

  useEffect(() => {
    settingsByConversationRef.current = settingsByConversation
    messagesPageCache.settingsByConversation = settingsByConversation
  }, [settingsByConversation])

  useEffect(() => {
    messagesPageCache.activeId = activeId
  }, [activeId])

  useEffect(() => {
    messagesPageCache.mutedConversationIds = mutedConversationIds
  }, [mutedConversationIds])

  useEffect(() => () => {
    for (const item of pendingMediaRef.current) URL.revokeObjectURL(item.previewUrl)
  }, [])

  useEffect(() => {
    if (!conversations.length) return
    setSettingsByConversation((prev) => {
      let changed = false
      const next = { ...prev }

      for (const item of conversations) {
        const candidate = buildConversationSettings(item)
        const current = next[item.id]
        if (
          !current
          || current.nickname !== candidate.nickname
          || current.isBlocked !== candidate.isBlocked
          || current.blockedAt !== candidate.blockedAt
          || current.peer?.id !== candidate.peer?.id
          || current.peer?.username !== candidate.peer?.username
          || current.peer?.avatarUrl !== candidate.peer?.avatarUrl
          || current.peer?.bio !== candidate.peer?.bio
        ) {
          next[item.id] = current ? { ...current, ...candidate, peer: candidate.peer } : candidate
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [conversations])

  useEffect(() => {
    if (!routeConversationId) return
    setActiveId(routeConversationId)
    const directUser = routeState?.directUser
    if (directUser) {
      setConversations((prev) => (
        prev.some((item) => item.id === routeConversationId)
          ? prev
          : [{
              id: routeConversationId,
              type: 'direct',
              peer: directUser,
              lastMessageText: '',
              lastMessageAt: null,
              unreadCount: 0,
              nickname: '',
              isBlocked: false,
              blockedAt: null,
            }, ...prev]
      ))
    }
    if (isCompactLayout) {
      setCompactView('thread')
      setIsDetailOpen(false)
    }
  }, [routeConversationId, routeState?.directUser, isCompactLayout])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const hasFreshConversationList = messagesPageCache.hasConversationList
          && Date.now() - messagesPageCache.conversationListFetchedAt < MESSAGES_CACHE_TTL_MS
        if (!messagesPageCache.hasConversationList) setLoading(true)
        if (hasFreshConversationList) {
          setLoading(false)
          return
        }
        const items = await api.getConversations()
        if (!mounted) return
        touchConversationListCache()
        setConversations(items)
        setActiveId((prev) => {
          if (routeConversationId && items.some((item) => item.id === routeConversationId)) return routeConversationId
          if (prev && items.some((item) => item.id === prev)) return prev
          return items[0]?.id || ''
        })
      } catch (err: any) {
        if (!mounted) return
        setError(err?.message || 'Không tải được danh sách chat')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [api, routeConversationId])

  useEffect(() => {
    if (!isSearchOpen) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        setSearchLoading(true)
        const data = await api.searchUsers(query)
        if (!cancelled) setSearchResults(data)
      } catch {
        if (!cancelled) setSearchResults({ following: [], suggested: [] })
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }, query.trim() ? 250 : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [api, query, isSearchOpen])

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as Node | null
      const element = event.target as Element | null
      if (element?.closest('[data-msg-flyout="true"]')) return
      if (searchRef.current && target && !searchRef.current.contains(target)) setIsSearchOpen(false)
      setReactionPickerMessageId('')
      setActionMenuMessageId('')
    }
    document.addEventListener('mousedown', handleDocumentClick)
    return () => document.removeEventListener('mousedown', handleDocumentClick)
  }, [])

  useEffect(() => {
    if (!shouldLoadActiveConversation || !activeId) return
    let mounted = true
    const currentConversation = conversationsRef.current.find((item) => item.id === activeId)
    const shouldMarkRead = Number(currentConversation?.unreadCount || 0) > 0

    if (currentConversation) {
      setConversations((prev) => prev.map((item) => (item.id === activeId ? { ...item, unreadCount: 0 } : item)))
    }

    if (shouldMarkRead) {
      void api.markRead(activeId)
        .then(() => markConversationReadRealtime(socket, activeId))
        .catch(() => {})
    }

    ;(async () => {
      try {
        const hasLoadedMessages = Boolean(loadedMessagesRef.current[activeId])
        const hasFreshMessages = hasLoadedMessages && isFreshMessageCache(activeId)
        if (hasFreshMessages) {
          setDetailLoading(false)
          return
        }

        setDetailLoading(!hasLoadedMessages)
        const data = await api.getMessages(activeId)
        if (!mounted) return
        setMessagesByConversation((prev) => ({ ...prev, [activeId]: data.items }))
        setMessagePageInfoByConversation((prev) => ({ ...prev, [activeId]: data.pageInfo }))
        loadedMessagesRef.current = { ...loadedMessagesRef.current, [activeId]: true }
        messagesPageCache.loadedMessagesByConversation = loadedMessagesRef.current
        touchMessageCache(activeId)
      } catch (err: any) {
        if (mounted) setError(err?.message || 'Không tải được tin nhắn')
      } finally {
        if (mounted) setDetailLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [activeId, api, shouldLoadActiveConversation, socket])

  useEffect(() => {
    socket?.emit('presence:update', { screen: 'messages', activeConversationId: shouldLoadActiveConversation ? activeId : '' })
    if (!socket || !activeId || !shouldLoadActiveConversation) return
    joinConversation(socket, activeId)
    return () => leaveConversation(socket, activeId)
  }, [socket, activeId, shouldLoadActiveConversation])

  useEffect(() => {
    setReactionPickerMessageId('')
    setActionMenuMessageId('')
    setIsNicknameEditorOpen(false)
  }, [activeId])

  useEffect(() => {
    if (isNicknameEditorOpen) return
    setNicknameDraft(settings?.nickname || '')
  }, [activeId, settings?.nickname, isNicknameEditorOpen])

  useEffect(() => {
    if (!shouldShowThread || !contentScrollRef.current) return
    contentScrollRef.current.scrollTop = contentScrollRef.current.scrollHeight
  }, [activeMessages.length, activeId, shouldShowThread])

  useEffect(() => {
    if (!socket) return

    const onMessageNew = (message: ChatMessage) => {
      setMessagesByConversation((prev) => {
        const arr = prev[message.conversationId] ? [...prev[message.conversationId]] : []
        const existedIndex = arr.findIndex((item) => item.id === message.id)
        if (existedIndex >= 0) arr.splice(existedIndex, 1, message)
        else arr.push(message)
        return { ...prev, [message.conversationId]: arr }
      })
      touchMessageCache(message.conversationId)
      touchConversationListCache()

      setConversations((prev) => {
        const found = prev.find((item) => item.id === message.conversationId)
        if (!found) return prev
        const next = prev.map((item) => {
          if (item.id !== message.conversationId) return item
          const shouldIncrease = (!shouldLoadActiveConversation || message.conversationId !== activeId) && message.senderUsername !== state.username
          return {
            ...item,
            lastMessageText: buildMessagePreview(message),
            lastMessageAt: message.createdAt,
            unreadCount: shouldIncrease ? item.unreadCount + 1 : 0,
          }
        })
        return sortConversationsByLastMessage(next)
      })
    }

    const onMessageReaction = (message: ChatMessage) => {
      touchMessageCache(message.conversationId)
      setMessagesByConversation((prev) => ({
        ...prev,
        [message.conversationId]: (prev[message.conversationId] || []).map((item) => (item.id === message.id ? { ...item, ...message } : item)),
      }))
    }

    const onMessageDeleted = (payload: DeletedMessageEvent) => {
      applyDeletedMessage(payload)
    }

    const onConversationUpdated = async ({ conversationId }: { conversationId?: string } = {}) => {
      if (!conversationId) return
      try {
        const detail = await api.getConversation(conversationId)
        touchConversationListCache()
        setConversations((prev) => sortConversationsByLastMessage(prev.map((item) => (item.id === conversationId ? { ...item, ...detail } : item))))
      } catch {}
    }

    const onInboxRefresh = async () => {
      try {
        const items = await api.getConversations()
        touchConversationListCache()
        setConversations(items)
        if (!activeId && items[0]?.id) setActiveId(items[0].id)
      } catch {}
    }

    const onHistoryCleared = ({ conversationId }: { conversationId?: string } = {}) => {
      if (!conversationId) return
      loadedMessagesRef.current = { ...loadedMessagesRef.current, [conversationId]: true }
      messagesPageCache.loadedMessagesByConversation = loadedMessagesRef.current
      touchMessageCache(conversationId)
      touchConversationListCache()
      setMessagesByConversation((prev) => ({ ...prev, [conversationId]: [] }))
      setMessagePageInfoByConversation((prev) => ({
        ...prev,
        [conversationId]: { hasMore: false, nextBeforeMessageId: '' },
      }))
      setConversations((prev) => sortConversationsByLastMessage(prev.map((item) => (item.id === conversationId ? { ...item, lastMessageText: '', lastMessageAt: null, unreadCount: 0 } : item))))
    }

    const onReconnect = async () => {
      await onInboxRefresh()
      if (!activeId || !shouldLoadActiveConversation) return
      try {
        const data = await api.getMessages(activeId)
        loadedMessagesRef.current = { ...loadedMessagesRef.current, [activeId]: true }
        messagesPageCache.loadedMessagesByConversation = loadedMessagesRef.current
        touchMessageCache(activeId)
        setMessagesByConversation((prev) => ({ ...prev, [activeId]: data.items }))
        setMessagePageInfoByConversation((prev) => ({ ...prev, [activeId]: data.pageInfo }))
      } catch {}
    }

    socket.on('message:new', onMessageNew)
    socket.on('message:reaction', onMessageReaction)
    socket.on('message:deleted', onMessageDeleted)
    socket.on('inbox:refresh', onInboxRefresh)
    socket.on('conversation:updated', onConversationUpdated)
    socket.on('conversation:history-cleared', onHistoryCleared)
    socket.on('connect', onReconnect)

    return () => {
      socket.off('message:new', onMessageNew)
      socket.off('message:reaction', onMessageReaction)
      socket.off('message:deleted', onMessageDeleted)
      socket.off('inbox:refresh', onInboxRefresh)
      socket.off('conversation:updated', onConversationUpdated)
      socket.off('conversation:history-cleared', onHistoryCleared)
      socket.off('connect', onReconnect)
    }
  }, [socket, activeId, state.username, api, shouldLoadActiveConversation])

  const handleInboxBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/')
  }

  const handleOpenConversation = (conversationId: string) => {
    setActiveId(conversationId)
    setIsSearchOpen(false)
    setIsNicknameEditorOpen(false)
    if (isCompactLayout) {
      setIsDetailOpen(false)
      setCompactView('thread')
    }
  }

  const handleBackToInbox = () => {
    setIsDetailOpen(false)
    setCompactView('inbox')
  }

  const handleStartCall = async (mode: 'audio' | 'video') => {
    if (!activeConversation || !activeConversation.peer?.id) return
    if (isCurrentConversationInCall) {
      expandCallWindow()
      return
    }

    try {
      setError('')
      await startCall({
        conversationId: activeConversation.id,
        peer: {
          id: activeConversation.peer.id,
          username: activeConversation.peer.username,
          avatarUrl: activeConversation.peer.avatarUrl,
          bio: activeConversation.peer.bio,
        },
        mode,
      })
    } catch (err: any) {
      setError(err?.message || 'Không thể bắt đầu cuộc gọi')
    }
  }

  const handlePickUser = async (user: MessageUser) => {
    try {
      const conversation = await api.createDirectConversation({ targetUserId: user.id, username: user.username })
      touchConversationListCache()
      setConversations((prev) => {
        const existed = prev.some((item) => item.id === conversation.id)
        return sortConversationsByLastMessage(existed ? prev.map((item) => (item.id === conversation.id ? { ...item, ...conversation } : item)) : [conversation, ...prev])
      })
      setActiveId(conversation.id)
      setIsSearchOpen(false)
      setIsDetailOpen(false)
      setQuery('')
      if (isCompactLayout) setCompactView('thread')
    } catch (err: any) {
      setError(err?.message || 'Không thể mở đoạn chat')
    }
  }

  const clearPendingMedia = () => {
    setMediaFiles((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl)
      return []
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removePendingMedia = (id: string) => {
    setMediaFiles((prev) => prev.filter((item) => {
      if (item.id === id) {
        URL.revokeObjectURL(item.previewUrl)
        return false
      }
      return true
    }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const appendPendingFiles = (fileList?: FileList | null) => {
    const selected = Array.from(fileList || [])
    if (!selected.length) return

    let nextError = ''
    setMediaFiles((prev) => {
      const next = [...prev]
      for (const file of selected) {
        const isImage = file.type.startsWith('image/')
        const isVideo = file.type.startsWith('video/')

        if (!isImage && !isVideo) {
          nextError = 'Chỉ hỗ trợ ảnh hoặc video trong tin nhắn'
          continue
        }

        if (isVideo && file.size > MAX_MESSAGE_VIDEO_BYTES) {
          nextError = 'Mỗi video trong tin nhắn chỉ được tối đa 15MB'
          continue
        }

        if (next.length >= MAX_MESSAGE_MEDIA_FILES) {
          nextError = `Chỉ được chọn tối đa ${MAX_MESSAGE_MEDIA_FILES} ảnh/video mỗi lần`
          break
        }

        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          type: isVideo ? 'video' : 'image',
        })
      }
      return next
    })

    if (fileInputRef.current) fileInputRef.current.value = ''
    setError(nextError)
  }

  const applyDeletedMessage = (payload: DeletedMessageEvent) => {
    if (!payload?.conversationId || !payload?.messageId) return
    touchMessageCache(payload.conversationId)
    touchConversationListCache()
    setMessagesByConversation((prev) => ({
      ...prev,
      [payload.conversationId]: (prev[payload.conversationId] || []).filter((item) => item.id !== payload.messageId),
    }))
    setConversations((prev) => sortConversationsByLastMessage(prev.map((item) => (
      item.id === payload.conversationId
        ? {
            ...item,
            lastMessageText: payload.lastMessageText || '',
            lastMessageAt: payload.lastMessageAt || null,
          }
        : item
    ))))
    setReplyTo((prev) => (prev?.id === payload.messageId ? null : prev))
    setReactionPickerMessageId((prev) => (prev === payload.messageId ? '' : prev))
    setActionMenuMessageId((prev) => (prev === payload.messageId ? '' : prev))
  }

  const loadOlderMessages = async () => {
    if (!activeId || loadingOlder || !activeMessagePageInfo.hasMore) return
    const beforeMessageId = activeMessagePageInfo.nextBeforeMessageId || activeMessages[0]?.id || ''
    if (!beforeMessageId) return

    const previousScrollHeight = contentScrollRef.current?.scrollHeight || 0
    const previousScrollTop = contentScrollRef.current?.scrollTop || 0

    try {
      setLoadingOlder(true)
      const data = await api.getMessages(activeId, { beforeMessageId })
      loadedMessagesRef.current = { ...loadedMessagesRef.current, [activeId]: true }
      messagesPageCache.loadedMessagesByConversation = loadedMessagesRef.current
      touchMessageCache(activeId)

      setMessagesByConversation((prev) => {
        const existing = prev[activeId] || []
        const existingIds = new Set(existing.map((item) => item.id))
        const olderItems = data.items.filter((item) => !existingIds.has(item.id))
        return {
          ...prev,
          [activeId]: [...olderItems, ...existing],
        }
      })
      setMessagePageInfoByConversation((prev) => ({ ...prev, [activeId]: data.pageInfo }))

      window.requestAnimationFrame(() => {
        if (!contentScrollRef.current) return
        const nextScrollHeight = contentScrollRef.current.scrollHeight
        contentScrollRef.current.scrollTop = nextScrollHeight - previousScrollHeight + previousScrollTop
      })
    } catch (err: any) {
      setError(err?.message || 'Không tải được tin nhắn cũ hơn')
    } finally {
      setLoadingOlder(false)
    }
  }

  const handleSend = async () => {
    if (!activeId || sending || isBlocked) return
    const value = text.trim()
    if (!value && !mediaFiles.length) return
    setSending(true)
    setError('')
    try {
      let message: ChatMessage

      if (!mediaFiles.length) {
        const ack = await sendRealtimeMessage(socket, activeId, {
          text: value,
          replyToMessageId: replyTo?.id || null,
        }) as { ok?: boolean; data?: { message?: ChatMessage }; message?: string }

        if (!ack?.ok || !ack.data?.message) {
          throw new Error(ack?.message || 'Gửi tin nhắn thất bại')
        }

        message = ack.data.message
      } else {
        message = await api.sendMessageHttp(activeId, { text: value, media: mediaFiles.map((item) => item.file), replyToMessageId: replyTo?.id || null })
      }

      loadedMessagesRef.current = { ...loadedMessagesRef.current, [activeId]: true }
      messagesPageCache.loadedMessagesByConversation = loadedMessagesRef.current
      touchMessageCache(activeId)
      touchConversationListCache()
      setMessagesByConversation((prev) => {
        const arr = prev[activeId] || []
        return arr.some((item) => item.id === message.id) ? prev : { ...prev, [activeId]: [...arr, message] }
      })
      setConversations((prev) => sortConversationsByLastMessage(prev.map((item) => (item.id === activeId ? { ...item, lastMessageText: buildMessagePreview(message), lastMessageAt: message.createdAt } : item))))
      setText('')
      setReplyTo(null)
      clearPendingMedia()
    } catch (err: any) {
      setError(err?.message || 'Gửi tin nhắn thất bại')
    } finally {
      setSending(false)
    }
  }

  const setMessageReaction = async (message: ChatMessage, emoji: string) => {
    if (!activeId) return
    try {
      const next = message.myReaction === emoji
        ? await api.removeMessageReaction(activeId, message.id)
        : await api.setMessageReaction(activeId, message.id, emoji)
      touchMessageCache(activeId)
      setMessagesByConversation((prev) => ({
        ...prev,
        [activeId]: (prev[activeId] || []).map((item) => (item.id === message.id ? { ...item, ...next } : item)),
      }))
      setReactionPickerMessageId('')
    } catch (err: any) {
      setError(err?.message || 'Không thể bày tỏ cảm xúc')
    }
  }

  const revokeMessage = async (message: ChatMessage) => {
    if (!activeId) return
    const ok = window.confirm('Thu hồi tin nhắn này?')
    if (!ok) return
    try {
      const payload = await api.deleteMessage(activeId, message.id)
      applyDeletedMessage(payload)
      setActionMenuMessageId('')
    } catch (err: any) {
      setError(err?.message || 'Không thể thu hồi tin nhắn')
    }
  }

  const saveNickname = async () => {
    if (!activeId || savingDetail) return
    try {
      setSavingDetail(true)
      const next = await api.updateSettings(activeId, { nickname: nicknameDraft })
      setSettingsByConversation((prev) => ({ ...prev, [activeId]: next }))
      touchConversationListCache()
      setConversations((prev) => prev.map((item) => (item.id === activeId ? { ...item, nickname: next.nickname } : item)))
      setIsNicknameEditorOpen(false)
    } catch (err: any) {
      setError(err?.message || 'Không thể cập nhật biệt danh')
    } finally {
      setSavingDetail(false)
    }
  }

  const toggleBlock = async () => {
    if (!activeId || savingDetail) return
    try {
      setSavingDetail(true)
      const next = await api.updateSettings(activeId, { isBlocked: !isBlocked })
      setSettingsByConversation((prev) => ({ ...prev, [activeId]: next }))
      touchConversationListCache()
      setConversations((prev) => prev.map((item) => (item.id === activeId ? { ...item, isBlocked: next.isBlocked } : item)))
    } catch (err: any) {
      setError(err?.message || 'Không thể cập nhật trạng thái chặn')
    } finally {
      setSavingDetail(false)
    }
  }

  const clearHistory = async () => {
    if (!activeId || savingDetail) return
    const ok = window.confirm('Xóa toàn bộ lịch sử đoạn chat này? Các file ảnh/video gắn với tin nhắn cũng sẽ bị xóa.')
    if (!ok) return
    try {
      setSavingDetail(true)
      await api.clearHistory(activeId)
      loadedMessagesRef.current = { ...loadedMessagesRef.current, [activeId]: true }
      messagesPageCache.loadedMessagesByConversation = loadedMessagesRef.current
      touchMessageCache(activeId)
      touchConversationListCache()
      setMessagesByConversation((prev) => ({ ...prev, [activeId]: [] }))
      setMessagePageInfoByConversation((prev) => ({
        ...prev,
        [activeId]: { hasMore: false, nextBeforeMessageId: '' },
      }))
      setConversations((prev) => sortConversationsByLastMessage(prev.map((item) => (item.id === activeId ? { ...item, lastMessageText: '', lastMessageAt: null, unreadCount: 0 } : item))))
    } catch (err: any) {
      setError(err?.message || 'Không thể xóa lịch sử đoạn chat')
    } finally {
      setSavingDetail(false)
    }
  }

  const handleReportUser = () => {
    setError('Tính năng báo cáo người dùng trong chat chưa được hỗ trợ.')
  }

  const renderSearchGroup = (label: string, items: MessageUser[]) => {
    if (!items.length) return null
    return (
      <div className="ig-msg__searchGroup">
        <div className="ig-msg__searchHeading">{label}</div>
        {items.map((user) => (
          <button key={user.id} type="button" className="ig-msg__searchItem" onClick={() => void handlePickUser(user)}>
            <img className="ig-msg__avatar" src={avatarOf(user)} alt={user.username} />
            <div className="ig-msg__searchMeta">
              <div className="ig-msg__itemName">{user.username}</div>
              <div className="ig-msg__itemLast">{user.bio || user.email || 'Người dùng T'}</div>
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={`ig-msg ${isCompactLayout ? 'is-compact' : ''} ${isCompactLayout && compactView === 'inbox' ? 'is-list-view' : ''} ${isCompactLayout && compactView === 'thread' ? 'is-thread-view' : ''}`}>
      <div className={`ig-msg__wrap ${isDetailOpen ? 'is-detail-open' : ''}`}>
        {shouldShowInbox ? (
          <aside className="ig-msg__left">
            <div className={`ig-msg__leftTop ${isCompactLayout ? 'is-compact' : ''}`}>
              <button className="ig-msg__iconBtn ig-msg__headerBack" type="button" onClick={handleInboxBack} aria-label="Quay lại trang trước">←</button>
              <button className="ig-msg__userBtn" type="button">
                <span className="ig-msg__userName">{state.username || 'instagram_user'}</span>
                <span className="ig-msg__chev">▾</span>
              </button>
              <button className="ig-msg__compose" type="button">✎</button>
            </div>

          <div className="ig-msg__searchWrap" ref={searchRef}>
            <div className="ig-msg__search">
              <span className="ig-msg__searchIcon">⌕</span>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setIsSearchOpen(true)
                }}
                onFocus={() => setIsSearchOpen(true)}
                onClick={() => setIsSearchOpen(true)}
                placeholder="Tìm kiếm"
                className="ig-msg__searchInput"
              />
            </div>

            {isSearchOpen ? (
              <div className="ig-msg__searchDropdown">
                {searchLoading ? <div className="ig-msg__searchEmpty">Đang tải danh sách người dùng...</div> : null}
                {!searchLoading ? (
                  <>
                    {renderSearchGroup('Đang theo dõi', searchResults.following)}
                    {renderSearchGroup('Đề xuất', searchResults.suggested)}
                    {!searchResults.following.length && !searchResults.suggested.length ? <div className="ig-msg__searchEmpty">{query.trim() ? 'Không tìm thấy người dùng phù hợp.' : 'Chưa có người dùng để gợi ý.'}</div> : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="ig-msg__sectionHead">
            <div className="ig-msg__sectionTitle">Tin nhắn</div>
          </div>

          <div className="ig-msg__list">
            {loading ? <div className="ig-msg__empty">Đang tải cuộc trò chuyện...</div> : null}
            {!loading && !conversations.length ? <div className="ig-msg__empty">Chưa có đoạn chat nào. Hãy tìm người dùng để bắt đầu.</div> : null}
            {conversations.map((item) => (
              <button key={item.id} type="button" className={`ig-msg__item ${item.id === activeId ? 'is-selected' : ''}`} onClick={() => handleOpenConversation(item.id)}>
                <img className="ig-msg__avatar" src={avatarOf(item.peer)} alt={item.peer.username} />
                <div className="ig-msg__itemMid">
                  <div className="ig-msg__itemTitle"><span className="ig-msg__itemName">{item.nickname?.trim() || item.peer.username}</span></div>
                  <div className="ig-msg__itemSub">
                    <span className="ig-msg__itemLast">{item.lastMessageText || 'Hãy bắt đầu cuộc trò chuyện'}</span>
                    {item.lastMessageAt ? <><span className="ig-msg__sep">·</span><span className="ig-msg__itemTime">{formatConversationTime(item.lastMessageAt)}</span></> : null}
                  </div>
                </div>
                {item.unreadCount > 0 ? <span className="ig-msg__count">{item.unreadCount}</span> : null}
              </button>
            ))}
          </div>
          </aside>
        ) : null}

        {shouldShowThread ? (
          <section className="ig-msg__right">
            {activeConversation ? (
            <>
              <div className={`ig-msg__rightTop ${isCompactLayout ? 'is-compact' : ''}`}>
                <button className="ig-msg__iconBtn ig-msg__headerBack" type="button" onClick={handleBackToInbox} aria-label="Quay lại danh sách tin nhắn">←</button>
                <div className="ig-msg__peer">
                  <img className="ig-msg__peerAvatar" src={avatarOf(activeConversation.peer)} alt={activeConversation.peer.username} />
                  <div className="ig-msg__peerMeta">
                    <div className="ig-msg__peerName">{displayPeerName}</div>
                    <div className="ig-msg__peerUser">{headerPeerSubtitle}</div>
                  </div>
                </div>
                <div className="ig-msg__actions">
                  <button
                    className={`ig-msg__iconBtn ${isCurrentConversationInCall ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => void handleStartCall('audio')}
                    aria-label={isCurrentConversationInCall ? 'Mở cửa sổ cuộc gọi' : 'Gọi thoại'}
                    title={isCurrentConversationInCall ? 'Mở cửa sổ cuộc gọi' : isAnotherConversationInCall ? 'Bạn đang có cuộc gọi ở đoạn chat khác' : 'Gọi thoại'}
                    disabled={isBlocked || (!isCurrentConversationInCall && isAnotherConversationInCall)}
                  >
                    <PhoneCallIcon />
                  </button>
                  <button
                    className={`ig-msg__iconBtn ${isCurrentConversationInCall && activeCall?.mode === 'video' ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => void handleStartCall('video')}
                    aria-label={isCurrentConversationInCall ? 'Mở cửa sổ cuộc gọi' : 'Gọi video'}
                    title={isCurrentConversationInCall ? 'Mở cửa sổ cuộc gọi' : isAnotherConversationInCall ? 'Bạn đang có cuộc gọi ở đoạn chat khác' : 'Gọi video'}
                    disabled={isBlocked || (!isCurrentConversationInCall && isAnotherConversationInCall)}
                  >
                    <VideoCallIcon />
                  </button>
                  <button className="ig-msg__iconBtn" type="button" onClick={() => setIsDetailOpen((prev) => !prev)} aria-pressed={isDetailOpen}>ⓘ</button>
                </div>
              </div>

              <div className="ig-msg__mainShell">
                <div className="ig-msg__mainCol">
                  <div className="ig-msg__contentScroll" ref={contentScrollRef}>
                    <div className="ig-msg__hero">
                      <img className="ig-msg__heroAvatar" src={avatarOf(activeConversation.peer)} alt={activeConversation.peer.username} />
                      <div className="ig-msg__heroName">{displayPeerName}</div>
                      <div className="ig-msg__heroUser">{activeConversation.peer.bio || 'T'}</div>
                      <button className="ig-msg__profileBtn" type="button" onClick={() => navigate(`/profile/${activeConversation.peer.username}`)}>Xem trang cá nhân</button>
                    </div>

                    <div className="ig-msg__body">
                      {activeMessagePageInfo.hasMore ? (
                        <div className="ig-msg__historyActions">
                          <button
                            className="ig-msg__historyBtn"
                            type="button"
                            onClick={() => void loadOlderMessages()}
                            disabled={loadingOlder || detailLoading}
                          >
                            {loadingOlder ? 'Đang tải tin nhắn cũ hơn...' : 'Xem tin nhắn cũ hơn'}
                          </button>
                        </div>
                      ) : null}
                      {detailLoading ? <div className="ig-msg__empty">Đang tải tin nhắn...</div> : null}
                      {!detailLoading && !activeMessages.length ? <div className="ig-msg__empty">Chưa có tin nhắn nào.</div> : null}
                      {activeMessages.map((message, index) => {
                        const fromMe = message.senderUsername === state.username
                        const showCenterTime = shouldShowCenterTime(activeMessages, index)
                        const isCallEvent = isCallEventMessage(message)
                        const showActions = hoveredMessageId === message.id
                        const hasText = Boolean(message.text)
                        const hasMedia = getMessageMediaItems(message).length > 0
                        const reactionDisplay = getMessageReactionDisplay(message)
                        return (
                          <div key={message.id}>
                            {showCenterTime ? <div className="ig-msg__centerTime">{formatTime(message.createdAt)}</div> : null}
                            {isCallEvent ? <CallEventMessage message={message} /> : null}
                            {!isCallEvent ? (
                            <div className={`ig-msg__row ${fromMe ? 'is-me' : 'is-them'}`} onMouseEnter={() => setHoveredMessageId(message.id)} onMouseLeave={() => setHoveredMessageId((prev) => (prev === message.id ? '' : prev))}>
                              {!fromMe ? <img className="ig-msg__bubbleAvatar" src={avatarOf(activeConversation.peer)} alt="" /> : null}
                              <div className="ig-msg__bubbleWrap">
                                <div className={`ig-msg__messageCard ${fromMe ? 'is-me' : 'is-them'}`}>
                                  {(showActions || reactionPickerMessageId === message.id || actionMenuMessageId === message.id) ? (
                                    <div className={`ig-msg__hoverTools ${fromMe ? 'is-me' : 'is-them'}`}>
                                      <button className="ig-msg__tinyIcon" type="button" onClick={() => setReplyTo(message)} title="Trả lời">↩</button>
                                      <button
                                        className="ig-msg__tinyIcon"
                                        type="button"
                                        title="Bày tỏ cảm xúc"
                                        data-msg-flyout="true"
                                        onClick={() => {
                                          setActionMenuMessageId('')
                                          setReactionPickerMessageId((prev) => (prev === message.id ? '' : message.id))
                                        }}
                                      >
                                        ☺
                                      </button>
                                      {fromMe ? (
                                        <button
                                          className="ig-msg__tinyIcon"
                                          type="button"
                                          title="Tùy chọn"
                                          data-msg-flyout="true"
                                          onClick={() => {
                                            setReactionPickerMessageId('')
                                            setActionMenuMessageId((prev) => (prev === message.id ? '' : message.id))
                                          }}
                                        >
                                          ⋯
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {reactionPickerMessageId === message.id ? (
                                    <div className={`ig-msg__reactionPicker ${fromMe ? 'is-me' : 'is-them'}`} data-msg-flyout="true">
                                      {MESSAGE_REACTIONS.map((emoji) => (
                                        <button key={emoji} className={`ig-msg__reactionOption ${message.myReaction === emoji ? 'is-active' : ''}`} type="button" onClick={() => void setMessageReaction(message, emoji)}>
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                  {actionMenuMessageId === message.id && fromMe ? (
                                    <div className={`ig-msg__messageMenu ${fromMe ? 'is-me' : 'is-them'}`} data-msg-flyout="true">
                                      <button className="ig-msg__messageMenuItem is-danger" type="button" onClick={() => void revokeMessage(message)}>Thu hồi</button>
                                    </div>
                                  ) : null}
                                  {message.replyToMessageId ? (
                                    <div className="ig-msg__replyBlock">
                                      <div className="ig-msg__replyAuthor">{message.replyToSenderUsername || 'Tin nhắn gốc'}</div>
                                      <div className="ig-msg__replyText">{message.replyToType === 'text' ? (message.replyToText || 'Tin nhắn') : message.replyToType === 'image' ? 'Ảnh' : 'Video'}</div>
                                    </div>
                                  ) : null}
                                  <div className={`ig-msg__messageStack ${fromMe ? 'is-me' : 'is-them'}`}>
                                    {hasText ? (
                                      <div className={`ig-msg__bubble ${fromMe ? 'is-me' : 'is-them'}`}>
                                        <div className="ig-msg__bubbleText">{message.text}</div>
                                      </div>
                                    ) : null}
                                    {hasMedia ? <RichMessageMedia message={message} /> : null}
                                  </div>
                                  {reactionDisplay ? <div className="ig-msg__messageReaction">{reactionDisplay}</div> : null}
                                </div>
                              </div>
                            </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="ig-msg__composerWrap">
                    {replyTo ? (
                      <div className="ig-msg__replyComposer">
                        <div>
                          <div className="ig-msg__replyComposerLabel">Đang trả lời {replyTo.senderUsername === state.username ? 'chính bạn' : replyTo.senderUsername}</div>
                          <div className="ig-msg__replyComposerText">{replyTo.type === 'text' ? (replyTo.text || 'Tin nhắn') : replyTo.type === 'image' ? 'Ảnh' : 'Video'}</div>
                        </div>
                        <button className="ig-msg__tinyIcon" type="button" onClick={() => setReplyTo(null)}>×</button>
                      </div>
                    ) : null}
                    {mediaFiles.length ? (
                      <div className="ig-msg__pendingMediaList">
                        {mediaFiles.map((item) => (
                          <div key={item.id} className="ig-msg__pendingMediaBox">
                            {item.type === 'video' ? <video className="ig-msg__pendingMedia" src={item.previewUrl} muted playsInline /> : <img className="ig-msg__pendingMedia" src={item.previewUrl} alt={item.file.name || 'pending media'} />}
                            <button className="ig-msg__tinyIcon ig-msg__pendingRemove" type="button" onClick={() => removePendingMedia(item.id)}>×</button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {isBlocked ? <div className="ig-msg__blockedHint">Bạn đã chặn người dùng này. Hãy bỏ chặn để tiếp tục nhắn tin.</div> : null}
                    <div className="ig-msg__composer">
                      <button className="ig-msg__emoji" type="button">☺</button>
                      <input
                        className="ig-msg__input"
                        placeholder={isBlocked ? 'Đã chặn người dùng' : 'Nhắn tin...'}
                        value={text}
                        disabled={isBlocked}
                        onChange={(e) => setText(e.target.value)}
                        onPaste={(e) => {
                          const files = e.clipboardData.files
                          if (!files?.length) return
                          e.preventDefault()
                          appendPendingFiles(files)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleSend()
                          }
                        }}
                      />
                      <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => appendPendingFiles(e.target.files)} />
                      <div className="ig-msg__composerActions">
                        <button className="ig-msg__iconBtn" type="button">🎤</button>
                        <button className="ig-msg__iconBtn" type="button" onClick={() => fileInputRef.current?.click()}>🖼</button>
                        <button className="ig-msg__iconBtn" type="button" onClick={() => void handleSend()} disabled={sending || (!text.trim() && !mediaFiles.length) || isBlocked}>{sending ? '...' : '➤'}</button>
                      </div>
                    </div>
                  </div>
                </div>

                {isDetailOpen ? (
                  <aside className="ig-msg__detail">
                    <div className="ig-msg__detailHeader">
                      <button type="button" className="ig-msg__detailHeaderBack" onClick={() => setIsDetailOpen(false)} aria-label="Đóng chi tiết đoạn chat">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                        </svg>
                      </button>
                      <div className="ig-msg__detailHeaderTitle">Chi tiết</div>
                    </div>

                    <div className="ig-msg__detailBody">
                      <div className="ig-msg__detailSection">
                        <div className="ig-msg__detailRow">
                          <div className="ig-msg__detailRowMain">
                            <span className="ig-msg__detailRowIcon" aria-hidden="true">
                              <svg viewBox="0 0 24 24">
                                <path d="M12 4a5 5 0 0 0-5 5v2.6c0 .7-.24 1.37-.69 1.88L5 15h14l-1.31-1.52a2.9 2.9 0 0 1-.69-1.88V9a5 5 0 0 0-5-5Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                                <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                              </svg>
                            </span>
                            <span className="ig-msg__detailRowLabel">Tắt thông báo về tin nhắn</span>
                          </div>
                          <button
                            type="button"
                            className={`ig-msg__switch ${isMuted ? 'is-active' : ''}`}
                            aria-pressed={isMuted}
                            onClick={() => setMutedConversationIds((prev) => ({ ...prev, [activeId]: !prev[activeId] }))}
                          >
                            <span className="ig-msg__switchThumb" />
                          </button>
                        </div>
                      </div>

                      <div className="ig-msg__detailSection">
                        <div className="ig-msg__detailSectionTitle">Thành viên</div>
                        <button type="button" className="ig-msg__detailMember" onClick={() => navigate(`/profile/${activeConversation.peer.username}`)}>
                          <img className="ig-msg__detailAvatar" src={avatarOf(activeConversation.peer)} alt={activeConversation.peer.username} />
                          <div className="ig-msg__detailMemberMeta">
                            <div className="ig-msg__detailName">{displayPeerName || activeConversation.peer.username}</div>
                            <div className="ig-msg__detailSub">{activeConversation.peer.username}</div>
                          </div>
                        </button>
                      </div>

                      <div className="ig-msg__detailFooter">
                        <button type="button" className="ig-msg__detailMenuItem" onClick={() => setIsNicknameEditorOpen((prev) => !prev)}>
                          <span className="ig-msg__detailMenuMain">Biệt danh</span>
                          <span className="ig-msg__detailMenuValue">{settings?.nickname?.trim() || 'Chưa đặt'}</span>
                        </button>
                        {isNicknameEditorOpen ? (
                          <div className="ig-msg__detailInlineEditor">
                            <input
                              className="ig-msg__detailInlineInput"
                              value={nicknameDraft}
                              onChange={(e) => setNicknameDraft(e.target.value)}
                              placeholder="Nhập biệt danh"
                            />
                            <div className="ig-msg__detailInlineActions">
                              <button type="button" className="ig-msg__detailInlineBtn" onClick={() => setIsNicknameEditorOpen(false)} disabled={savingDetail}>Hủy</button>
                              <button type="button" className="ig-msg__detailInlineBtn is-primary" onClick={() => void saveNickname()} disabled={savingDetail}>Lưu</button>
                            </div>
                          </div>
                        ) : null}
                        <button type="button" className="ig-msg__detailMenuItem" onClick={() => void toggleBlock()} disabled={savingDetail}>
                          <span className="ig-msg__detailMenuMain">{isBlocked ? 'Bỏ chặn' : 'Chặn'}</span>
                        </button>
                        <button type="button" className="ig-msg__detailMenuItem is-danger" onClick={handleReportUser}>
                          <span className="ig-msg__detailMenuMain">Báo cáo</span>
                        </button>
                        <button type="button" className="ig-msg__detailMenuItem is-danger" onClick={() => void clearHistory()} disabled={savingDetail}>
                          <span className="ig-msg__detailMenuMain">Xóa đoạn chat</span>
                        </button>
                      </div>
                    </div>
                  </aside>
                ) : null}
              </div>
            </>
            ) : <div className="ig-msg__blank">Chọn một cuộc trò chuyện để bắt đầu nhắn tin.</div>}
          </section>
        ) : null}
        {error ? <div className="ig-msg__error">{error}</div> : null}
      </div>
    </div>
  )
}

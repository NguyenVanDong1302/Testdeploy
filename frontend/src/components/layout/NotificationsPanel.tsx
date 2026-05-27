
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../features/notifications/NotificationProvider'
import type { NotificationItem } from '../../features/notifications/notifications.types'
import styles from '../../pages/NotificationsPage.module.css'

const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'activity', label: 'Tương tác bài viết' },
  { key: 'follow', label: 'Theo dõi' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

function relativeTime(value?: string) {
  if (!value) return ''
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.round(diff / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(value).toLocaleDateString('vi-VN')
}

function matchesFilter(item: NotificationItem, filter: FilterKey) {
  const isFeedItem = item.type === 'follow' || ((item.type === 'comment' || item.type === 'like') && (item.targetType === 'post' || Boolean(item.postId)))
  if (!isFeedItem) return false
  if (filter === 'all') return true
  if (filter === 'activity') return item.type === 'comment' || item.type === 'like'
  return item.type === 'follow'
}
function splitSections(items: NotificationItem[]) {
  const now = Date.now()
  const recent: NotificationItem[] = []
  const month: NotificationItem[] = []
  for (const item of items) {
    const stamp = new Date(item.lastEventAt || item.createdAt || 0).getTime()
    if (now - stamp <= 1000 * 60 * 60 * 24 * 7) recent.push(item)
    else month.push(item)
  }
  return [{ title: 'New', items: recent }, { title: 'This month', items: month }].filter((section) => section.items.length)
}
function buildLabel(item: NotificationItem) {
  const names = Array.isArray(item.actorUsernames) ? item.actorUsernames.filter(Boolean) : []
  const first = names[0] || 'Ai đó'
  const total = Number(item.totalEvents) || names.length || 1
  const others = Math.max(total - 1, 0)
  if (item.type === 'follow') return others > 0 ? `${first} và ${others} người khác đã theo dõi bạn` : `${first} đã theo dõi bạn`
  if (item.type === 'like') return others > 0 ? `${first} và ${others} người khác đã thích bài viết của bạn` : `${first} đã thích bài viết của bạn`
  return others > 0 ? `${first} và ${others} người khác đã bình luận bài viết của bạn` : `${first} đã bình luận: ${item.previewText || ''}`
}
function getAccentClass(type: string) {
  if (type === 'follow') return styles.avatarFollow
  if (type === 'like') return styles.avatarLike
  return styles.avatarComment
}
function getInitials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join('') || 'U'
}
function Row({ item, onOpen, onToggleRead }: { item: NotificationItem; onOpen: () => void; onToggleRead: () => void }) {
  const names = Array.isArray(item.actorUsernames) ? item.actorUsernames.filter(Boolean) : []
  const first = names[0] || 'Ai đó'
  return (
    <div className={`${styles.row} ${!item.isRead ? styles.rowUnread : ''}`}>
      <button type="button" className={`${styles.avatar} ${getAccentClass(item.type)}`} onClick={onOpen}>{getInitials(first)}</button>
      <button type="button" className={styles.main} onClick={onOpen}>
        <div className={styles.messageText}><strong>{first}</strong> <span>{buildLabel(item).replace(first, '').trim()}</span><span className={styles.time}>{relativeTime(item.lastEventAt || item.createdAt)}</span></div>
        {item.previewText && item.type !== 'follow' ? <div className={styles.preview}>{item.previewText}</div> : null}
      </button>
      <div className={styles.actions}><button type="button" className={item.isRead ? styles.statusBtn : styles.unreadDot} onClick={onToggleRead}>{item.isRead ? 'Đánh dấu chưa đọc' : ''}</button></div>
    </div>
  )
}

export default function NotificationsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { items, markRead, markUnread } = useNotifications()
  const [filter, setFilter] = useState<FilterKey>('all')
  const filtered = useMemo(() => items.filter((item) => matchesFilter(item, filter)), [items, filter])
  if (!open) return null
  return (
    <div className={styles.overlayFixed} onClick={onClose}>
      <aside className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}><h1 className={styles.title}>Notifications</h1><button type="button" className={styles.closeBtn} onClick={onClose}>×</button></div>
        <div className={styles.filters}>{FILTERS.map((entry) => <button key={entry.key} type="button" className={`${styles.filterBtn} ${filter === entry.key ? styles.filterActive : ''}`} onClick={() => setFilter(entry.key)}>{entry.label}</button>)}</div>
        <div className={styles.sections}>{splitSections(filtered).map((section) => <section key={section.title} className={styles.section}><h2 className={styles.sectionTitle}>{section.title}</h2>{section.items.map((item) => <Row key={item._id} item={item} onOpen={async () => { if (!item.isRead) await markRead(item._id); onClose(); navigate(item.type === 'follow' ? `/profile/${encodeURIComponent(item.actorUsernames?.[0] || '')}` : item.postId ? `/post/${item.postId}` : '/'); }} onToggleRead={() => (item.isRead ? markUnread(item._id) : markRead(item._id))} />)}</section>)}</div>
      </aside>
    </div>
  )
}

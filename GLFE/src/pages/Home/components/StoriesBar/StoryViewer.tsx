import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { useModal } from '../../../../components/Modal'
import styles from './StoryViewer.module.css'
import desktopStyles from './StoryViewer.desktop.module.css'
import tabletStyles from './StoryViewer.tablet.module.css'
import mobileStyles from './StoryViewer.mobile.module.css'
import type { StoryGroup, StoryItem, StoryViewerUser } from '../../../../features/stories/stories.types'
import { useStoriesApi } from '../../../../features/stories/stories.api'
import { useMessagesApi } from '../../../../features/messages/messages.api'
import { useAppStore } from '../../../../state/store'
import { combineResponsiveStyles } from '../../../../lib/combineResponsiveStyles'

const DEFAULT_MS = 7000
const SLIDE_MS = 380
const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

import { getAvatarUrl } from '../../../../lib/avatar'

function avatarOf(username: string, avatarUrl?: string) {
  return getAvatarUrl({ username, avatarUrl })
}

function handleAvatarError(event: SyntheticEvent<HTMLImageElement>, username: string) {
  const image = event.currentTarget
  if (image.dataset.fallback === '1') return
  image.dataset.fallback = '1'
  image.src = getAvatarUrl({ username })
}

function timeLabel(value?: string) {
  if (!value) return ''
  const diff = Date.now() - new Date(value).getTime()
  const mins = Math.max(1, Math.round(diff / 60000))
  if (mins < 60) return `${mins} phut`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} gio`
  return `${Math.round(hrs / 24)} ngay`
}

function applySeenState(group: StoryGroup, viewerUsername: string) {
  const isMine = Boolean(viewerUsername) && group.username === viewerUsername
  return {
    ...group,
    hasUnseen: isMine ? false : group.stories.some((story) => !story.viewedByMe),
  }
}

function updateStoryInGroups(groups: StoryGroup[], storyId: string, updater: (story: StoryItem) => StoryItem, viewerUsername: string) {
  let changed = false
  const next = groups.map((group) => {
    let groupChanged = false
    const stories = group.stories.map((story) => {
      if (story.id !== storyId) return story
      const nextStory = updater(story)
      if (nextStory !== story) {
        groupChanged = true
        changed = true
      }
      return nextStory
    })
    if (!groupChanged) return group
    return applySeenState({ ...group, stories }, viewerUsername)
  })
  return changed ? next : groups
}

function getStartStoryIndex(group?: StoryGroup) {
  if (!group?.stories?.length) return 0
  const firstUnseenIndex = group.stories.findIndex((story) => !story.viewedByMe)
  return firstUnseenIndex >= 0 ? firstUnseenIndex : 0
}

type Props = {
  groups: StoryGroup[]
  startGroupIndex: number
  startItemIndex: number
  onChanged?: (items: StoryGroup[]) => void
  variant?: 'active' | 'archive'
}

type Target = { groupIndex: number; itemIndex: number } | null

export default function StoryViewer({ groups, startGroupIndex, startItemIndex, onChanged, variant = 'active' }: Props) {
  const modal = useModal()
  const api = useStoriesApi()
  const messagesApi = useMessagesApi()
  const { state } = useAppStore()
  const viewerUsername = state.username || ''
  const isArchiveMode = variant === 'archive'

  const [localGroups, setLocalGroups] = useState<StoryGroup[]>(groups)
  const [groupIndex, setGroupIndex] = useState(startGroupIndex)
  const [itemIndex, setItemIndex] = useState(startItemIndex)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(false)
  const [reply, setReply] = useState('')
  const [phase, setPhase] = useState<'idle' | 'run'>('idle')
  const [dir, setDir] = useState<'next' | 'prev'>('next')
  const [target, setTarget] = useState<Target>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [viewerPanelOpen, setViewerPanelOpen] = useState(false)
  const [viewerLoading, setViewerLoading] = useState(false)
  const [viewerItems, setViewerItems] = useState<StoryViewerUser[]>([])

  const lastTsRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const slideTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setLocalGroups(groups)
  }, [groups])

  const safeGroupIndex = clamp(groupIndex, 0, Math.max(localGroups.length - 1, 0))
  const currentGroup = localGroups[safeGroupIndex]
  const safeItemIndex = clamp(itemIndex, 0, Math.max((currentGroup?.stories?.length || 1) - 1, 0))
  const currentItem = currentGroup?.stories?.[safeItemIndex]
  const isOwner = Boolean(currentGroup?.username && viewerUsername && currentGroup.username === viewerUsername)

  const incoming = useMemo(() => {
    if (!target) return null
    const g = localGroups[clamp(target.groupIndex, 0, localGroups.length - 1)]
    const it = g?.stories?.[clamp(target.itemIndex, 0, Math.max((g?.stories?.length || 1) - 1, 0))]
    return g && it ? { group: g, item: it } : null
  }, [target, localGroups])

  const bars = useMemo(
    () => (currentGroup?.stories || []).map((_, idx) => (idx < safeItemIndex ? 1 : idx === safeItemIndex ? progress : 0)),
    [currentGroup, safeItemIndex, progress],
  )

  const sideGroups = useMemo(() => {
    const out: Array<{ group: StoryGroup; index: number }> = []
    for (let offset = 1; offset <= 3; offset += 1) {
      const index = safeGroupIndex + offset
      if (index < localGroups.length) out.push({ group: localGroups[index], index })
    }
    return out
  }, [localGroups, safeGroupIndex])

  const viewerCount = currentItem?.viewersCount || 0

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    return () => document.removeEventListener('mousedown', handlePointer)
  }, [])

  useEffect(() => () => {
    if (slideTimerRef.current != null) {
      window.clearTimeout(slideTimerRef.current)
      slideTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    setMenuOpen(false)
    setViewerPanelOpen(false)
  }, [currentItem?.id])

  useEffect(() => {
    if (!currentItem) return
    if (currentItem.mediaType !== 'video') return
    const video = videoRef.current
    if (!video) return
    video.muted = muted
    video.currentTime = 0
    if (paused) {
      video.pause()
    } else {
      void video.play().catch(() => undefined)
    }
  }, [currentItem?.id, currentItem?.mediaType, muted, paused])

  useEffect(() => {
    if (!currentItem || currentItem.mediaType === 'video' || isArchiveMode) return
    let raf = 0
    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts
      const dt = ts - lastTsRef.current
      lastTsRef.current = ts
      if (!paused && !target) {
        setProgress((prev) => {
          const next = prev + dt / DEFAULT_MS
          if (next >= 1) {
            queueMicrotask(() => startSlide(computeNext(), 'next'))
            return 0
          }
          return next
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      lastTsRef.current = null
      cancelAnimationFrame(raf)
    }
  }, [paused, target, currentItem?.id, currentItem?.mediaType, isArchiveMode])

  useEffect(() => {
    if (!currentItem || isOwner || isArchiveMode || currentItem.viewedByMe) return
    let cancelled = false
    void api.markViewed(currentItem.id)
      .then((result) => {
        if (cancelled) return
        setLocalGroups((prev) => {
          const nextGroups = updateStoryInGroups(
            prev,
            currentItem.id,
            (story) => ({
              ...story,
              viewedByMe: true,
              viewersCount: Math.max(story.viewersCount || 0, result.viewersCount || 0),
            }),
            viewerUsername,
          )
          if (nextGroups !== prev) onChanged?.(nextGroups)
          return nextGroups
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api, currentItem, isArchiveMode, isOwner, onChanged, viewerUsername])

  useEffect(() => {
    if (!currentItem || !isOwner) {
      setViewerItems([])
      setViewerLoading(false)
      return
    }
    let cancelled = false
    setViewerItems([])
    setViewerLoading(true)
    void api.getViewers(currentItem.id)
      .then((result) => {
        if (cancelled) return
        setViewerItems(result.items || [])
        setLocalGroups((prev) => {
          const nextGroups = updateStoryInGroups(
            prev,
            currentItem.id,
            (story) => ((story.viewersCount || 0) === (result.count || 0) ? story : { ...story, viewersCount: result.count || 0 }),
            viewerUsername,
          )
          if (nextGroups !== prev) onChanged?.(nextGroups)
          return nextGroups
        })
      })
      .catch(() => {
        if (!cancelled) setViewerItems([])
      })
      .finally(() => {
        if (!cancelled) setViewerLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, currentItem?.id, isOwner, onChanged, viewerUsername])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable

      if (event.key === 'Escape') {
        event.preventDefault()
        if (viewerPanelOpen) {
          setViewerPanelOpen(false)
          return
        }
        if (menuOpen) {
          setMenuOpen(false)
          return
        }
        modal.close()
        return
      }

      if (isTyping) return

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        startSlide(computePrev(), 'prev')
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        startSlide(computeNext(), 'next')
      } else if (event.key === ' ' && !isArchiveMode) {
        event.preventDefault()
        setPaused((value) => !value)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentGroup, isArchiveMode, localGroups, menuOpen, modal, safeGroupIndex, safeItemIndex, viewerPanelOpen])

  const computeNext = () => {
    if (!currentGroup) return null
    if (safeItemIndex < currentGroup.stories.length - 1) return { groupIndex: safeGroupIndex, itemIndex: safeItemIndex + 1 }
    if (safeGroupIndex < localGroups.length - 1) return { groupIndex: safeGroupIndex + 1, itemIndex: 0 }
    return null
  }

  const computePrev = () => {
    if (!currentGroup) return null
    if (safeItemIndex > 0) return { groupIndex: safeGroupIndex, itemIndex: safeItemIndex - 1 }
    if (safeGroupIndex > 0) {
      const prev = localGroups[safeGroupIndex - 1]
      return { groupIndex: safeGroupIndex - 1, itemIndex: Math.max(0, (prev?.stories?.length || 1) - 1) }
    }
    return { groupIndex: safeGroupIndex, itemIndex: 0 }
  }

  const startSlide = (nextTarget: Target, nextDir: 'next' | 'prev') => {
    if (!nextTarget) return modal.close()
    setPaused(true)
    setDir(nextDir)
    setTarget(nextTarget)
    requestAnimationFrame(() => setPhase('run'))
    if (slideTimerRef.current != null) window.clearTimeout(slideTimerRef.current)
    slideTimerRef.current = window.setTimeout(() => {
      setGroupIndex(nextTarget.groupIndex)
      setItemIndex(nextTarget.itemIndex)
      setTarget(null)
      setPhase('idle')
      setProgress(0)
      setPaused(false)
      setMenuOpen(false)
      setViewerPanelOpen(false)
      setReply('')
      slideTimerRef.current = null
    }, SLIDE_MS)
  }

  const applyGroups = (nextGroups: StoryGroup[], nextGroupIndex = safeGroupIndex, nextItemIndex = safeItemIndex) => {
    if (!nextGroups.length) {
      onChanged?.([])
      modal.close()
      return
    }
    const boundedGroupIndex = clamp(nextGroupIndex, 0, nextGroups.length - 1)
    const boundedItemIndex = clamp(nextItemIndex, 0, Math.max((nextGroups[boundedGroupIndex]?.stories?.length || 1) - 1, 0))
    setLocalGroups(nextGroups)
    setGroupIndex(boundedGroupIndex)
    setItemIndex(boundedItemIndex)
    setProgress(0)
    setPaused(false)
    setMenuOpen(false)
    setViewerPanelOpen(false)
    setReply('')
    onChanged?.(nextGroups)
  }

  const handleLike = async () => {
    if (!currentItem || isOwner) return
    const previous = localGroups
    const optimistic = updateStoryInGroups(
      localGroups,
      currentItem.id,
      (story) => ({
        ...story,
        likedByMe: !story.likedByMe,
        likesCount: Math.max(0, story.likesCount + (story.likedByMe ? -1 : 1)),
      }),
      viewerUsername,
    )
    applyGroups(optimistic)
    try {
      const result = await api.toggleLike(currentItem.id)
      const synced = updateStoryInGroups(
        optimistic,
        currentItem.id,
        (story) => ({ ...story, likedByMe: result.liked, likesCount: result.likesCount }),
        viewerUsername,
      )
      applyGroups(synced)
    } catch {
      applyGroups(previous)
    }
  }

  const handleReply = async () => {
    if (!currentGroup || isOwner) return
    const text = reply.trim() || '\u2764\uFE0F'
    const conversation = await messagesApi.createDirectConversation(currentGroup.authorId)
    await messagesApi.sendMessageHttp(conversation.id, { text })
    setReply('')
  }

  const handleHide = async () => {
    if (!currentItem || !currentGroup || isOwner) return
    await api.hide(currentItem.id)
    const nextGroups = localGroups.filter((group) => group.authorId !== currentGroup.authorId)
    const fallbackIndex = safeGroupIndex >= nextGroups.length ? Math.max(0, nextGroups.length - 1) : safeGroupIndex
    applyGroups(nextGroups, fallbackIndex, 0)
  }

  const handleDelete = async () => {
    if (!currentItem || !currentGroup || !isOwner) return
    await api.remove(currentItem.id)
    const nextGroups = localGroups
      .map((group, gi) =>
        gi !== safeGroupIndex
          ? group
          : { ...group, stories: group.stories.filter((story) => story.id !== currentItem.id) },
      )
      .filter((group) => group.stories.length > 0)

    const sameGroupStillExists = Boolean(nextGroups[safeGroupIndex])
    const nextItem = sameGroupStillExists ? Math.min(safeItemIndex, Math.max(0, nextGroups[safeGroupIndex].stories.length - 1)) : 0
    const nextGroup = sameGroupStillExists ? safeGroupIndex : Math.max(0, safeGroupIndex - (safeGroupIndex >= nextGroups.length ? 1 : 0))
    applyGroups(nextGroups, nextGroup, nextItem)
  }

  const renderMedia = (item?: StoryItem) => {
    if (!item) return null
    const backgroundImage = item.thumbnailUrl || item.mediaUrl
    return (
      <div className={styles.mediaFrame}>
        <div className={styles.mediaBackdrop} style={{ backgroundImage: `url(${backgroundImage})` }} />
        <div className={styles.mediaShade} />
        {item.mediaType === 'video' ? (
          <video
            ref={item.id === currentItem?.id ? videoRef : undefined}
            className={styles.media}
            src={item.mediaUrl}
            poster={item.thumbnailUrl}
            autoPlay
            muted={muted}
            playsInline
            onLoadedMetadata={(e) => {
              const video = e.currentTarget
              if (!Number.isFinite(video.duration) || video.duration <= 0) return
              if (!paused) {
                void video.play().catch(() => undefined)
              }
            }}
            onTimeUpdate={(e) => {
              if (item.id !== currentItem?.id || paused || target || isArchiveMode) return
              const video = e.currentTarget
              if (Number.isFinite(video.duration) && video.duration > 0) {
                setProgress(video.currentTime / video.duration)
              }
            }}
            onEnded={() => {
              if (item.id !== currentItem?.id || isArchiveMode) return
              startSlide(computeNext(), 'next')
            }}
          />
        ) : (
          <img className={styles.media} src={item.mediaUrl} alt="story" draggable={false} />
        )}
        {item.caption ? <div className={`${styles.caption} ${responsiveStyles.caption}`}>{item.caption}</div> : null}
      </div>
    )
  }

  if (!currentGroup || !currentItem) return null
  const isVideoStory = currentItem.mediaType === 'video'

  return (
    <div className={styles.stage}>
      <button className={`${styles.closeBtn} ${responsiveStyles.closeBtn}`} onClick={modal.close} aria-label="Đóng">✕</button>
      <div className={`${styles.viewerRow} ${responsiveStyles.viewerRow}`}>
        <button className={`${styles.navBtn} ${responsiveStyles.navBtn}`} onClick={() => startSlide(computePrev(), 'prev')} aria-label="Trước">‹</button>

        <div className={styles.storyShell}>
          <div className={`${styles.storyCard} ${responsiveStyles.storyCard}`}>
            {!isArchiveMode ? (
              <div className={styles.progressRow}>
                {bars.map((v, idx) => (
                  <div key={idx} className={styles.barTrack}>
                    <div className={styles.barFill} style={{ transform: `scaleX(${v})` }} />
                  </div>
                ))}
              </div>
            ) : null}

            <div className={`${styles.header} ${responsiveStyles.header}`}>
              <div className={styles.headerLeft}>
                <img className={styles.headerAvatar} src={avatarOf(currentGroup.username, currentGroup.avatarUrl)} alt="" onError={(event) => handleAvatarError(event, currentGroup.username)} />
                <div className={styles.headerMeta}>
                  <div className={styles.headerUserRow}>
                    <span className={styles.headerUser}>{currentGroup.username}</span>
                    <span className={styles.headerTime}>{timeLabel(currentItem.createdAt)}</span>
                    {currentItem.isArchived ? <span className={styles.headerBadge}>Archive</span> : null}
                  </div>
                </div>
              </div>

              <div className={styles.headerActions}>
                {isVideoStory ? (
                  <button className={styles.circleBtn} onClick={() => setMuted((value) => !value)} aria-label="Toggle sound">
                    {muted ? '🔇' : '🔊'}
                  </button>
                ) : null}
                {!isArchiveMode ? (
                  <button className={styles.circleBtn} onClick={() => setPaused((value) => !value)} aria-label="Toggle pause">
                    {paused ? '▶' : '❚❚'}
                  </button>
                ) : null}
                <div className={styles.menuWrap} ref={menuRef}>
                  <button className={styles.circleBtn} onClick={() => setMenuOpen((value) => !value)} aria-label="More">⋯</button>
                  {menuOpen ? (
                    <div className={styles.menu}>
                      {isOwner ? (
                        <button className={styles.menuDanger} onClick={handleDelete}>Xóa story</button>
                      ) : (
                        <button className={styles.menuItem} onClick={handleHide}>Ẩn story này</button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div
              className={`${styles.content} ${responsiveStyles.content}`}
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                const x = e.clientX - rect.left
                if (x < rect.width * 0.28) startSlide(computePrev(), 'prev')
                else if (x > rect.width * 0.72) startSlide(computeNext(), 'next')
              }}
            >
              <div
                className={[styles.slideStage, dir === 'next' ? styles.dirNext : styles.dirPrev, phase === 'run' ? styles.run : '']
                  .filter(Boolean)
                  .join(' ')}
                style={{ ['--slideMs' as never]: `${SLIDE_MS}ms` }}
              >
                <div className={styles.paneCurrent}>{renderMedia(currentItem)}</div>
                {incoming ? <div className={styles.paneIncoming}>{renderMedia(incoming.item)}</div> : null}
              </div>
            </div>

            {isOwner && viewerPanelOpen ? (
              <div className={styles.viewerPanel}>
                <div className={styles.viewerPanelHead}>
                  <span>Nguoi da xem</span>
                  <span>{viewerLoading ? '...' : `${viewerCount}`}</span>
                </div>
                <div className={styles.viewerList}>
                  {!viewerLoading && !viewerItems.length ? <div className={styles.viewerEmpty}>Chưa có lượt xem.</div> : null}
                  {viewerItems.map((viewer) => (
                    <div key={`${viewer.userId}-${viewer.viewedAt || ''}`} className={styles.viewerRowItem}>
                      <img className={styles.viewerAvatar} src={avatarOf(viewer.username, viewer.avatarUrl)} alt={viewer.username} onError={(event) => handleAvatarError(event, viewer.username)} />
                      <div className={styles.viewerMeta}>
                        <div className={styles.viewerName}>{viewer.username}</div>
                        <div className={styles.viewerTime}>{timeLabel(viewer.viewedAt || undefined)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={`${styles.footer} ${responsiveStyles.footer}`}>
              {isOwner ? (
                <div className={styles.ownerFooter}>
                  <button className={styles.viewerToggle} type="button" onClick={() => setViewerPanelOpen((value) => !value)}>
                    {viewerLoading ? 'Đang tải...' : `${viewerCount} lượt xem`}
                  </button>
                  <div className={styles.ownerMetaPill}>{currentItem.isArchived ? 'Đã lưu trữ' : 'Tự động lưu sau 10 phút'}</div>
                </div>
              ) : (
                <>
                  <input
                    className={`${styles.replyBox} ${responsiveStyles.replyBox}`}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={`Trả lời ${currentGroup.username}...`}
                  />
                  <button className={styles.footerIcon} onClick={handleLike} aria-label="Thích story">
                    {currentItem.likedByMe ? '♥' : '♡'}
                  </button>
                  <button className={styles.footerIcon} onClick={handleReply} aria-label="Gửi phản hồi">↗</button>
                </>
              )}
            </div>
          </div>

          {sideGroups.length && !isArchiveMode ? (
            <div className={`${styles.sideRail} ${responsiveStyles.sideRail}`}>
              {sideGroups.map(({ group, index }) => (
                <button key={group.id} className={`${styles.sideCard} ${responsiveStyles.sideCard}`} onClick={() => startSlide({ groupIndex: index, itemIndex: getStartStoryIndex(group) }, 'next')}>
                  <div className={styles.sideOverlay} />
                  <img className={styles.sideMedia} src={group.stories[0]?.thumbnailUrl || group.stories[0]?.mediaUrl} alt={group.username} />
                  <div className={styles.sideMeta}>
                    <img className={styles.sideAvatar} src={avatarOf(group.username, group.avatarUrl)} alt="" onError={(event) => handleAvatarError(event, group.username)} />
                    <div className={`${styles.sideUser} ${responsiveStyles.sideUser}`}>{group.username}</div>
                    <div className={styles.sideTime}>{timeLabel(group.stories[0]?.createdAt)}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button className={`${styles.navBtn} ${responsiveStyles.navBtn}`} onClick={() => startSlide(computeNext(), 'next')} aria-label="Sau">›</button>
      </div>
    </div>
  )
}

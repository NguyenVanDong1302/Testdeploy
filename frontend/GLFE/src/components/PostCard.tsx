import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveMediaUrl } from '../lib/api'
import { getAvatarUrl } from '../lib/avatar'
import { Post } from '../types'

const ICON_MUTE = '\uD83D\uDD07'
const ICON_UNMUTE = '\uD83D\uDD0A'
const ICON_COMMENT = '\uD83D\uDCAC'
const ICON_HEART_FILLED = '\u2665'
const ICON_HEART_OUTLINE = '\u2661'
const ICON_ELLIPSIS = '\u2022\u2022\u2022'
const ICON_PLAY = '\u25B6'
const ICON_PREV = '\u2039'
const ICON_NEXT = '\u203A'

type NormalizedMedia = {
  type: 'image' | 'video'
  url: string
}

type PostCardLayoutMode = 'default' | 'screen-fit'

function detectMediaType(item: any): 'image' | 'video' | null {
  const type = String(item?.type || '').toLowerCase()
  const mime = String(item?.mimeType || '').toLowerCase()
  const url = String(item?.url || item || '').toLowerCase()

  if (type === 'video' || mime.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v)$/i.test(url)) {
    return 'video'
  }
  if (type === 'image' || mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(url)) {
    return 'image'
  }
  return null
}

function getPostMedia(post: Post): NormalizedMedia[] {
  const list: NormalizedMedia[] = []

  if (Array.isArray(post.media)) {
    for (const item of post.media) {
      const type = detectMediaType(item)
      const url = resolveMediaUrl(item?.url)
      if (!type || !url) continue
      list.push({ type, url })
    }
  }

  if (!list.length && post.imageUrl) {
    const url = resolveMediaUrl(post.imageUrl)
    const type = detectMediaType({ url }) || 'image'
    list.push({ type, url })
  }

  return list
}

function MediaVideo({
  src,
  active,
  frameStyle,
  mediaStyle,
}: {
  src: string
  active: boolean
  frameStyle?: React.CSSProperties
  mediaStyle?: React.CSSProperties
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting && entry.intersectionRatio >= 0.6)
      },
      { threshold: [0.2, 0.4, 0.6, 0.8] },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const shouldPlay = active && inView

    const run = async () => {
      try {
        if (shouldPlay) {
          video.muted = muted
          await video.play()
          setPlaying(true)
        } else {
          video.pause()
          setPlaying(false)
        }
      } catch {
        setPlaying(!video.paused)
      }
    }

    run()
  }, [active, inView, muted])

  const togglePlay = async () => {
    const video = videoRef.current
    if (!video) return
    try {
      if (video.paused) {
        await video.play()
        setPlaying(true)
      } else {
        video.pause()
        setPlaying(false)
      }
    } catch {
      setPlaying(!video.paused)
    }
  }

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !muted
    setMuted(next)
    if (videoRef.current) {
      videoRef.current.muted = next
    }
  }

  return (
    <div ref={wrapRef} style={{ ...styles.mediaFrame, ...(frameStyle || {}) }}>
      <video
        ref={videoRef}
        src={src}
        playsInline
        muted={muted}
        preload="metadata"
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        style={{ ...styles.videoMedia, ...(mediaStyle || {}) }}
      />
      <button type="button" onClick={toggleMute} style={styles.muteBtn}>
        {muted ? ICON_MUTE : ICON_UNMUTE}
      </button>

      {!playing && (
        <div style={styles.playOverlay} onClick={togglePlay}>
          {ICON_PLAY}
        </div>
      )}
    </div>
  )
}

function MediaSlider({
  media,
  frameStyle,
  mediaStyle,
}: {
  media: NormalizedMedia[]
  frameStyle?: React.CSSProperties
  mediaStyle?: React.CSSProperties
}) {
  const [index, setIndex] = useState(0)
  const total = media.length

  useEffect(() => {
    setIndex(0)
  }, [total])

  if (!media.length) return null

  const canSlide = total > 1
  const prev = () => setIndex((v) => (v - 1 + total) % total)
  const next = () => setIndex((v) => (v + 1) % total)

  return (
    <div style={{ marginTop: 12 }}>
      <div style={styles.sliderWrap}>
        <div
          style={{
            ...styles.sliderTrack,
            width: `${total * 100}%`,
            transform: `translate3d(-${index * (100 / total)}%, 0, 0)`,
          }}
        >
          {media.map((item, i) => (
            <div key={`${item.url}-${i}`} style={{ ...styles.slide, width: `${100 / total}%` }}>
              {item.type === 'video' ? (
                <MediaVideo src={item.url} active={i === index} frameStyle={frameStyle} mediaStyle={mediaStyle} />
              ) : (
                <div style={{ ...styles.mediaFrame, ...(frameStyle || {}) }}>
                  <img src={item.url} alt="post" style={{ ...styles.imageMedia, ...(mediaStyle || {}) }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {canSlide && (
          <>
            <button type="button" onClick={prev} style={{ ...styles.navBtn, left: 12 }}>
              {ICON_PREV}
            </button>
            <button type="button" onClick={next} style={{ ...styles.navBtn, right: 12 }}>
              {ICON_NEXT}
            </button>
          </>
        )}
      </div>

      {canSlide && (
        <div style={styles.dots}>
          {media.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              style={{
                ...styles.dot,
                opacity: i === index ? 1 : 0.35,
                transform: i === index ? 'scale(1.15)' : 'scale(1)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function PostCard({
  post,
  layout = 'default',
  likePending,
  commentPending,
  followPending,
  reportPending,
  showFollowButton,
  showHeaderFollowButton = false,
  showBottomFollowButton = true,
  following,
  onLike,
  onOpenComment,
  onOpenDetail,
  onOpenAuthor,
  onToggleFollow,
  onEdit,
  onDelete,
  onReport,
}: {
  post: Post
  layout?: PostCardLayoutMode
  likePending?: boolean
  commentPending?: boolean
  followPending?: boolean
  reportPending?: boolean
  showFollowButton?: boolean
  showHeaderFollowButton?: boolean
  showBottomFollowButton?: boolean
  following?: boolean
  onLike: () => void
  onOpenComment: () => void
  onOpenDetail: () => void
  onOpenAuthor: () => void
  onToggleFollow?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onReport?: (reason: string) => void
}) {
  const likesCount = post.likesCount ?? (Array.isArray(post.likes) ? post.likes.length : 0)
  const likedByMe = !!post.likedByMe
  const commentsCount = post.commentsCount ?? 0
  const media = useMemo(() => getPostMedia(post), [post])
  const isScreenFit = layout === 'screen-fit'
  const [heartBurst, setHeartBurst] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!likedByMe) return
    setHeartBurst(true)
    const timer = window.setTimeout(() => setHeartBurst(false), 520)
    return () => window.clearTimeout(timer)
  }, [likedByMe])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (menuRef.current && target && !menuRef.current.contains(target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const handleReport = () => {
    if (!onReport || reportPending) return
    const reason = window.prompt('Nhap ly do bao cao bai viet', 'Noi dung khong phu hop')
    if (!reason || !reason.trim()) return
    onReport(reason.trim())
    setMenuOpen(false)
  }

  return (
    <div style={{ ...styles.post, ...(isScreenFit ? styles.postScreenFit : null) }}>
      <div style={styles.header}>
        <div style={styles.userBlock}>
          <img style={styles.avatarImg} src={getAvatarUrl({ username: post.authorUsername, authorAvatarUrl: (post as any).authorAvatarUrl })} alt={post.authorUsername || 'user'} />
          <div style={styles.userTextBlock}>
            <div style={styles.usernameRow}>
              <div style={styles.username} onClick={onOpenAuthor}>
                {post.authorUsername || post.authorId || 'user'}
              </div>
              {post.authorVerified ? (
                <span style={styles.verifiedBadge} title="Tài khoản đã xác thực">
                  ✓
                </span>
              ) : null}
            </div>
            <div style={styles.metaText}>
              {post.createdAt ? new Date(post.createdAt).toLocaleString('vi-VN') : 'V\u1EEBa xong'}
            </div>
          </div>
        </div>

        <div style={styles.headerActions}>
          {showHeaderFollowButton && showFollowButton && onToggleFollow ? (
            <button
              type="button"
              style={{
                ...styles.headerFollowBtn,
                ...(followPending ? styles.buttonPending : null),
              }}
              onClick={onToggleFollow}
              disabled={!!followPending}
            >
              {followPending ? 'Đang theo dõi...' : 'Theo dõi'}
            </button>
          ) : null}

          <div style={styles.moreWrap} ref={menuRef}>
            <button type="button" style={styles.moreBtn} onClick={() => setMenuOpen((prev) => !prev)}>
              {ICON_ELLIPSIS}
            </button>
            {menuOpen ? (
              <div style={styles.menu}>
                {showFollowButton && onToggleFollow ? (
                  <button type="button" style={styles.menuBtn} disabled={!!followPending} onClick={() => { onToggleFollow(); setMenuOpen(false) }}>
                    {followPending ? 'Đang xử lý...' : following ? 'Bỏ theo dõi' : 'Theo dõi'}
                  </button>
                ) : null}
                {onReport ? (
                  <button type="button" style={styles.menuBtn} disabled={!!reportPending} onClick={handleReport}>
                    {reportPending ? 'Đang gửi...' : 'Báo cáo bài viết'}
                  </button>
                ) : null}
                {onDelete ? (
                  <button
                    type="button"
                    style={{ ...styles.menuBtn, ...styles.menuDanger }}
                    onClick={() => {
                      onDelete()
                      setMenuOpen(false)
                    }}
                  >
                    Xoa bai viet
                  </button>
                ) : null}
                {onEdit ? (
                  <button
                    type="button"
                    style={styles.menuBtn}
                    onClick={() => {
                      onEdit()
                      setMenuOpen(false)
                    }}
                  >
                    Chinh sua bai viet
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {post.content && <div style={styles.content}>{post.content}</div>}

      <MediaSlider
        media={media}
        frameStyle={isScreenFit ? styles.mediaFrameScreenFit : undefined}
        mediaStyle={isScreenFit ? styles.mediaContentScreenFit : undefined}
      />

      <div style={styles.actions}>
        <button
          style={{
            ...styles.likeBtn,
            ...(likedByMe ? styles.likeBtnActive : null),
            ...(likePending ? styles.buttonPending : null),
            transform: heartBurst ? 'scale(1.06)' : 'scale(1)',
          }}
          onClick={onLike}
          disabled={!!likePending}
        >
          <span style={{ ...styles.iconPulse, transform: heartBurst ? 'scale(1.3)' : 'scale(1)' }}>
            {likedByMe ? ICON_HEART_FILLED : ICON_HEART_OUTLINE}
          </span>
          <span>{likesCount}</span>
        </button>
        <button
          style={{
            ...styles.actionBtn,
            ...(commentPending ? styles.buttonPending : null),
          }}
          onClick={onOpenComment}
          disabled={!!commentPending}
        >
          <span>{ICON_COMMENT}</span>
          <span>{commentsCount}</span>
        </button>
        {showBottomFollowButton && showFollowButton && onToggleFollow ? (
          <button
            style={{
              ...styles.actionBtn,
              ...(followPending ? styles.buttonPending : null),
            }}
            onClick={onToggleFollow}
            disabled={!!followPending}
          >
            {following ? 'Đang theo dõi' : 'Theo dõi'}
          </button>
        ) : null}
        {/* <button style={{ ...styles.actionBtn, marginLeft: 'auto' }} onClick={onOpenDetail}>
          Xem chi ti\u1EBFt
        </button> */}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  post: {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    background: '#fff',
    border: '1px solid #e7e7e7',
    borderRadius: 18,
    padding: 14,
    marginBottom: 18,
    boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
  },
  postScreenFit: {
    padding: 12,
    borderRadius: 14,
    marginBottom: 14,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minWidth: 0,
  },
  userBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    flex: '1 1 auto',
  },
  userTextBlock: {
    minWidth: 0,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #f9ce34 0%, #ee2a7b 45%, #6228d7 100%)',
    padding: 2,
    position: 'relative',
  },
  avatarImg: {
    width: 38,
    height: 38,
    minWidth: 38,
    borderRadius: '50%',
    display: 'block',
    objectFit: 'cover',
    background: '#d8dde6',
    overflow: 'hidden',
    flex: '0 0 38px',
  },
  username: {
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
    lineHeight: 1.2,
    minWidth: 0,
    flex: '1 1 auto',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  usernameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: '50%',
    background: '#1d9bf0',
    color: '#fff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
    userSelect: 'none',
  },
  metaText: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  headerFollowBtn: {
    border: 'none',
    background: 'transparent',
    color: '#1877f2',
    fontSize: 14,
    fontWeight: 700,
    padding: '6px 8px',
    borderRadius: 10,
    cursor: 'pointer',
  },
  moreWrap: {
    position: 'relative',
  },
  moreBtn: {
    border: 'none',
    background: 'transparent',
    fontSize: 18,
    color: '#444',
    padding: '4px 8px',
    borderRadius: 8,
    userSelect: 'none',
    cursor: 'pointer',
  },
  menu: {
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 6px)',
    minWidth: 180,
    display: 'grid',
    gap: 4,
    padding: 6,
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    background: '#fff',
    boxShadow: '0 12px 28px rgba(0,0,0,0.12)',
    zIndex: 10,
  },
  menuBtn: {
    border: 'none',
    background: '#f8fafc',
    color: '#111827',
    borderRadius: 10,
    padding: '8px 10px',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
  },
  menuDanger: {
    background: '#fef2f2',
    color: '#b91c1c',
  },
  content: {
    marginTop: 10,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    lineHeight: 1.5,
    fontSize: 15,
    color: '#111',
  },
  sliderWrap: {
    position: 'relative',
    borderRadius: 16,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  sliderTrack: {
    display: 'flex',
    transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'transform',
  },
  slide: {
    flex: '0 0 auto',
    minWidth: 0,
  },
  mediaFrame: {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    aspectRatio: '4 / 5',
    background: '#0b1220',
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaFrameScreenFit: {
    aspectRatio: '16 / 10',
    maxHeight: 'min(62vh, 560px)',
  },
  imageMedia: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    background: '#0b1220',
  },
  mediaContentScreenFit: {
    objectFit: 'contain',
  },
  videoMedia: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    background: '#0b1220',
  },
  navBtn: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(255,255,255,0.92)',
    color: '#111',
    fontSize: 28,
    lineHeight: '36px',
    textAlign: 'center' as const,
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
    zIndex: 3,
  },
  dots: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    border: 'none',
    background: '#4f46e5',
    cursor: 'pointer',
    padding: 0,
    transition: 'all 220ms ease',
  },
  muteBtn: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 38,
    height: 38,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    fontSize: 18,
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    zIndex: 2,
  },
  playOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    fontSize: 52,
    color: '#fff',
    background: 'linear-gradient(to top, rgba(0,0,0,0.16), rgba(0,0,0,0.04))',
    cursor: 'pointer',
    userSelect: 'none',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  actionBtn: {
    border: 'none',
    background: '#f5f5f7',
    borderRadius: 999,
    padding: '10px 14px',
    fontSize: 14,
    cursor: 'pointer',
    color: '#111',
    display: 'inline-flex',
    gap: 8,
    alignItems: 'center',
    transition: 'transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease',
  },
  likeBtn: {
    border: 'none',
    background: '#fff1f2',
    borderRadius: 999,
    padding: '10px 14px',
    fontSize: 14,
    cursor: 'pointer',
    color: '#be123c',
    display: 'inline-flex',
    gap: 8,
    alignItems: 'center',
    fontWeight: 700,
    boxShadow: '0 8px 18px rgba(225, 29, 72, 0.08)',
    transition: 'transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease',
  },
  likeBtnActive: {
    background: 'linear-gradient(135deg, #ffe4e6, #fdf2f8)',
    boxShadow: '0 14px 24px rgba(225, 29, 72, 0.12)',
  },
  buttonPending: {
    opacity: 0.7,
    cursor: 'not-allowed',
  },
  iconPulse: {
    display: 'inline-block',
    transition: 'transform 220ms ease',
  },
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import CommentSheet from '../components/comments/CommentSheet'
import { useModal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { combineResponsiveStyles } from '../lib/combineResponsiveStyles'
import { resolveMediaUrl, useApi } from '../lib/api'
import type { Post } from '../types'
import styles from './ExplorePage.module.css'
import desktopStyles from './ExplorePage.desktop.module.css'
import tabletStyles from './ExplorePage.tablet.module.css'
import mobileStyles from './ExplorePage.mobile.module.css'

const MOBILE_SEARCH_LAYOUT_QUERY = '(max-width: 768px)'

type PreviewMedia = {
  type: 'image' | 'video'
  src: string
  thumbnailSrc?: string
  hasMultiple: boolean
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

function getMobileLayoutMatches() {
  if (typeof window === 'undefined') return false
  return window.matchMedia(MOBILE_SEARCH_LAYOUT_QUERY).matches
}

function detectMediaType(item: any): 'image' | 'video' | null {
  const type = String(item?.type || '').toLowerCase()
  const mime = String(item?.mimeType || '').toLowerCase()
  const url = String(item?.url || '').toLowerCase()

  if (type === 'video' || mime.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v)$/i.test(url)) return 'video'
  if (type === 'image' || mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(url)) return 'image'
  return null
}

function getPreviewMedia(post: Post): PreviewMedia | null {
  const items = Array.isArray(post.media) ? post.media : []
  const normalized = items
    .map((item) => {
      const type = detectMediaType(item)
      const src = resolveMediaUrl(item?.url)
      const thumbnailSrc = resolveMediaUrl(item?.thumbnailUrl)
      if (!type || !src) return null
      return { type, src, thumbnailSrc }
    })
    .filter(Boolean) as Array<{ type: 'image' | 'video'; src: string; thumbnailSrc?: string }>

  if (normalized.length) {
    const first = normalized[0]
    return {
      type: first.type,
      src: first.src,
      thumbnailSrc: first.type === 'image' ? first.src : first.thumbnailSrc,
      hasMultiple: normalized.length > 1,
    }
  }

  if (post.imageUrl) {
    const src = resolveMediaUrl(post.imageUrl)
    if (!src) return null
    return {
      type: detectMediaType({ url: src }) || 'image',
      src,
      thumbnailSrc: src,
      hasMultiple: false,
    }
  }

  return null
}

export default function ExplorePage() {
  const api = useApi()
  const modal = useModal()
  const toast = useToast()

  const [redirectToSearch, setRedirectToSearch] = useState(getMobileLayoutMatches)
  const [items, setItems] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [error, setError] = useState('')

  const loadPosts = useCallback(
    async (nextPage: number) => {
      setLoading(true)
      setError('')
      try {
        const response = await api.get(
          `/posts?page=${nextPage}&limit=30&visibility=public&sort=engagement_desc&mediaOnly=true`,
        )
        const payload = response?.data || {}
        setItems(Array.isArray(payload.items) ? payload.items : [])
        setTotalPages(Math.max(Number(payload.totalPages) || 1, 1))
      } catch (err: any) {
        const message = err?.message || 'Không tải được dữ liệu khám phá'
        setError(message)
        toast.push(message)
      } finally {
        setLoading(false)
      }
    },
    [api, toast],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const mediaQuery = window.matchMedia(MOBILE_SEARCH_LAYOUT_QUERY)
    const handleChange = (event?: MediaQueryListEvent) => {
      setRedirectToSearch(event?.matches ?? mediaQuery.matches)
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
    if (redirectToSearch) return
    void loadPosts(page)
  }, [loadPosts, page, redirectToSearch])

  const exploreItems = useMemo(() => {
    return items
      .map((post) => {
        const preview = getPreviewMedia(post)
        if (!preview) return null
        const likesCount = Number(post.likesCount || (Array.isArray(post.likes) ? post.likes.length : 0))
        const commentsCount = Number(post.commentsCount || 0)
        return {
          post,
          preview,
          likesCount,
          commentsCount,
          engagementCount: likesCount + commentsCount,
        }
      })
      .filter(Boolean) as Array<{
      post: Post
      preview: PreviewMedia
      likesCount: number
      commentsCount: number
      engagementCount: number
    }>
  }, [items])

  const openPostPopup = (post: Post) => {
    void api.post(`/posts/${post._id}/view`, {}).catch(() => undefined)
    modal.open(
      <CommentSheet
        postId={post._id}
        onChanged={(count) =>
          setItems((prev) =>
            prev.map((item) =>
              item._id === post._id
                ? {
                    ...item,
                    commentsCount: count,
                  }
                : item,
            ),
          )
        }
      />,
    )
  }

  if (redirectToSearch) return <Navigate to="/search" replace />

  return (
    <section className={cx(styles.page, responsiveStyles.page)}>
      <header className={cx(styles.header, responsiveStyles.header)}>
        <div>
          <h1 className={styles.title}>Explore</h1>
          <p className={styles.subtitle}>Danh sach bai viet image/video co tuong tac cao</p>
        </div>
      </header>

      {error ? (
        <div className={styles.stateBox}>
          <div>{error}</div>
          <button type="button" className={styles.retryBtn} onClick={() => void loadPosts(page)}>
            Thu lai
          </button>
        </div>
      ) : null}

      {!error && loading && !exploreItems.length ? <div className={styles.stateBox}>Đang tải bài viết khám phá...</div> : null}

      {!loading && !error && !exploreItems.length ? <div className={styles.stateBox}>Chưa có bài viết media nào để hiển thị.</div> : null}

      {exploreItems.length ? (
        <div className={cx(styles.grid, responsiveStyles.grid)}>
          {exploreItems.map((item) => {
            return (
              <button
                key={item.post._id}
                type="button"
                className={cx(styles.tile, responsiveStyles.tile)}
                onClick={() => openPostPopup(item.post)}
                title={`@${item.post.authorUsername || 'user'} - ${item.engagementCount} tuong tac`}
              >
                {item.preview.type === 'video' ? (
                  item.preview.thumbnailSrc ? (
                    <img className={styles.media} src={item.preview.thumbnailSrc} alt={item.post.content || 'explore post'} />
                  ) : (
                    <video className={styles.media} src={item.preview.src} muted playsInline preload="metadata" />
                  )
                ) : (
                  <img className={styles.media} src={item.preview.src} alt={item.post.content || 'explore post'} />
                )}

                <div className={styles.overlayTop}>
                  {item.preview.type === 'video' ? (
                    <span className={styles.badge} aria-label="bai viet video">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="3" />
                        <polygon points="10,8 16,12 10,16" />
                      </svg>
                    </span>
                  ) : (
                    <span className={styles.badge} aria-label="bai viet anh">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4" y="5" width="16" height="14" rx="2.5" />
                        <circle cx="10" cy="10" r="1.8" />
                        <path d="M6.5 17l4.2-4.8 3.2 2.9 2.7-2.4 2.9 4.3z" />
                      </svg>
                    </span>
                  )}
                  {item.preview.hasMultiple ? (
                    <span className={styles.badge} aria-label="post nhieu media">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="8" y="4" width="12" height="12" rx="2" />
                        <rect x="4" y="8" width="12" height="12" rx="2" />
                      </svg>
                    </span>
                  ) : null}
                </div>

                <div className={cx(styles.overlayBottom, responsiveStyles.overlayBottom)}>
                  <span className={cx(styles.statItem, responsiveStyles.statItem)}>
                    <svg className={cx(styles.statIcon, responsiveStyles.statIcon)} viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 21s-7-4.4-9.3-8.1C.8 9.9 2.1 6 6 6c2.2 0 3.5 1.3 4 2.1C10.5 7.3 11.8 6 14 6c3.9 0 5.2 3.9 3.3 6.9C19 16.6 12 21 12 21z" />
                    </svg>
                    <span>{item.likesCount}</span>
                  </span>
                  <span className={cx(styles.statItem, responsiveStyles.statItem)}>
                    <svg className={cx(styles.statIcon, responsiveStyles.statIcon)} viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
                    </svg>
                    <span>{item.commentsCount}</span>
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className={cx(styles.pagination, responsiveStyles.pagination)}>
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Truoc
          </button>
          <span className={cx(styles.pageInfo, responsiveStyles.pageInfo)}>
            Trang {page}/{totalPages}
          </span>
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page >= totalPages || loading}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          >
            Sau
          </button>
        </div>
      ) : null}
    </section>
  )
}

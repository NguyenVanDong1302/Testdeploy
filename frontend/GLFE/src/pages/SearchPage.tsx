import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import CommentSheet from '../components/comments/CommentSheet'
import { useModal } from '../components/Modal'
import { useUsersApi, type UserSummary } from '../features/users/users.api'
import { combineResponsiveStyles } from '../lib/combineResponsiveStyles'
import { resolveMediaUrl, useApi } from '../lib/api'
import type { Post } from '../types'
import styles from './SearchPage.module.css'
import desktopStyles from './SearchPage.desktop.module.css'
import tabletStyles from './SearchPage.tablet.module.css'
import mobileStyles from './SearchPage.mobile.module.css'

const MOBILE_LAYOUT_QUERY = '(max-width: 768px)'

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
  return window.matchMedia(MOBILE_LAYOUT_QUERY).matches
}

function avatarOf(user?: Pick<UserSummary, 'avatarUrl' | 'username'> | null) {
  const resolved = resolveMediaUrl(user?.avatarUrl)
  if (resolved) return resolved
  const seed = encodeURIComponent(user?.username || 'user')
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${seed}`
}

function normalize(value?: string | null) {
  return String(value || '').trim().toLowerCase()
}

function matchUser(user: UserSummary, query: string) {
  const keyword = normalize(query)
  if (!keyword) return true
  const username = normalize(user.username)
  const bio = normalize(user.bio)
  const email = normalize(user.email)
  return username.includes(keyword) || bio.includes(keyword) || email.includes(keyword)
}

function scoreUser(user: UserSummary, query: string) {
  const keyword = normalize(query)
  if (!keyword) return 0
  const username = normalize(user.username)
  const bio = normalize(user.bio)
  const email = normalize(user.email)
  let score = 0
  if (username === keyword) score += 1000
  if (username.startsWith(keyword)) score += 600
  if (username.includes(keyword)) score += 320
  if (bio.startsWith(keyword)) score += 150
  if (bio.includes(keyword)) score += 90
  if (email.startsWith(keyword)) score += 120
  if (email.includes(keyword)) score += 70
  return score
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
  const normalizedItems = items
    .map((item) => {
      const type = detectMediaType(item)
      const src = resolveMediaUrl(item?.url)
      const thumbnailSrc = resolveMediaUrl(item?.thumbnailUrl)
      if (!type || !src) return null
      return { type, src, thumbnailSrc }
    })
    .filter(Boolean) as Array<{ type: 'image' | 'video'; src: string; thumbnailSrc?: string }>

  if (normalizedItems.length) {
    const first = normalizedItems[0]
    return {
      type: first.type,
      src: first.src,
      thumbnailSrc: first.type === 'image' ? first.src : first.thumbnailSrc,
      hasMultiple: normalizedItems.length > 1,
    }
  }

  if (!post.imageUrl) return null
  const src = resolveMediaUrl(post.imageUrl)
  if (!src) return null
  return {
    type: detectMediaType({ url: src }) || 'image',
    src,
    thumbnailSrc: src,
    hasMultiple: false,
  }
}

function isTallTile(index: number) {
  const cycleIndex = index % 12
  return cycleIndex === 2 || cycleIndex === 6 || cycleIndex === 11
}

export default function SearchPage() {
  const usersApi = useUsersApi()
  const api = useApi()
  const modal = useModal()
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [isMobile, setIsMobile] = useState(getMobileLayoutMatches)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserSummary[]>([])
  const [error, setError] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const [exploreLoading, setExploreLoading] = useState(false)
  const [exploreError, setExploreError] = useState('')
  const [explorePosts, setExplorePosts] = useState<Post[]>([])

  const handleClose = useCallback(() => {
    if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1)
      return
    }
    navigate('/')
  }, [location.key, navigate])

  const handleCancelSearch = useCallback(() => {
    setSearchActive(false)
    setQuery('')
    inputRef.current?.blur()
  }, [])

  const openPostPopup = useCallback(
    (post: Post) => {
      void api.post(`/posts/${post._id}/view`, {}).catch(() => undefined)
      modal.open(<CommentSheet postId={post._id} />)
    },
    [api, modal],
  )

  const loadExplorePosts = useCallback(async () => {
    setExploreLoading(true)
    setExploreError('')
    try {
      const response = await api.get('/posts?page=1&limit=30&visibility=public&sort=engagement_desc&mediaOnly=true')
      const payload = response?.data || {}
      setExplorePosts(Array.isArray(payload.items) ? payload.items : [])
    } catch (err: any) {
      setExploreError(err?.message || 'Không tải được dữ liệu khám phá')
    } finally {
      setExploreLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY)
    const handleChange = (event?: MediaQueryListEvent) => {
      setIsMobile(event?.matches ?? mediaQuery.matches)
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
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const items = await usersApi.getAllUsers()
        if (!mounted) return
        setUsers(items)
      } catch (err: any) {
        if (!mounted) return
        setError(err?.message || 'Không tải được danh sách người dùng')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [usersApi])

  useEffect(() => {
    if (!isMobile) return
    void loadExplorePosts()
  }, [isMobile, loadExplorePosts])

  const results = useMemo(() => {
    const keyword = normalize(query)
    return [...users]
      .filter((user) => matchUser(user, keyword))
      .sort((a, b) => {
        const scoreDiff = scoreUser(b, keyword) - scoreUser(a, keyword)
        if (scoreDiff !== 0) return scoreDiff
        return a.username.localeCompare(b.username, 'vi')
      })
      .slice(0, 50)
  }, [users, query])

  const exploreItems = useMemo(() => {
    return explorePosts
      .map((post) => {
        const preview = getPreviewMedia(post)
        if (!preview) return null
        return { post, preview }
      })
      .filter(Boolean) as Array<{ post: Post; preview: PreviewMedia }>
  }, [explorePosts])

  const listTitle = query.trim() ? 'Kết quả tìm kiếm' : 'Gợi ý cho bạn'

  return (
    <div className={cx(styles.overlay, responsiveStyles.overlay)} onClick={isMobile ? undefined : handleClose}>
      <section className={cx(styles.popup, responsiveStyles.popup)} onClick={(event) => (isMobile ? undefined : event.stopPropagation())}>
        <div className={cx(styles.header, responsiveStyles.header)}>
          <h1 className={styles.title}>Tìm kiếm</h1>
          <button type="button" className={styles.closeBtn} onClick={handleClose}>
            x
          </button>
        </div>

        <div className={cx(styles.searchBox, responsiveStyles.searchBox)}>
          <div className={responsiveStyles.mobileSearchField}>
            <span className={responsiveStyles.searchIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <line x1="16.65" y1="16.65" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchActive(true)}
              onClick={() => setSearchActive(true)}
              placeholder="Tìm kiếm"
              className={cx(styles.input, responsiveStyles.input)}
              autoFocus={!isMobile}
            />
            {query ? (
              <button
                type="button"
                className={cx(styles.clearBtn, responsiveStyles.clearBtn)}
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
              >
                x
              </button>
            ) : null}
          </div>

          {isMobile && searchActive ? (
            <button type="button" className={responsiveStyles.cancelBtn} onClick={handleCancelSearch}>
              Huy
            </button>
          ) : null}
        </div>

        {!isMobile || searchActive ? (
          <div className={cx(styles.list, isMobile && responsiveStyles.mobileList, isMobile && responsiveStyles.resultsPanel)}>
            {isMobile ? <div className={responsiveStyles.listHeading}>{listTitle}</div> : null}
            {loading ? <div className={styles.state}>Đang tải người dùng...</div> : null}
            {!loading && error ? <div className={styles.state}>{error}</div> : null}
            {!loading && !error && !results.length ? <div className={styles.state}>Không tìm thấy người dùng phù hợp.</div> : null}

            {!loading && !error
              ? results.map((user) => (
                  <button
                    key={user._id}
                    type="button"
                    className={styles.item}
                    onClick={() => navigate(`/profile/${encodeURIComponent(user.username)}`)}
                  >
                    <img className={styles.avatar} src={avatarOf(user)} alt={user.username} />
                    <div className={styles.meta}>
                      <div className={styles.username}>{user.username}</div>
                      <div className={styles.subtext}>{user.bio || user.email || 'Nguoi dung T clone'}</div>
                    </div>
                  </button>
                ))
              : null}
          </div>
        ) : null}

        {isMobile && !searchActive ? (
          <div className={cx(responsiveStyles.explorePanel, responsiveStyles.mobileSurface)}>
            {exploreLoading && !exploreItems.length ? <div className={responsiveStyles.stateBox}>Đang tải bài viết khám phá...</div> : null}
            {!exploreLoading && exploreError ? (
              <div className={responsiveStyles.stateBox}>
                <div>{exploreError}</div>
                <button type="button" className={responsiveStyles.retryBtn} onClick={() => void loadExplorePosts()}>
                  Thu lai
                </button>
              </div>
            ) : null}
            {!exploreLoading && !exploreError && !exploreItems.length ? (
              <div className={responsiveStyles.stateBox}>Chưa có bài viết media nào để hiển thị.</div>
            ) : null}
            {exploreItems.length ? (
              <div className={responsiveStyles.exploreGrid}>
                {exploreItems.map((item, index) => (
                  <button
                    key={item.post._id}
                    type="button"
                    className={cx(responsiveStyles.exploreTile, isTallTile(index) && responsiveStyles.exploreTileTall)}
                    onClick={() => openPostPopup(item.post)}
                    title={`@${item.post.authorUsername || 'user'}`}
                  >
                    {item.preview.type === 'video' ? (
                      item.preview.thumbnailSrc ? (
                        <img className={responsiveStyles.exploreMedia} src={item.preview.thumbnailSrc} alt={item.post.content || 'explore post'} />
                      ) : (
                        <video className={responsiveStyles.exploreMedia} src={item.preview.src} muted playsInline preload="metadata" />
                      )
                    ) : (
                      <img className={responsiveStyles.exploreMedia} src={item.preview.src} alt={item.post.content || 'explore post'} />
                    )}

                    <div className={responsiveStyles.tileBadgeRow}>
                      {item.preview.type === 'video' ? (
                        <span className={responsiveStyles.tileBadge} aria-label="bai viet video">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="4" y="4" width="16" height="16" rx="3" />
                            <polygon points="10,8 16,12 10,16" />
                          </svg>
                        </span>
                      ) : null}
                      {item.preview.hasMultiple ? (
                        <span className={responsiveStyles.tileBadge} aria-label="post nhieu media">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="8" y="4" width="12" height="12" rx="2" />
                            <rect x="4" y="8" width="12" height="12" rx="2" />
                          </svg>
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApi, resolveMediaUrl } from '../lib/api'
import { useToast } from '../components/Toast'
import PostCard from '../components/PostCard'
import CommentSheet from '../components/comments/CommentSheet'
import { useModal } from '../components/Modal'
import type { Post } from '../types'
import styles from './PostPage.module.css'
import desktopStyles from './PostPage.desktop.module.css'
import tabletStyles from './PostPage.tablet.module.css'
import mobileStyles from './PostPage.mobile.module.css'
import { combineResponsiveStyles } from '../lib/combineResponsiveStyles'

type PreviewMedia = {
  type: 'image' | 'video'
  src: string
  thumbnailSrc?: string
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
      thumbnailSrc: first.type === 'video' ? first.thumbnailSrc : first.src,
    }
  }

  if (post.imageUrl) {
    const src = resolveMediaUrl(post.imageUrl)
    if (!src) return null
    return {
      type: detectMediaType({ url: src }) || 'image',
      src,
      thumbnailSrc: src,
    }
  }

  return null
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

export default function PostPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const api = useApi()
  const toast = useToast()
  const modal = useModal()

  const [post, setPost] = useState<Post | null>(null)
  const [loadingPost, setLoadingPost] = useState(false)
  const [suggested, setSuggested] = useState<Post[]>([])
  const [loadingSuggested, setLoadingSuggested] = useState(false)
  const [suggestedError, setSuggestedError] = useState('')

  const loadPost = useCallback(async () => {
    if (!id) {
      setPost(null)
      return
    }

    setLoadingPost(true)
    setPost(null)

    try {
      const res = await api.get(`/posts/${id}`)
      setPost(res?.data?.post || res?.data || null)
    } catch (error: any) {
      setPost(null)
      toast.push(error?.message || 'Không tải được bài viết')
    } finally {
      setLoadingPost(false)
    }
  }, [api, id, toast])

  const loadSuggested = useCallback(
    async (excludePostId: string) => {
      setLoadingSuggested(true)
      setSuggestedError('')

      try {
        const res = await api.get('/posts?page=1&limit=18&visibility=public&sort=engagement_desc&mediaOnly=true')
        const rows = Array.isArray(res?.data?.items) ? res.data.items : []
        setSuggested(rows.filter((item) => String(item?._id || '') !== excludePostId).slice(0, 8))
      } catch (error: any) {
        const message = error?.message || 'Không tải được bài viết đề xuất'
        setSuggestedError(message)
        toast.push(message)
      } finally {
        setLoadingSuggested(false)
      }
    },
    [api, toast],
  )

  useEffect(() => {
    if (!id) return
    void loadPost()
    void loadSuggested(id)
  }, [id, loadPost, loadSuggested])

  useEffect(() => {
    if (!post?._id) return
    const postId = post._id

    void api
      .post(`/posts/${postId}/view`, {})
      .then((res) => {
        const nextPost = res?.data?.post
        if (!nextPost) return
        setPost((curr) => {
          if (!curr || curr._id !== postId) return curr
          return { ...curr, ...nextPost }
        })
      })
      .catch(() => undefined)
  }, [api, post?._id])

  const toggleLike = async () => {
    if (!post) return

    const previous = {
      likedByMe: !!post.likedByMe,
      likesCount: Number(post.likesCount || (Array.isArray(post.likes) ? post.likes.length : 0)),
    }

    const nextLiked = !previous.likedByMe

    setPost((curr) =>
      curr
        ? {
            ...curr,
            likedByMe: nextLiked,
            likesCount: Math.max(0, previous.likesCount + (nextLiked ? 1 : -1)),
          }
        : curr,
    )

    try {
      const res = previous.likedByMe
        ? await api.del(`/posts/${post._id}/like`)
        : await api.post(`/posts/${post._id}/like`, {})

      setPost((curr) => (curr ? { ...curr, ...(res?.data || {}) } : curr))
    } catch (error: any) {
      setPost((curr) => (curr ? { ...curr, ...previous } : curr))
      toast.push(error?.message || 'Không thể cập nhật lượt thích')
    }
  }

  const suggestedItems = useMemo(
    () => suggested.filter((item) => String(item?._id || '') !== String(post?._id || '')),
    [post?._id, suggested],
  )

  return (
    <section className={`${styles.page} ${responsiveStyles.page}`}>
      <div className={styles.mainSection}>
        {loadingPost && !post ? <div className={styles.stateCard}>Đang tải bài viết...</div> : null}
        {!loadingPost && !post ? <div className={styles.stateCard}>Không tìm thấy bài viết.</div> : null}

        {post ? (
          <PostCard
            post={post}
            layout="screen-fit"
            onLike={toggleLike}
            onOpenComment={() =>
              modal.open(
                <CommentSheet
                  postId={post._id}
                  onChanged={(count) => setPost((curr) => (curr ? { ...curr, commentsCount: count } : curr))}
                />,
              )
            }
            onOpenDetail={() => undefined}
            onOpenAuthor={() => nav(`/profile/${encodeURIComponent(post.authorUsername || post.authorId || 'user')}`)}
          />
        ) : null}
      </div>

      <section className={`${styles.suggestedSection} ${responsiveStyles.suggestedSection}`}>
        <div className={`${styles.suggestedHeader} ${responsiveStyles.suggestedHeader}`}>
          <h2 className={styles.suggestedTitle}>Bài viết đề xuất</h2>
          <button
            type="button"
            className={styles.refreshBtn}
            disabled={loadingSuggested || !id}
            onClick={() => {
              if (!id) return
              void loadSuggested(id)
            }}
          >
            {loadingSuggested ? 'Đang tải...' : 'Làm mới'}
          </button>
        </div>

        {suggestedError ? <div className={styles.errorCard}>{suggestedError}</div> : null}

        {loadingSuggested && !suggestedItems.length ? (
          <div className={styles.stateCard}>Đang tải bài viết đề xuất...</div>
        ) : null}

        {!loadingSuggested && !suggestedItems.length ? (
          <div className={styles.stateCard}>Chưa có bài viết đề xuất.</div>
        ) : null}

        {suggestedItems.length ? (
          <div className={`${styles.suggestedGrid} ${responsiveStyles.suggestedGrid}`}>
            {suggestedItems.map((item) => {
              const preview = getPreviewMedia(item)
              const likesCount = Number(item.likesCount || (Array.isArray(item.likes) ? item.likes.length : 0))
              const commentsCount = Number(item.commentsCount || 0)

              return (
                <article key={item._id} className={`${styles.suggestedCard} ${responsiveStyles.suggestedCard}`}>
                  <Link to={`/post/${item._id}`} className={styles.mediaLink}>
                    <div className={`${styles.mediaWrap} ${responsiveStyles.mediaWrap}`}>
                      {preview ? (
                        preview.type === 'video' ? (
                          preview.thumbnailSrc ? (
                            <img className={styles.media} src={preview.thumbnailSrc} alt={item.content || 'suggested post'} />
                          ) : (
                            <video className={styles.media} src={preview.src} muted playsInline preload="metadata" />
                          )
                        ) : (
                          <img className={styles.media} src={preview.src} alt={item.content || 'suggested post'} />
                        )
                      ) : (
                        <div className={styles.mediaPlaceholder}>Không có media</div>
                      )}

                      {preview?.type === 'video' ? <span className={styles.videoBadge}>Video</span> : null}
                    </div>
                  </Link>

                  <div className={styles.cardBody}>
                    <button
                      type="button"
                      className={styles.authorBtn}
                      onClick={() => nav(`/profile/${encodeURIComponent(item.authorUsername || item.authorId || 'user')}`)}
                    >
                      @{item.authorUsername || item.authorId || 'user'}
                    </button>

                    <p className={item.content ? styles.caption : styles.captionMuted}>
                      {item.content || 'Bài viết không có mô tả.'}
                    </p>

                    <div className={styles.metaRow}>
                      <span>{likesCount} lượt thích</span>
                      <span>{commentsCount} bình luận</span>
                    </div>

                    <Link className={styles.openBtn} to={`/post/${item._id}`}>
                      Mở bài viết
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}
      </section>
    </section>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { resolveMediaUrl, useApi } from '../../../../lib/api'
import { useModal } from '../../../../components/Modal'
import { useToast } from '../../../../components/Toast'
import GlobalPostCard from '../../../../components/PostCard'
import CommentSheet from '../../../../components/comments/CommentSheet'
import type { Post } from '../../../../types'
import { useUsersApi } from '../../../../features/users/users.api'
import { usePostsApi } from '../../../../features/posts/posts.api'
import { useAppStore } from '../../../../state/store'
import { combineResponsiveStyles } from '../../../../lib/combineResponsiveStyles'
import styles from './Feed.module.css'
import desktopStyles from './Feed.desktop.module.css'
import tabletStyles from './Feed.tablet.module.css'
import mobileStyles from './Feed.mobile.module.css'

type NormalizedMedia = {
  type: 'image' | 'video'
  url: string
  thumbnailUrl?: string
}

type DetailModalProps = {
  post: Post
  onOpenAuthor: () => void
  onOpenPostPage: () => void
  onOpenComment: () => void
}

type EditModalProps = {
  post: Post
  onSave: (nextContent: string) => Promise<void>
  onCancel: () => void
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)
const TABLET_LAYOUT_QUERY = '(min-width: 561px) and (max-width: 1024px)'

function detectMediaType(item: any): 'image' | 'video' | null {
  const type = String(item?.type || '').toLowerCase()
  const mime = String(item?.mimeType || '').toLowerCase()
  const url = String(item?.url || item || '').toLowerCase()

  if (type === 'video' || mime.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v)$/i.test(url)) return 'video'
  if (type === 'image' || mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(url)) return 'image'
  return null
}

function getPostMedia(post: Post): NormalizedMedia[] {
  const list: NormalizedMedia[] = []

  if (Array.isArray(post.media)) {
    for (const item of post.media) {
      const type = detectMediaType(item)
      const url = resolveMediaUrl(item?.url)
      const thumbnailUrl = resolveMediaUrl(item?.thumbnailUrl)
      if (!type || !url) continue
      list.push({ type, url, thumbnailUrl })
    }
  }

  if (!list.length && post.imageUrl) {
    const url = resolveMediaUrl(post.imageUrl)
    const type = detectMediaType({ url }) || 'image'
    if (url) list.push({ type, url })
  }

  return list
}

function DetailModal({ post, onOpenAuthor, onOpenPostPage, onOpenComment }: DetailModalProps) {
  const media = useMemo(() => getPostMedia(post), [post])
  const [active, setActive] = useState(0)
  const likesCount = Number(post.likesCount || (Array.isArray(post.likes) ? post.likes.length : 0))
  const commentsCount = Number(post.commentsCount || 0)

  useEffect(() => {
    setActive(0)
  }, [post._id])

  const current = media[active] || null
  const hasMany = media.length > 1

  return (
    <div className={styles.detailModal}>
      <div className={styles.detailHeader}>
        <button type="button" className={styles.detailAuthorBtn} onClick={onOpenAuthor}>
          @{post.authorUsername || 'user'}
        </button>
        <span className={styles.detailMeta}>{post.createdAt ? new Date(post.createdAt).toLocaleString('vi-VN') : 'Vua xong'}</span>
      </div>

      <div className={styles.detailMediaWrap}>
        {current?.type === 'video' ? (
          <video className={styles.detailMedia} src={current.url} controls playsInline preload="metadata" />
        ) : current?.url ? (
          <img className={styles.detailMedia} src={current.url} alt={post.content || 'post'} />
        ) : (
          <div className={styles.state}>Bai viet nay chua co media.</div>
        )}
      </div>

      {hasMany ? (
        <div className={styles.detailNavRow}>
          <button type="button" className={styles.detailNavBtn} onClick={() => setActive((value) => (value - 1 + media.length) % media.length)}>
            Truoc
          </button>
          <span>{active + 1}/{media.length}</span>
          <button type="button" className={styles.detailNavBtn} onClick={() => setActive((value) => (value + 1) % media.length)}>
            Sau
          </button>
        </div>
      ) : null}

      {post.content ? <div className={styles.detailCaption}>{post.content}</div> : null}

      <div className={styles.detailStats}>
        <span>{likesCount} lượt thích</span>
        <span>{commentsCount} bình luận</span>
      </div>

      <div className={styles.detailActionRow}>
        <button type="button" className={styles.detailActionBtn} onClick={onOpenComment}>Mở bình luận</button>
        <button type="button" className={styles.detailActionBtn} onClick={onOpenPostPage}>Mở trang chi tiết</button>
      </div>
    </div>
  )
}

function EditPostModal({ post, onSave, onCancel }: EditModalProps) {
  const media = useMemo(() => getPostMedia(post), [post])
  const [activeMediaIndex, setActiveMediaIndex] = useState(0)
  const [content, setContent] = useState(String(post.content || ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const currentMedia = media[activeMediaIndex] || null
  const hasManyMedia = media.length > 1

  useEffect(() => {
    setActiveMediaIndex(0)
  }, [post._id])

  const handleSave = async () => {
    if (saving) return
    const nextContent = String(content || '')
    const hasMedia = (Array.isArray(post.media) && post.media.length > 0) || Boolean(post.imageUrl)
    if (!hasMedia && !nextContent.trim()) {
      setError('Bai viet dang text-only thi khong duoc de trong noi dung.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave(nextContent)
    } catch (err: any) {
      setError(err?.message || 'Không cập nhật được bài viết')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.editBox}>
      <div className={styles.editMediaPanel}>
        <div className={styles.editMediaHeader}>
          <div>
            <div className={styles.editEyebrow}>Media hiện tại</div>
            <div className={styles.editMediaTitle}>
              {media.length ? `${activeMediaIndex + 1}/${media.length}` : 'Không có media'}
            </div>
          </div>
          {currentMedia ? <span className={styles.editMediaType}>{currentMedia.type === 'video' ? 'Video' : 'Ảnh'}</span> : null}
        </div>

        <div className={styles.editMediaStage}>
          {currentMedia?.type === 'video' ? (
            <video className={styles.editMediaPreview} src={currentMedia.url} controls playsInline preload="metadata" />
          ) : currentMedia?.url ? (
            <img className={styles.editMediaPreview} src={currentMedia.url} alt={post.content || 'Media bài viết'} />
          ) : (
            <div className={styles.editMediaEmpty}>
              <strong>Bài viết không có ảnh hoặc video</strong>
              <span>Bạn vẫn có thể chỉnh sửa nội dung chữ của bài viết.</span>
            </div>
          )}
        </div>

        {hasManyMedia ? (
          <div className={styles.editThumbRow}>
            {media.map((item, index) => (
              <button
                key={`${item.url}-${index}`}
                type="button"
                className={cx(styles.editThumbBtn, index === activeMediaIndex && styles.editThumbBtnActive)}
                onClick={() => setActiveMediaIndex(index)}
                aria-label={`Xem media ${index + 1}`}
              >
                {item.type === 'image' ? (
                  <img src={item.thumbnailUrl || item.url} alt="" />
                ) : item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt="" />
                ) : (
                  <span>Video</span>
                )}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.editFormPanel}>
        {/* <div>
          <div className={styles.editEyebrow}>Chỉnh sửa</div>
          <div className={styles.editTitle}>Cập nhật bài viết</div>
          <p className={styles.editHint}>Ảnh và video hiện tại chỉ hiển thị để xem lại. Phần lưu thay đổi cập nhật nội dung bài viết.</p>
        </div> */}

        <label className={styles.editField}>
          <span>Nội dung bài viết</span>
          <textarea
            className={styles.editTextarea}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Nhập nội dung mới"
          />
        </label>

        <div className={styles.editMetaRow}>
          <span>{content.trim().length} ký tự</span>
          <span>{post.createdAt ? `Đã đăng ${new Date(post.createdAt).toLocaleString('vi-VN')}` : 'Bài viết mới'}</span>
        </div>

        {error ? <div className={styles.editError}>{error}</div> : null}

        <div className={styles.editActionRow}>
          <button type="button" className={styles.editCancelBtn} onClick={onCancel} disabled={saving}>Hủy</button>
          <button type="button" className={styles.editSaveBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Feed() {
  const api = useApi()
  const usersApi = useUsersApi()
  const postsApi = usePostsApi()
  const nav = useNavigate()
  const modal = useModal()
  const toast = useToast()
  const { state } = useAppStore()

  const [items, setItems] = useState<Post[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set())
  const [followStateReady, setFollowStateReady] = useState(false)
  const [followPendingMap, setFollowPendingMap] = useState<Record<string, boolean>>({})
  const [reportPendingMap, setReportPendingMap] = useState<Record<string, boolean>>({})
  const [isTabletLayout, setIsTabletLayout] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const query = window.matchMedia(TABLET_LAYOUT_QUERY)
    const update = (event?: MediaQueryListEvent) => {
      setIsTabletLayout(event?.matches ?? query.matches)
    }

    update()
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update)
      return () => query.removeEventListener('change', update)
    }

    query.addListener(update)
    return () => query.removeListener(update)
  }, [])

  const loadFollowState = useCallback(async () => {
    if (!state.username) {
      setFollowingSet(new Set())
      setFollowStateReady(true)
      return
    }
    setFollowStateReady(false)
    try {
      const following = await usersApi.getFollowing(state.username)
      setFollowingSet(new Set(following.map((user) => String(user.username || '').trim().toLowerCase()).filter(Boolean)))
    } catch {
      // ignore follow state error on feed
    } finally {
      setFollowStateReady(true)
    }
  }, [state.username, usersApi])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get(`/posts?page=${page}&limit=10`)
      const payload = response?.data || {}
      setItems(Array.isArray(payload.items) ? payload.items : [])
      setTotalPages(Math.max(Number(payload.totalPages) || 1, 1))
    } catch (error: any) {
      toast.push(error?.message || 'Không tải được danh sách bài viết')
    } finally {
      setLoading(false)
    }
  }, [api, page, toast])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  useEffect(() => {
    loadFollowState()
  }, [loadFollowState])

  const refresh = () => {
    loadPosts()
    loadFollowState()
  }

  const updatePost = (postId: string, patch: Partial<Post>) => {
    setItems((prev) => prev.map((item) => (item._id === postId ? { ...item, ...patch } : item)))
  }

  const toggleLike = async (post: Post) => {
    const previous = { likedByMe: !!post.likedByMe, likesCount: post.likesCount || 0 }
    const nextLiked = !previous.likedByMe
    updatePost(post._id, {
      likedByMe: nextLiked,
      likesCount: Math.max(0, previous.likesCount + (nextLiked ? 1 : -1)),
    })

    try {
      if (post.likedByMe) {
        const res = await api.del(`/posts/${post._id}/like`)
        updatePost(post._id, res?.data || {})
      } else {
        const res = await api.post(`/posts/${post._id}/like`, {})
        updatePost(post._id, res?.data || {})
      }
    } catch (error: any) {
      updatePost(post._id, previous)
      toast.push(error?.message || 'Không thể cập nhật lượt thích')
    }
  }

  const handleToggleFollow = async (post: Post) => {
    const targetUsername = String(post.authorUsername || '').trim()
    const normalizedTargetUsername = targetUsername.toLowerCase()
    if (!targetUsername || normalizedTargetUsername === currentUsername || followPendingMap[normalizedTargetUsername]) return

    const wasFollowing = followingSet.has(normalizedTargetUsername)
    setFollowPendingMap((prev) => ({ ...prev, [normalizedTargetUsername]: true }))
    setFollowingSet((prev) => {
      const next = new Set(prev)
      if (wasFollowing) next.delete(normalizedTargetUsername)
      else next.add(normalizedTargetUsername)
      return next
    })

    try {
      if (wasFollowing) {
        await usersApi.unfollowUser({ username: targetUsername })
      } else {
        await usersApi.followUser({ username: targetUsername })
      }
    } catch (error: any) {
      setFollowingSet((prev) => {
        const next = new Set(prev)
        if (wasFollowing) next.add(normalizedTargetUsername)
        else next.delete(normalizedTargetUsername)
        return next
      })
      toast.push(error?.message || 'Không thể cập nhật theo dõi')
    } finally {
      setFollowPendingMap((prev) => ({ ...prev, [normalizedTargetUsername]: false }))
    }
  }

  useEffect(() => {
    const handlePostDeleted = (event: Event) => {
      const postId = String((event as CustomEvent).detail?.postId || '')
      if (!postId) return
      setItems((prev) => prev.filter((item) => item._id !== postId))
    }
    window.addEventListener('post:deleted', handlePostDeleted as EventListener)
    return () => window.removeEventListener('post:deleted', handlePostDeleted as EventListener)
  }, [])

  const handleDeletePost = async (post: Post) => {
    try {
      await postsApi.deletePost(post._id)
      setItems((prev) => prev.filter((item) => item._id !== post._id))
      toast.push('Đã xóa bài viết')
    } catch (error: any) {
      toast.push(error?.message || 'Không thể xóa bài viết')
    }
  }

  const handleEditPost = (post: Post) => {
    modal.open(
      <EditPostModal
        post={post}
        onCancel={() => modal.close()}
        onSave={async (nextContent) => {
          const data = await postsApi.updatePost(post._id, { content: nextContent })
          updatePost(post._id, data || {})
          toast.push('Da cap nhat bai viet')
          modal.close()
        }}
      />,
    )
  }

  const openCommentPopup = (post: Post) => {
    modal.openFullscreen(
      <CommentSheet
        postId={post._id}
        onChanged={(count) => updatePost(post._id, { commentsCount: count })}
        mode="panel"
        presentation="fullscreen"
        onClose={() => modal.close()}
      />,
    )
  }

  const openDetailPopup = (post: Post) => {
    modal.open(
      <DetailModal
        post={post}
        onOpenAuthor={() => {
          modal.close()
          nav(`/profile/${encodeURIComponent(post.authorUsername || post.authorId || 'user')}`)
        }}
        onOpenPostPage={() => {
          modal.close()
          nav(`/post/${post._id}`)
        }}
        onOpenComment={() => openCommentPopup(post)}
      />,
    )
  }

  const handleReportPost = async (post: Post, reason: string) => {
    if (!post?._id || reportPendingMap[post._id]) return
    setReportPendingMap((prev) => ({ ...prev, [post._id]: true }))
    try {
      await api.post(`/posts/${post._id}/report`, { reason })
      toast.push('Đã gửi báo cáo tới admin')
      updatePost(post._id, {
        moderationStatus: 'reported',
        reportCount: Number(post.reportCount || 0) + 1,
      })
    } catch (error: any) {
      toast.push(error?.message || 'Không thể báo cáo bài viết')
    } finally {
      setReportPendingMap((prev) => ({ ...prev, [post._id]: false }))
    }
  }

  const followingLookup = useMemo(() => followingSet, [followingSet])
  const currentUsername = String(state.username || '').trim().toLowerCase()
  const { primaryPosts, suggestedPosts } = useMemo(() => {
    if (!followStateReady) {
      return {
        primaryPosts: items,
        suggestedPosts: [] as Post[],
      }
    }

    return items.reduce(
      (acc, item) => {
        const authorUsername = String(item.authorUsername || '').trim().toLowerCase()
        const isOwnPost = !!authorUsername && authorUsername === currentUsername
        const shouldPrioritize = !authorUsername || isOwnPost || followingLookup.has(authorUsername)
        if (shouldPrioritize) acc.primaryPosts.push(item)
        else acc.suggestedPosts.push(item)
        return acc
      },
      {
        primaryPosts: [] as Post[],
        suggestedPosts: [] as Post[],
      },
    )
  }, [currentUsername, followStateReady, followingLookup, items])

  const renderPostCard = (post: Post, isSuggested = false) => {
    const authorUsername = String(post.authorUsername || '').trim()
    const normalizedAuthorUsername = authorUsername.toLowerCase()
    const showFollowButton = !!authorUsername && normalizedAuthorUsername !== currentUsername
    const canManagePost = !!authorUsername && normalizedAuthorUsername === currentUsername

    return (
      <GlobalPostCard
        key={post._id}
        post={post}
        layout={isTabletLayout ? 'screen-fit' : 'default'}
        onLike={() => toggleLike(post)}
        onOpenComment={() => openCommentPopup(post)}
        onOpenDetail={() => openDetailPopup(post)}
        onOpenAuthor={() => nav(`/profile/${encodeURIComponent(post.authorUsername || post.authorId || 'user')}`)}
        showFollowButton={showFollowButton}
        showHeaderFollowButton={isSuggested}
        showBottomFollowButton={false}
        following={followingLookup.has(normalizedAuthorUsername)}
        followPending={!!followPendingMap[normalizedAuthorUsername]}
        reportPending={!!reportPendingMap[post._id]}
        onToggleFollow={() => handleToggleFollow(post)}
        onDelete={canManagePost ? () => handleDeletePost(post) : undefined}
        onEdit={canManagePost ? () => handleEditPost(post) : undefined}
        onReport={(reason) => handleReportPost(post, reason)}
      />
    )
  }

  return (
    <div className={cx(styles.feed, responsiveStyles.feed, 'home-feed')}>
      <div className={cx(styles.topbar, responsiveStyles.topbar, 'home-feed__topbar')}>
        {/* <div>
          <div className={styles.title}>Bai viet moi nhat</div>
          <div className={cx(styles.subtitle, responsiveStyles.subtitle, 'home-feed__subtitle')}>Hien thi toan bo bai viet theo thoi gian gan nhat</div>
        </div> */}
        {/* <button className={cx('btn', responsiveStyles.refresh, 'home-feed__refresh')} type="button" onClick={refresh} disabled={loading}>
          {loading ? 'Đang tải...' : 'Làm mới'}
        </button> */}
      </div>

      {loading && !items.length ? <div className={cx(styles.state, responsiveStyles.state)}>Đang tải bài viết...</div> : null}
      {!loading && !items.length ? <div className={cx(styles.state, responsiveStyles.state)}>Chưa có bài viết nào.</div> : null}

      {primaryPosts.map((post) => renderPostCard(post))}

      {suggestedPosts.length ? (
        <section className={styles.suggestedSection}>
          <div className={cx(styles.suggestedHeader, responsiveStyles.suggestedHeader)}>Bài viết gợi ý</div>
          <div className={styles.suggestedList}>{suggestedPosts.map((post) => renderPostCard(post, true))}</div>
        </section>
      ) : null}

      {items.length ? (
        <div className={cx(styles.pagination, responsiveStyles.pagination)}>
          <button className="btn" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
            Truoc
          </button>
          <span className={cx(styles.pageText, responsiveStyles.pageText)}>
            Trang {page}/{totalPages}
          </span>
          <button className="btn" type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages || loading}>
            Sau
          </button>
        </div>
      ) : null}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './CommentSheet.module.css'
import desktopStyles from './CommentSheet.desktop.module.css'
import tabletStyles from './CommentSheet.tablet.module.css'
import mobileStyles from './CommentSheet.mobile.module.css'
import { useApi, resolveMediaUrl } from '../../lib/api'
import { getAvatarUrl } from '../../lib/avatar'
import { combineResponsiveStyles } from '../../lib/combineResponsiveStyles'
import { useToast } from '../Toast'
import { useAppStore } from '../../state/store'
import type { Post, PostComment } from '../../types'

type Props = {
  postId: string
  onChanged?: (count: number) => void
  mode?: 'full' | 'panel'
  hidePostMeta?: boolean
  presentation?: 'dialog' | 'fullscreen'
  onClose?: () => void
}

type NormalizedMedia = {
  type: 'image' | 'video'
  url: string
}

type GroupedComment = {
  root: PostComment
  replies: PostComment[]
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

function detectMediaType(item: any): 'image' | 'video' | null {
  const type = String(item?.type || item?.mediaType || '').toLowerCase()
  const mime = String(item?.mimeType || '').toLowerCase()
  const url = String(item?.url || item?.mediaUrl || item || '').toLowerCase()

  if (type === 'video' || mime.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v)$/i.test(url)) return 'video'
  if (type === 'image' || type === 'gif' || mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(url)) return 'image'
  return null
}

function getPostMedia(post: Post | null): NormalizedMedia[] {
  if (!post) return []
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
    if (url) list.push({ type: detectMediaType({ url }) || 'image', url })
  }

  return list
}

function formatRelative(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} phút`
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))} giờ`
  if (diff < week) return `${Math.max(1, Math.floor(diff / day))} ngày`
  return `${Math.max(1, Math.floor(diff / week))} tuần`
}

function groupComments(items: PostComment[]): GroupedComment[] {
  const roots = items.filter((item) => !item.parentCommentId)
  const repliesMap = new Map<string, PostComment[]>()

  for (const item of items) {
    if (!item.parentCommentId) continue
    const bucket = repliesMap.get(item.parentCommentId) || []
    bucket.push(item)
    repliesMap.set(item.parentCommentId, bucket)
  }

  roots.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
  for (const [, replyItems] of repliesMap) {
    replyItems.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
  }

  return roots.map((root) => ({ root, replies: repliesMap.get(root._id) || [] }))
}

function MediaPreview({ media }: { media: NormalizedMedia[] }) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    setActive(0)
  }, [media.length])

  const current = media[active]
  if (!current) return <div className={styles.mediaEmpty}>Bài viết này chưa có ảnh hoặc video.</div>

  return (
    <div className={styles.mediaWrap}>
      <div className={styles.mediaStage}>
        {current.type === 'video' ? <video className={styles.media} src={current.url} controls playsInline /> : <img className={styles.media} src={current.url} alt="post" />}
        {media.length > 1 ? (
          <>
            <button
              type="button"
              className={cx(styles.mediaNav, responsiveStyles.mediaNav, styles.mediaPrev, responsiveStyles.mediaPrev)}
              onClick={() => setActive((v) => (v - 1 + media.length) % media.length)}
              aria-label="Ảnh trước"
            >
              ‹
            </button>
            <button
              type="button"
              className={cx(styles.mediaNav, responsiveStyles.mediaNav, styles.mediaNext, responsiveStyles.mediaNext)}
              onClick={() => setActive((v) => (v + 1) % media.length)}
              aria-label="Ảnh sau"
            >
              ›
            </button>
          </>
        ) : null}
      </div>
      {media.length > 1 ? (
        <div className={styles.mediaDots}>
          {media.map((_, index) => (
            <button key={index} type="button" className={`${styles.mediaDot} ${index === active ? styles.mediaDotActive : ''}`} onClick={() => setActive(index)} aria-label={`Chuyển đến media ${index + 1}`} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CommentAttachment({ comment }: { comment: PostComment }) {
  const mediaType = detectMediaType({ mediaType: comment.mediaType, mediaUrl: comment.mediaUrl })
  const url = resolveMediaUrl(comment.mediaUrl)
  if (!mediaType || !url) return null
  return mediaType === 'video' ? (
    <video className={cx(styles.commentMedia, responsiveStyles.commentMedia)} src={url} controls playsInline />
  ) : (
    <img className={cx(styles.commentMedia, responsiveStyles.commentMedia)} src={url} alt="comment media" />
  )
}

export default function CommentSheet({
  postId,
  onChanged,
  mode = 'full',
  hidePostMeta = false,
  presentation = 'dialog',
  onClose,
}: Props) {
  const api = useApi()
  const toast = useToast()
  const { state } = useAppStore()
  const [post, setPost] = useState<Post | null>(null)
  const [items, setItems] = useState<PostComment[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyTo, setReplyTo] = useState<PostComment | null>(null)
  const [expandedRoots, setExpandedRoots] = useState<Record<string, boolean>>({})
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const mediaInputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [postRes, commentRes] = await Promise.all([api.get(`/posts/${postId}`), api.get(`/posts/${postId}/comments`)])
      setPost(postRes?.data?.post || postRes?.data || postRes || null)
      const next = Array.isArray(commentRes?.data) ? commentRes.data : []
      setItems(next)
      onChanged?.(next.length)
    } catch (error: any) {
      toast.push(error?.message || 'Không tải được bình luận')
    } finally {
      setLoading(false)
    }
  }, [api, onChanged, postId, toast])

  useEffect(() => {
    load()
  }, [load])

  const replaceComment = (nextComment: PostComment) => {
    setItems((prev) => prev.map((item) => (item._id === nextComment._id ? { ...item, ...nextComment } : item)))
  }

  const submit = async () => {
    if (submitting) return
    const content = text.trim()
    if (!content && !mediaFile) return
    setSubmitting(true)
    try {
      const body = new FormData()
      if (content) body.append('content', content)
      if (mediaFile) body.append('media', mediaFile)
      body.append('parentCommentId', replyTo ? replyTo.parentCommentId || replyTo._id : '')
      body.append('replyToCommentId', replyTo?._id || '')
      await api.postForm(`/posts/${postId}/comments`, body)
      setText('')
      setReplyTo(null)
      setMediaFile(null)
      if (mediaInputRef.current) mediaInputRef.current.value = ''
      await load()
    } catch (error: any) {
      toast.push(error?.message || 'Không thể gửi bình luận')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (comment: PostComment) => {
    try {
      await api.del(`/posts/${postId}/comments/${comment._id}`)
      await load()
    } catch (error: any) {
      toast.push(error?.message || 'Không thể xóa bình luận')
    }
  }

  const toggleCommentLike = async (comment: PostComment) => {
    try {
      const next = comment.likedByMe
        ? await api.del(`/posts/${postId}/comments/${comment._id}/like`)
        : await api.post(`/posts/${postId}/comments/${comment._id}/like`, {})
      replaceComment(next?.data || next)
    } catch (error: any) {
      toast.push(error?.message || 'Không thể thả tim bình luận')
    }
  }

  const toggleReplies = (rootId: string) => {
    setExpandedRoots((prev) => ({ ...prev, [rootId]: !prev[rootId] }))
  }

  const media = useMemo(() => getPostMedia(post), [post])
  const groups = useMemo(() => groupComments(items), [items])
  const mediaPreviewUrl = useMemo(() => (mediaFile ? URL.createObjectURL(mediaFile) : ''), [mediaFile])

  useEffect(() => {
    setExpandedRoots((prev) => {
      const next: Record<string, boolean> = {}
      for (const group of groups) next[group.root._id] = prev[group.root._id] ?? true
      return next
    })
  }, [groups])

  useEffect(() => {
    return () => {
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl)
    }
  }, [mediaPreviewUrl])

  const renderComment = (comment: PostComment, modeValue: 'root' | 'reply') => {
    const canDelete = Boolean(comment.canDelete || (comment.authorUsername && state.username && comment.authorUsername === state.username))
    const targetUsername = comment.replyTo?.authorUsername || comment.replyToAuthorUsername
    const isReply = modeValue === 'reply'

    return (
      <div key={comment._id} className={cx(styles.item, responsiveStyles.item, isReply && styles.replyItem)}>
        <img
          className={cx(styles.itemAvatarImage, responsiveStyles.itemAvatarImage)}
          src={getAvatarUrl({ username: comment.authorUsername, avatarUrl: (comment as any).authorAvatarUrl })}
          alt={comment.authorUsername || 'user'}
        />
        <div className={styles.itemBody}>
          {isReply ? (
            <div className={cx(styles.replyBadgeRow, responsiveStyles.replyBadgeRow)}>
              <span className={styles.replyBadge}>Trả lời</span>
              {targetUsername ? <span className={styles.replyTarget}>@{targetUsername}</span> : null}
            </div>
          ) : null}

          <div className={styles.itemTopline}>
            <span className={styles.author}>{comment.authorUsername || 'user'}</span>
            <span className={styles.time}>{formatRelative(comment.createdAt)}</span>
          </div>
          {(comment.content || (isReply && targetUsername)) ? (
            <div className={styles.contentPlain}>
              {isReply && targetUsername ? <span className={styles.mention}>@{targetUsername} </span> : null}
              {comment.content}
            </div>
          ) : null}
          <CommentAttachment comment={comment} />

          <div className={cx(styles.actions, responsiveStyles.actions)}>
            <button className={styles.actionBtn} type="button" onClick={() => setReplyTo(comment)}>Trả lời</button>
            {canDelete ? <button className={`${styles.actionBtn} ${styles.actionDanger}`} type="button" onClick={() => remove(comment)}>Xóa</button> : null}
          </div>
        </div>
        <button className={styles.commentLikeBtn} type="button" onClick={() => void toggleCommentLike(comment)} aria-label={comment.likedByMe ? 'Bỏ tim bình luận' : 'Thả tim bình luận'}>
          <span className={`${styles.commentHeart} ${comment.likedByMe ? styles.commentHeartActive : ''}`}>{comment.likedByMe ? '♥' : '♡'}</span>
          {Number(comment.likesCount || 0) > 0 ? <span className={styles.commentLikeCount}>{comment.likesCount}</span> : null}
        </button>
      </div>
    )
  }

  const panelOnly = mode === 'panel'
  const showPostMeta = !hidePostMeta
  const isFullscreen = presentation === 'fullscreen'

  return (
    <div
      className={cx(
        styles.shell,
        responsiveStyles.shell,
        panelOnly && styles.shellPanelOnly,
        panelOnly && responsiveStyles.shellPanelOnly,
        isFullscreen && styles.shellFullscreen,
        isFullscreen && responsiveStyles.shellFullscreen,
      )}
    >
      {isFullscreen ? (
        <button
          type="button"
          className={cx(styles.fullscreenCloseBtn, responsiveStyles.fullscreenCloseBtn)}
          onClick={onClose}
          aria-label="Đóng bình luận"
        >
          {'\u00D7'}
        </button>
      ) : null}

      {!panelOnly ? <div className={cx(styles.previewCol, responsiveStyles.previewCol)}><MediaPreview media={media} /></div> : null}

      <div className={cx(styles.panelCol, responsiveStyles.panelCol, panelOnly && styles.panelColOnly, panelOnly && responsiveStyles.panelColOnly)}>
        {showPostMeta ? <div className={cx(styles.header, responsiveStyles.header)}>
          <div className={styles.postMeta}>
            <img
              className={cx(styles.postAvatarImage, responsiveStyles.postAvatarImage)}
              src={getAvatarUrl({ username: post?.authorUsername, avatarUrl: (post as any)?.authorAvatarUrl })}
              alt={post?.authorUsername || 'user'}
            />
            <div>
              <div className={styles.postAuthor}>{post?.authorUsername || 'user'}</div>
              <div className={styles.postDate}>{post?.createdAt ? new Date(post.createdAt).toLocaleString() : 'Bài viết'}</div>
            </div>
          </div>
        </div> : null}

        {showPostMeta && post?.content ? (
          <div className={cx(styles.captionCard, responsiveStyles.captionCard)}>
            <span className={styles.captionAuthor}>{post.authorUsername || 'user'}</span>
            <span className={styles.captionText}>{post.content}</span>
          </div>
        ) : null}

        <div className={cx(styles.list, responsiveStyles.list)}>
          {loading ? <div className={styles.empty}>Đang tải bình luận...</div> : null}
          {!loading && !items.length ? <div className={styles.empty}>Chưa có bình luận nào. Hãy là người đầu tiên để lại lời nhắn.</div> : null}
          {groups.map(({ root, replies }) => (
            <div key={root._id} className={styles.thread}>
              {renderComment(root, 'root')}
              {replies.length ? (
                <div className={cx(styles.repliesWrap, responsiveStyles.repliesWrap)}>
                  <button type="button" className={styles.repliesToggle} onClick={() => toggleReplies(root._id)}>
                    <span className={styles.repliesToggleLine} />
                    {expandedRoots[root._id] ? 'Ẩn câu trả lời' : `Xem ${replies.length} câu trả lời`}
                  </button>
                  {expandedRoots[root._id] ? <div className={cx(styles.repliesStack, responsiveStyles.repliesStack)}>{replies.map((reply) => renderComment(reply, 'reply'))}</div> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className={cx(styles.composer, responsiveStyles.composer)}>
          {replyTo ? (
            <div className={cx(styles.replyHint, responsiveStyles.replyHint)}>
              <div>
                Đang trả lời <strong>@{replyTo.authorUsername}</strong>
                {replyTo.replyTo?.authorUsername || replyTo.replyToAuthorUsername ? <span className={styles.replyHintMeta}> trong luồng với @{replyTo.replyTo?.authorUsername || replyTo.replyToAuthorUsername}</span> : null}
              </div>
              <button className={styles.cancelReplyBtn} type="button" onClick={() => setReplyTo(null)}>Hủy</button>
            </div>
          ) : null}

          {mediaFile && mediaPreviewUrl ? (
            <div className={styles.pendingMediaWrap}>
              {mediaFile.type.startsWith('video/') ? <video className={styles.pendingMedia} src={mediaPreviewUrl} controls playsInline /> : <img className={styles.pendingMedia} src={mediaPreviewUrl} alt="pending comment media" />}
              <button type="button" className={styles.pendingMediaRemove} onClick={() => { setMediaFile(null); if (mediaInputRef.current) mediaInputRef.current.value = '' }}>×</button>
            </div>
          ) : null}

          <div className={cx(styles.composerRow, responsiveStyles.composerRow)}>
            <div className={cx(styles.composerIcon, responsiveStyles.composerIcon)}>☺</div>
            <textarea className={cx(styles.textarea, responsiveStyles.textarea)} value={text} onChange={(event) => setText(event.target.value)} placeholder={replyTo ? `Trả lời @${replyTo.authorUsername}...` : 'Thêm bình luận...'} rows={1} />
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={(event) => setMediaFile(event.target.files?.[0] || null)}
            />
            <button className={cx(styles.attachBtn, responsiveStyles.attachBtn)} type="button" onClick={() => mediaInputRef.current?.click()}>🖼</button>
            <button className={cx(styles.submitBtn, responsiveStyles.submitBtn)} type="button" onClick={submit} disabled={submitting || (!text.trim() && !mediaFile)}>
              {submitting ? 'Đang gửi...' : 'Đăng'}
            </button>
          </div>
          <div className={styles.footerMeta}>{items.length} bình luận</div>
        </div>
      </div>
    </div>
  )
}

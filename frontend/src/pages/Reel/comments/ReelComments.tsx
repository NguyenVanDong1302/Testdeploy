import { useEffect, useMemo, useRef, useState } from 'react'
import './ReelComments.scss'
import { useApi, resolveMediaUrl } from '../../../lib/api'
import { getAvatarUrl } from '../../../lib/avatar'
import { useToast } from '../../../components/Toast'
import { useAppStore } from '../../../state/store'

export type ReelComment = {
  id: string
  _id?: string
  user: string
  authorUsername?: string
  avatarUrl?: string
  authorAvatarUrl?: string
  time: string
  text: string
  likes: string
  likesCount?: number
  likedByMe?: boolean
  imageUrl?: string
  mediaUrl?: string
  mediaType?: string
  repliesLabel?: string
  verified?: boolean
  parentCommentId?: string | null
  replyToCommentId?: string | null
  replyToAuthorUsername?: string | null
  createdAt?: string
  canDelete?: boolean
}

type ReelCommentsProps = {
  isOpen: boolean
  postId?: string
  reelUsername: string
  comments: ReelComment[]
  onClose: () => void
  onCountChange?: (count: number) => void
}

function mapComment(input: any): ReelComment {
  return {
    id: String(input?._id || input?.id || ''),
    _id: String(input?._id || input?.id || ''),
    user: input?.authorUsername || input?.user || 'user',
    authorUsername: input?.authorUsername || input?.user || 'user',
    avatarUrl: input?.authorAvatarUrl || input?.avatarUrl || '',
    authorAvatarUrl: input?.authorAvatarUrl || input?.avatarUrl || '',
    time: input?.createdAt ? new Date(input.createdAt).toLocaleString() : input?.time || '',
    text: input?.content || input?.text || '',
    likes: String(input?.likesCount ?? input?.likes ?? 0),
    likesCount: Number(input?.likesCount ?? 0),
    likedByMe: Boolean(input?.likedByMe),
    imageUrl: input?.mediaUrl || input?.imageUrl || '',
    mediaUrl: input?.mediaUrl || '',
    mediaType: input?.mediaType || '',
    parentCommentId: input?.parentCommentId || null,
    replyToCommentId: input?.replyToCommentId || null,
    replyToAuthorUsername: input?.replyToAuthorUsername || null,
    createdAt: input?.createdAt,
    canDelete: Boolean(input?.canDelete),
  }
}

export default function ReelComments({ isOpen, postId, reelUsername, comments, onClose, onCountChange }: ReelCommentsProps) {
  const api = useApi()
  const toast = useToast()
  const { state } = useAppStore()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isMounted, setIsMounted] = useState(isOpen)
  const [isVisible, setIsVisible] = useState(isOpen)
  const [items, setItems] = useState<ReelComment[]>(() => comments || [])
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyTo, setReplyTo] = useState<ReelComment | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState('')
  const onCountChangeRef = useRef(onCountChange)

  useEffect(() => { onCountChangeRef.current = onCountChange }, [onCountChange])
  useEffect(() => { setItems(comments || []) }, [comments])
  useEffect(() => () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview) }, [pendingPreview])

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true)
      const raf = window.requestAnimationFrame(() => setIsVisible(true))
      return () => window.cancelAnimationFrame(raf)
    }
    setIsVisible(false)
    const timer = window.setTimeout(() => setIsMounted(false), 300)
    return () => window.clearTimeout(timer)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !postId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/posts/${postId}/comments`)
        if (cancelled) return
        const next = Array.isArray(res?.data) ? res.data.map(mapComment) : []
        setItems(next)
        onCountChangeRef.current?.(next.length)
      } catch (error: any) {
        if (cancelled) return
        toast.push(error?.message || 'Không tải được bình luận reel')
      }
    })()
    return () => { cancelled = true }
  }, [api, isOpen, postId, toast])

  const title = useMemo(() => `Comments · ${reelUsername}`, [reelUsername])
  const roots = useMemo(() => items.filter((item) => !item.parentCommentId), [items])
  const repliesMap = useMemo(() => {
    const map = new Map<string, ReelComment[]>()
    for (const item of items) {
      if (!item.parentCommentId) continue
      const bucket = map.get(item.parentCommentId) || []
      bucket.push(item)
      map.set(item.parentCommentId, bucket)
    }
    return map
  }, [items])

  if (!isMounted) return null

  const clearPending = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingPreview('')
    setPendingFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const submit = async () => {
    if (!postId || submitting || (!text.trim() && !pendingFile)) return
    setSubmitting(true)
    try {
      const body = new FormData()
      if (text.trim()) body.append('content', text.trim())
      if (pendingFile) body.append('media', pendingFile)
      body.append('parentCommentId', replyTo ? replyTo.parentCommentId || replyTo._id || '' : '')
      body.append('replyToCommentId', replyTo?._id || '')
      const res = await api.postForm(`/posts/${postId}/comments`, body)
      const created = mapComment(res?.data || res)
      setItems((prev) => [...prev, created])
      setText('')
      setReplyTo(null)
      clearPending()
      onCountChange?.(items.length + 1)
    } catch (error: any) {
      toast.push(error?.message || 'Không gửi được bình luận')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleLike = async (comment: ReelComment) => {
    if (!postId) return
    const id = comment._id || comment.id
    const nextLiked = !comment.likedByMe
    setItems((prev) => prev.map((item) => item.id === comment.id ? ({ ...item, likedByMe: nextLiked, likesCount: Math.max(0, (item.likesCount || 0) + (nextLiked ? 1 : -1)), likes: String(Math.max(0, (item.likesCount || 0) + (nextLiked ? 1 : -1))) }) : item))
    try {
      const res = nextLiked ? await api.post(`/posts/${postId}/comments/${id}/like`, {}) : await api.del(`/posts/${postId}/comments/${id}/like`)
      const updated = mapComment(res?.data || res)
      setItems((prev) => prev.map((item) => item.id === comment.id ? updated : item))
    } catch (error: any) {
      setItems((prev) => prev.map((item) => item.id === comment.id ? comment : item))
      toast.push(error?.message || 'Không thể thích bình luận')
    }
  }

  const pickFile = (file?: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      toast.push('Chỉ hỗ trợ ảnh hoặc video')
      return
    }
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(file)
    setPendingPreview(URL.createObjectURL(file))
  }

  const renderMedia = (comment: ReelComment) => {
    const url = resolveMediaUrl(comment.mediaUrl || comment.imageUrl)
    if (!url) return null
    return comment.mediaType === 'video'
      ? <video className="ig-reel-comments__media" src={url} controls playsInline />
      : <img className="ig-reel-comments__media" src={url} alt="comment media" />
  }

  const renderComment = (comment: ReelComment, isReply = false) => (
    <article className={`ig-reel-comments__item ${isReply ? 'is-reply' : ''}`} key={comment.id}>
      <img className="ig-reel-comments__avatar" src={getAvatarUrl({ username: comment.authorUsername || comment.user, avatarUrl: comment.authorAvatarUrl || comment.avatarUrl })} alt={comment.user} />
      <div className="ig-reel-comments__main">
        <div className="ig-reel-comments__meta"><span className="ig-reel-comments__user">{comment.user}</span><span className="ig-reel-comments__time">{comment.time}</span></div>
        {comment.text ? <div className="ig-reel-comments__text">{isReply && comment.replyToAuthorUsername ? <strong>@{comment.replyToAuthorUsername} </strong> : null}{comment.text}</div> : null}
        {renderMedia(comment)}
        <div className="ig-reel-comments__foot"><span>{comment.likesCount ?? 0} likes</span><button type="button" onClick={() => setReplyTo(comment)}>Reply</button></div>
      </div>
      <button className={`ig-reel-comments__like ${comment.likedByMe ? 'is-liked' : ''}`} type="button" aria-label="Thích bình luận" onClick={() => toggleLike(comment)}>❤</button>
    </article>
  )

  return (
    <>
      <div className={`ig-reel-comments__backdrop ${isVisible ? 'is-open' : ''}`} onClick={onClose} aria-hidden={!isVisible} />
      <aside className={`ig-reel-comments__panel ${isVisible ? 'is-open' : ''}`} aria-hidden={!isVisible} aria-label={title}>
        <div className="ig-reel-comments__grabber" aria-hidden="true" />
        <div className="ig-reel-comments__header"><button className="ig-reel-comments__close" type="button" onClick={onClose} aria-label="Đóng bình luận">✕</button><div className="ig-reel-comments__title">Comments</div><div className="ig-reel-comments__spacer" /></div>
        <div className="ig-reel-comments__body">{roots.map((comment) => <div key={comment.id}>{renderComment(comment, false)}{(repliesMap.get(comment.id) || []).map((reply) => renderComment(reply, true))}</div>)}</div>
        <div className="ig-reel-comments__composer">
          <img className="ig-reel-comments__composerAvatar" src={getAvatarUrl({ username: state.username || reelUsername })} alt="Bạn" />
          <div className="ig-reel-comments__composerBox">
            {replyTo ? <div className="ig-reel-comments__replying">Đang trả lời @{replyTo.user} <button type="button" onClick={() => setReplyTo(null)}>Hủy</button></div> : null}
            {pendingPreview ? <div className="ig-reel-comments__pending">{pendingFile?.type.startsWith('video/') ? <video className="ig-reel-comments__pendingMedia" src={pendingPreview} controls playsInline /> : <img className="ig-reel-comments__pendingMedia" src={pendingPreview} alt="preview" />}<button type="button" onClick={clearPending}>Bỏ đính kèm</button></div> : null}
            <div className="ig-reel-comments__composerRow">
              <input className="ig-reel-comments__composerInput" value={text} onChange={(e) => setText(e.target.value)} placeholder={replyTo ? `Trả lời @${replyTo.user}...` : 'Add a comment...'} />
              <input ref={inputRef} type="file" hidden accept="image/*,video/*" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
              <button className="ig-reel-comments__attach" type="button" onClick={() => inputRef.current?.click()}>＋</button>
              <button className="ig-reel-comments__submit" type="button" disabled={(!text.trim() && !pendingFile) || submitting} onClick={submit}>{submitting ? '...' : 'Post'}</button>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../lib/api'
import { Post } from '../types'
import PostCard from '../components/PostCard'
import Composer from '../components/Composer'
import { useModal } from '../components/Modal'
import { useToast } from '../components/Toast'

function CommentForm({ postId, onDone }: { postId: string; onDone: () => void }) {
  const api = useApi()
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const toast = useToast()

  const send = async () => {
    const v = text.trim()
    if (!v) return
    setStatus('Sending...')
    try {
      // NOTE: endpoint comment có thể khác backend bạn. (thường /posts/:id/comments)
      await api.post(`/posts/${postId}/comments`, { content: v })
      setText('')
      setStatus('Sent!')
      toast.push('Commented')
      onDone()
    } catch (e: any) {
      setStatus(e.message || 'Comment failed')
    }
  }

  return (
    <div className="card" style={{ background: 'var(--card2)' }}>
      <div className="row">
        <strong>Comment</strong>
        <span className="muted">Post {postId}</span>
      </div>
      <div style={{ marginTop: 10 }}>
        <input className="input" placeholder="Write a comment..." value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ok" onClick={send}>Send</button>
      </div>
      {status && <div className="muted" style={{ marginTop: 8 }}>{status}</div>}
    </div>
  )
}

export default function FeedPage() {
  const api = useApi()
  const nav = useNavigate()
  const modal = useModal()
  const toast = useToast()

  const [items, setItems] = useState<Post[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const limit = 10

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/posts?page=${page}&limit=${limit}`)
      const list: Post[] = res?.data?.items || res?.items || []
      setItems(list)
    } catch (e: any) {
      toast.push(`Load lỗi: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page])

  const like = async (p: Post) => {
    try {
      // NOTE: endpoint like/unlike có thể khác backend bạn. (thường /posts/:id/like)
      if (p.likedByMe) await api.del(`/posts/${p._id}/like`)
      else await api.post(`/posts/${p._id}/like`, {})
      await load()
    } catch (e: any) {
      toast.push(`Like lỗi: ${e.message}`)
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="row">
          <strong>Feed</strong>
          <span className="muted">Newest</span>
          <button className="btn" onClick={load} style={{ marginLeft: 'auto' }}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {items.map((p) => (
            <PostCard
              key={p._id}
              post={p}
              onLike={() => like(p)}
              onOpenComment={() => modal.open(<CommentForm postId={p._id} onDone={load} />)}
              onOpenDetail={() => nav(`/post/${p._id}`)}
              onOpenAuthor={() => nav(`/profile/${encodeURIComponent(p.authorUsername || p.authorId || 'user')}`)}
            />
          ))}
          {!items.length && !loading && <div className="muted">No posts</div>}
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
          <span className="muted">Page {page}</span>
          <button className="btn" onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>

      <Composer onPosted={() => { setPage(1); load() }} />
    </div>
  )
}

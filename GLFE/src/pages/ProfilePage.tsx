import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../lib/api'
import { Post } from '../types'
import { useToast } from '../components/Toast'

export default function ProfilePage() {
  const { username = '' } = useParams()
  const api = useApi()
  const toast = useToast()
  const nav = useNavigate()

  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)
  const [profileInfo, setProfileInfo] = useState<any>(null)

  const load = async () => {
    setLoading(true)
    try {
      try {
        const p = await api.get(`/users/${encodeURIComponent(username)}`)
        setProfileInfo(p?.data || p)
      } catch {
        setProfileInfo(null)
      }

      const res = await api.get(`/posts?page=1&limit=50`)
      const items: Post[] = res?.data?.items || res?.items || []
      setPosts(items)
    } catch (e: any) {
      toast.push(`Load lỗi: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (username) load() }, [username])

  const mine = useMemo(
    () => posts.filter((p) => (p.authorUsername || p.authorId || '') === username),
    [posts, username],
  )

  return (
    <div className="card">
      <div className="row">
        <strong>@{username}</strong>
        {profileInfo?.followersCount != null && <span className="muted">followers: {profileInfo.followersCount}</span>}
        {profileInfo?.followingCount != null && <span className="muted">following: {profileInfo.followingCount}</span>}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={load}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="muted" style={{ marginTop: 10 }}>Posts</div>

      <div style={{ marginTop: 12 }}>
        {mine.map((p) => (
          <div key={p._id} className="post">
            <div className="row">
              <strong>Post</strong>
              <span className="muted">{p.createdAt ? new Date(p.createdAt).toLocaleString() : ''}</span>
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => nav(`/post/${p._id}`)}>Open</button>
            </div>
            {p.content && <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{p.content}</div>}
            {p.imageUrl && <img src={p.imageUrl} alt="image" />}
          </div>
        ))}
        {!mine.length && !loading && <div className="muted">Chưa có bài.</div>}
      </div>
    </div>
  )
}

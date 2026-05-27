import { useState } from 'react'
import { useApi } from '../lib/api'
import { useToast } from './Toast'

export default function Composer({ onPosted }: { onPosted: () => void }) {
  const api = useApi()
  const toast = useToast()

  const [imageUrl, setImageUrl] = useState('')
  const [content, setContent] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'friends' | 'private'>('public')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const submit = async () => {
    if (!content.trim() && !imageUrl.trim()) {
      setStatus('Nhập caption hoặc image URL')
      return
    }
    setBusy(true)
    setStatus('Posting...')
    try {
      await api.post('/posts', { content, imageUrl, visibility })
      setContent('')
      setImageUrl('')
      setStatus('Posted!')
      toast.push('Created post')
      onPosted()
    } catch (e: any) {
      setStatus(e.message || 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="row">
        <strong>Create</strong>
        <span className="muted">quick post</span>
      </div>

      <div style={{ marginTop: 10 }}>
        <input className="input" placeholder="Image URL (optional)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
      </div>

      <div style={{ marginTop: 10 }}>
        <textarea className="textarea" placeholder="Write something..." value={content} onChange={(e) => setContent(e.target.value)} />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <select
          className="input"
          style={{ width: 160 }}
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as any)}
        >
          <option value="public">public</option>
          <option value="friends">friends</option>
          <option value="private">private</option>
        </select>

        <button className="btn ok" onClick={submit} disabled={busy} style={{ marginLeft: 'auto' }}>
          Post
        </button>
      </div>

      {status && <div className="muted" style={{ marginTop: 8 }}>{status}</div>}
    </div>
  )
}

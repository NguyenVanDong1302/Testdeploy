import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '../../lib/api'
import { useAppStore } from '../../state/store'

type RegisterFormState = {
  username: string
  email: string
  password: string
}

export default function RegisterPage() {
  const api = useApi()
  const navigate = useNavigate()
  const { setState } = useAppStore()
  const [form, setForm] = useState<RegisterFormState>({ username: '', email: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const updateField = (field: keyof RegisterFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await api.post('/auth/register', form)
      const token = res?.data?.token || res?.data?.user?.token || res?.data?.token || ''
      const username = res?.data?.user?.username || form.username
      const role = res?.data?.user?.role === 'admin' ? 'admin' : 'user'
      if (token && username) {
        setState({ token, username, role })
      }
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err?.message || 'Đăng ký thất bại')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#fafafa' }}>
      <form onSubmit={onSubmit} style={{ width: 380, background: '#fff', border: '1px solid #dbdbdb', borderRadius: 16, padding: 24, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, textAlign: 'center' }}>Đăng ký</h2>
        {error ? <div style={{ color: '#ef4444', fontSize: 14 }}>{error}</div> : null}
        <input value={form.username} onChange={(e) => updateField('username', e.target.value)} placeholder="Username" style={{ padding: 12, borderRadius: 10, border: '1px solid #dbdbdb' }} />
        <input value={form.email} onChange={(e) => updateField('email', e.target.value)} placeholder="Email" style={{ padding: 12, borderRadius: 10, border: '1px solid #dbdbdb' }} />
        <input type="password" value={form.password} onChange={(e) => updateField('password', e.target.value)} placeholder="Mật khẩu" style={{ padding: 12, borderRadius: 10, border: '1px solid #dbdbdb' }} />
        <button disabled={submitting} style={{ height: 44, borderRadius: 10, border: 0, background: '#0095f6', color: '#fff', fontWeight: 700 }}>
          {submitting ? 'Đang xử lý...' : 'Tạo tài khoản'}
        </button>
        <Link to="/login" style={{ textAlign: 'center', color: '#0095f6', textDecoration: 'none', fontWeight: 600 }}>Đã có tài khoản? Đăng nhập</Link>
      </form>
    </div>
  )
}

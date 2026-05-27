import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { useAppStore } from '../../state/store'

type LockPayload = {
  reason?: string
  lockedAt?: string | null
}

function readLockPayload(): LockPayload {
  try {
    const raw = localStorage.getItem('account_lock_info')
    if (!raw) return {}
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

export default function AccountLockedPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logout } = useAuth()
  const { setState } = useAppStore()

  const payload = useMemo(() => {
    const fromState = (location.state as any)?.lockInfo || {}
    const fromStorage = readLockPayload()
    return {
      reason: fromState.reason || fromStorage.reason || 'Tài khoản của bạn đang tạm khóa. Vui lòng liên hệ quản trị viên.',
      lockedAt: fromState.lockedAt || fromStorage.lockedAt || null,
    }
  }, [location.state])

  const lockedAtText = payload.lockedAt ? new Date(payload.lockedAt).toLocaleString('vi-VN') : '--'

  const backToLogin = async () => {
    try {
      await logout()
    } catch {
      // ignore
    }
    setState({ username: '', token: '', role: 'user' })
    navigate('/login', { replace: true })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: 'linear-gradient(180deg, #fef2f2 0%, #fff 100%)',
      }}
    >
      <section
        style={{
          width: 'min(560px, 100%)',
          background: '#fff',
          border: '1px solid #fecaca',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 10px 40px rgba(153, 27, 27, 0.08)',
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8, color: '#991b1b' }}>Tài khoản đã bị khóa</h1>
        <p style={{ marginTop: 0, color: '#7f1d1d' }}>{payload.reason}</p>
        <div style={{ marginTop: 12, color: '#7f1d1d', fontSize: 14 }}>
          <strong>Thoi gian khoa:</strong> {lockedAtText}
        </div>
        <button
          type="button"
          onClick={backToLogin}
          style={{
            marginTop: 18,
            border: 0,
            borderRadius: 10,
            padding: '10px 14px',
            background: '#991b1b',
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Quay lại đăng nhập
        </button>
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { useAppStore } from '../../state/store'
import { useApi } from '../../lib/api'

type LockInfo = {
  reason?: string
  lockedAt?: string | null
}

export default function ProtectedRoute() {
  const { user, loading } = useAuth()
  const { state, setState } = useAppStore()
  const api = useApi()
  const location = useLocation()

  const hasBackendSession = Boolean(state.username && state.token)
  const [checkingSession, setCheckingSession] = useState(false)
  const [lockedInfo, setLockedInfo] = useState<LockInfo | null>(null)

  useEffect(() => {
    if (!hasBackendSession) {
      setCheckingSession(false)
      setLockedInfo(null)
      return
    }

    let cancelled = false
    const run = async () => {
      setCheckingSession(true)
      try {
        const res = await api.get('/auth/session-status')
        const locked = Boolean(res?.data?.accountLocked)
        if (cancelled) return
        if (locked) {
          const info = {
            reason: res?.data?.accountLockedReason || 'Tài khoản đã bị khóa',
            lockedAt: res?.data?.accountLockedAt || null,
          }
          localStorage.setItem('account_lock_info', JSON.stringify(info))
          setLockedInfo(info)
        } else {
          localStorage.removeItem('account_lock_info')
          setLockedInfo(null)
        }
      } catch (err: any) {
        if (cancelled) return
        if (err?.data?.code === 'TOKEN_EXPIRED' || err?.data?.code === 'SESSION_MISMATCH') {
          localStorage.removeItem('account_lock_info')
          setState({ username: '', token: '', role: 'user' })
          setLockedInfo(null)
          return
        }
        if (err?.data?.code === 'ACCOUNT_LOCKED') {
          const info = {
            reason: err?.data?.data?.reason || 'Tài khoản đã bị khóa',
            lockedAt: err?.data?.data?.lockedAt || null,
          }
          localStorage.setItem('account_lock_info', JSON.stringify(info))
          setLockedInfo(info)
          return
        }
        setLockedInfo(null)
      } finally {
        if (!cancelled) setCheckingSession(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [api, hasBackendSession, setState, state.token, state.username])

  if ((loading && !hasBackendSession) || checkingSession) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontSize: 16,
          fontWeight: 600,
          color: '#737373',
          background: '#ffffff',
        }}
      >
        Đang kiểm tra phiên đăng nhập...
      </div>
    )
  }

  if (lockedInfo) {
    return <Navigate to="/account-locked" replace state={{ lockInfo: lockedInfo }} />
  }

  if (!user && !hasBackendSession) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

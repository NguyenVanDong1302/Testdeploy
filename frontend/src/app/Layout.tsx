import { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAppStore } from '../state/store'
import { useToast } from '../components/Toast'

export default function Layout({ children }: { children: ReactNode }) {
  const nav = useNavigate()
  const { state } = useAppStore()
  const toast = useToast()

  return (
    <>
      <header className="topbar">
        <div className="brand" onClick={() => nav('/')}>Social</div>
        <div className="search">
          <input
            className="input"
            placeholder="Tìm @username (Enter)…"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const v = (e.currentTarget.value || '').trim()
              if (!v) return
              if (v.startsWith('@')) nav(`/profile/${encodeURIComponent(v.slice(1))}`)
              else toast.push('Search API sẽ làm ở bước sau (Explore).')
              e.currentTarget.value = ''
            }}
          />
        </div>

        <div className="row" style={{ marginLeft: 'auto' }}>
          <button className="icon-btn" onClick={() => nav('/')} title="Home">🏠</button>
          <button className="icon-btn" onClick={() => nav('/notifications')} title="Notifications">🔔</button>
          <button className="pill" onClick={() => nav('/settings')} title="Settings">
            {state.username || 'X-Username'}
          </button>
        </div>
      </header>

      <main className="container">{children}</main>

      <nav className="bottomnav">
        <NavLink to="/" className={({ isActive }) => `navitem ${isActive ? 'active' : ''}`}>🏠<span>Home</span></NavLink>
        <NavLink to="/explore" className={({ isActive }) => `navitem ${isActive ? 'active' : ''}`}>🔎<span>Explore</span></NavLink>
        <NavLink to="/notifications" className={({ isActive }) => `navitem ${isActive ? 'active' : ''}`}>🔔<span>Noti</span></NavLink>
        <NavLink to="/settings" className={({ isActive }) => `navitem ${isActive ? 'active' : ''}`}>⚙️<span>Settings</span></NavLink>
      </nav>
    </>
  )
}

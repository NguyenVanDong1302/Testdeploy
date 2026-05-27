import { type ReactNode, useMemo } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import styles from './Sidebar.module.css'
import desktopStyles from './Sidebar.desktop.module.css'
import tabletStyles from './Sidebar.tablet.module.css'
import mobileStyles from './Sidebar.mobile.module.css'
import { useAuth } from '../../../features/auth/AuthProvider'
import { useNotifications } from '../../../features/notifications/NotificationProvider'
import { useMessageIndicator } from '../../../features/messages/MessageIndicatorProvider'
import { useAppStore } from '../../../state/store'
import { combineResponsiveStyles } from '../../../lib/combineResponsiveStyles'

type NavItem = {
  to?: string
  label: string
  icon: ReactNode
  action?: () => void
  badgeCount?: number
  isActive?: boolean
}

function Icon({ children }: { children: ReactNode }) {
  return <span className={`${styles.icon} ${responsiveStyles.icon}`}>{children}</span>
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

export default function Sidebar({
  compactMode = false,
  onToggleNotifications,
  onToggleSearch,
  notificationsOpen = false,
  searchOpen = false,
}: {
  compactMode?: boolean
  onToggleNotifications?: () => void
  onToggleSearch?: () => void
  notificationsOpen?: boolean
  searchOpen?: boolean
}) {
  const { user, logout } = useAuth()
  const { unreadCount } = useNotifications()
  const { unreadConversations } = useMessageIndicator()
  const { state, setState } = useAppStore()
  const navigate = useNavigate()

  const profileSlug = useMemo(() => {
    const raw = state.username || user?.displayName || user?.email?.split('@')[0] || 'user'
    return encodeURIComponent(raw)
  }, [state.username, user])

  const items: NavItem[] = [
    { to: '/', label: 'Trang chủ', icon: <Icon><svg aria-label="Home" className="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="24" role="img" viewBox="0 0 24 24" width="24"><title>Home</title><path d="m21.762 8.786-7-6.68C13.266.68 10.734.68 9.238 2.106l-7 6.681A4.017 4.017 0 0 0 1 11.68V20c0 1.654 1.346 3 3 3h5.005a1 1 0 0 0 1-1L10 15c0-1.103.897-2 2-2 1.09 0 1.98.877 2 1.962L13.999 22a1 1 0 0 0 1 1H20c1.654 0 3-1.346 3-3v-8.32a4.021 4.021 0 0 0-1.238-2.894ZM21 20a1 1 0 0 1-1 1h-4.001L16 15c0-2.206-1.794-4-4-4s-4 1.794-4 4l.005 6H4a1 1 0 0 1-1-1v-8.32c0-.543.226-1.07.62-1.447l7-6.68c.747-.714 2.013-.714 2.76 0l7 6.68c.394.376.62.904.62 1.448V20Z"></path></svg></Icon> },
    { to: '/reels', label: 'Reels', icon: <Icon><svg aria-label="Reels" className="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="24" role="img" viewBox="0 0 24 24" width="24"><title>Reels</title><path d="M22.935 7.468c-.063-1.36-.307-2.142-.512-2.67a5.341 5.341 0 0 0-1.27-1.95 5.345 5.345 0 0 0-1.95-1.27c-.53-.206-1.311-.45-2.672-.513C15.333 1.012 14.976 1 12 1s-3.333.012-4.532.065c-1.36.063-2.142.307-2.67.512-.77.298-1.371.69-1.95 1.27a5.36 5.36 0 0 0-1.27 1.95c-.206.53-.45 1.311-.513 2.672C1.012 8.667 1 9.024 1 12s.012 3.333.065 4.532c.063 1.36.307 2.142.512 2.67.297.77.69 1.372 1.27 1.95.58.581 1.181.974 1.95 1.27.53.206 1.311.45 2.672.513C8.667 22.988 9.024 23 12 23s3.333-.012 4.532-.065c1.36-.063 2.142-.307 2.67-.512a5.33 5.33 0 0 0 1.95-1.27 5.356 5.356 0 0 0 1.27-1.95c.206-.53.45-1.311.513-2.672.053-1.198.065-1.555.065-4.531s-.012-3.333-.065-4.532Zm-1.998 8.972c-.05 1.07-.228 1.652-.38 2.04-.197.51-.434.874-.82 1.258a3.362 3.362 0 0 1-1.258.82c-.387.151-.97.33-2.038.379-1.162.052-1.51.063-4.441.063s-3.28-.01-4.44-.063c-1.07-.05-1.652-.228-2.04-.38a3.354 3.354 0 0 1-1.258-.82 3.362 3.362 0 0 1-.82-1.258c-.151-.387-.33-.97-.379-2.038C3.011 15.28 3 14.931 3 12s.01-3.28.063-4.44c.05-1.07.228-1.652.38-2.04.197-.51.434-.875.82-1.26a3.372 3.372 0 0 1 1.258-.819c.387-.15.97-.329 2.038-.378C8.72 3.011 9.069 3 12 3s3.28.01 4.44.063c1.07.05 1.652.228 2.04.38.51.197.874.433 1.258.82.385.382.622.747.82 1.258.151.387.33.97.379 2.038C20.989 8.72 21 9.069 21 12s-.01 3.28-.063 4.44Zm-4.584-6.828-5.25-3a2.725 2.725 0 0 0-2.745.01A2.722 2.722 0 0 0 6.988 9v6c0 .992.512 1.88 1.37 2.379.432.25.906.376 1.38.376.468 0 .937-.123 1.365-.367l5.25-3c.868-.496 1.385-1.389 1.385-2.388s-.517-1.892-1.385-2.388Zm-.993 3.04-5.25 3a.74.74 0 0 1-.748-.003.74.74 0 0 1-.374-.649V9a.74.74 0 0 1 .374-.65.737.737 0 0 1 .748-.002l5.25 3c.341.196.378.521.378.652s-.037.456-.378.651Z"></path></svg></Icon> },
    { to: '/messages', label: 'Tin nhắn', icon: <Icon><svg aria-label="Messages" className="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="24" role="img" viewBox="0 0 24 24" width="24"><title>Messages</title><path d="M13.973 20.046 21.77 6.928C22.8 5.195 21.55 3 19.535 3H4.466C2.138 3 .984 5.825 2.646 7.456l4.842 4.752 1.723 7.121c.548 2.266 3.571 2.721 4.762.717Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2"></path><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7.488" x2="15.515" y1="12.208" y2="7.641"></line></svg></Icon> },
    { label: 'Tìm kiếm', icon: <Icon><svg aria-label="Search" className="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="24" role="img" viewBox="0 0 24 24" width="24"><title>Search</title><path d="M19 10.5A8.5 8.5 0 1 1 10.5 2a8.5 8.5 0 0 1 8.5 8.5Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="16.511" x2="22" y1="16.511" y2="22"></line></svg></Icon>, action: onToggleSearch },
    { to: '/explore', label: 'Khám phá', icon: <Icon><svg aria-label="Explore" className="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="24" role="img" viewBox="0 0 24 24" width="24"><title>Explore</title><polygon fill="none" points="13.941 13.953 7.581 16.424 10.06 10.056 16.42 7.585 13.941 13.953" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></polygon><polygon fill-rule="evenodd" points="10.06 10.056 13.949 13.945 7.581 16.424 10.06 10.056"></polygon><circle cx="12.001" cy="12.005" fill="none" r="10.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></circle></svg></Icon> },
    { label: 'Thông báo', icon: <Icon>{notificationsOpen ? '❤️' : '🤍'}</Icon>, action: onToggleNotifications },
    { to: '/create', label: 'Tạo', icon: <Icon><svg aria-label="New post" className="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="24" role="img" viewBox="0 0 24 24" width="24"><title>New post</title><path d="M21 11h-8V3a1 1 0 1 0-2 0v8H3a1 1 0 1 0 0 2h8v8a1 1 0 1 0 2 0v-8h8a1 1 0 1 0 0-2Z"></path></svg></Icon> },
    ...(state.role === 'admin'
      ? [{ to: '/admin', label: 'Quản trị', icon: <Icon>ADM</Icon> } as NavItem]
      : []),
    { to: `/profile/${profileSlug}`, label: 'Trang cá nhân', icon: <Icon>👤</Icon> },
  ]

  items[2] = { ...items[2], badgeCount: unreadConversations }
  items[3] = compactMode
    ? { ...items[3], to: '/search', action: undefined, isActive: false }
    : { ...items[3], to: undefined, isActive: searchOpen }
  items[5] = compactMode
    ? { ...items[5], to: '/notifications', action: undefined, badgeCount: unreadCount, isActive: false }
    : { ...items[5], to: undefined, badgeCount: unreadCount, isActive: notificationsOpen }

  const handleLogout = async () => {
    try {
      if (user) await logout()
    } catch {
      // ignore firebase logout error when using backend auth only
    }
    localStorage.removeItem('account_lock_info')
    setState({ username: '', token: '', role: 'user' })
    navigate('/login', { replace: true })
  }

  return (
    <aside className={cx(styles.sidebar, responsiveStyles.sidebar, 'app-sidebar')} aria-label="Sidebar" data-compact={compactMode ? 'true' : 'false'}>
      <div className={cx(styles.logoRow, responsiveStyles.logoRow, 'app-sidebar__logoRow')}>
        <div className={styles.logoIcon}>T</div>
      </div>

      <nav className={cx(styles.nav, responsiveStyles.nav, 'app-sidebar__nav')}>
        
{items.map((it) => (
  it.to ? (
    <NavLink
      key={it.label}
      to={it.to}
      className={({ isActive }) => cx(styles.item, responsiveStyles.item, 'app-sidebar__item', isActive && styles.active, isActive && responsiveStyles.itemActive)}
      title={it.label}
    >
      <span className={cx(styles.iconWrap, responsiveStyles.iconWrap)}>
        {it.icon}
        {it.badgeCount && it.badgeCount > 0 ? <span className={styles.badge}>{it.badgeCount > 99 ? '99+' : it.badgeCount}</span> : null}
      </span>
      <span className={cx(styles.label, responsiveStyles.label, 'app-sidebar__label')}>{it.label}</span>
    </NavLink>
  ) : (
    <button
      key={it.label}
      type="button"
      className={cx(
        styles.itemBtn,
        responsiveStyles.itemBtn,
        'app-sidebar__item',
        ((it.label === 'Thông báo' && notificationsOpen) || (it.label === 'Tìm kiếm' && searchOpen)) && styles.active,
        ((it.label === 'Thông báo' && notificationsOpen) || (it.label === 'Tìm kiếm' && searchOpen)) && responsiveStyles.itemActive,
      )}
      title={it.label}
      onClick={it.action}
    >
      <span className={cx(styles.iconWrap, responsiveStyles.iconWrap)}>
        {it.icon}
        {it.label === 'Thông báo' && unreadCount > 0 ? <span className={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
      </span>
      <span className={cx(styles.label, responsiveStyles.label, 'app-sidebar__label')}>{it.label}</span>
    </button>
  )
))}

      </nav>

      <div className={cx(styles.bottom, responsiveStyles.bottom, 'app-sidebar__bottom')}>
        <button className={cx(styles.itemBtn, responsiveStyles.itemBtn, 'app-sidebar__item')} type="button" title="Xem thêm">
          <span className={cx(styles.icon, responsiveStyles.icon)}>≡</span>
          <span className={cx(styles.label, responsiveStyles.label, 'app-sidebar__label')}>Xem thêm</span>
        </button>

        <button className={cx(styles.itemBtn, responsiveStyles.itemBtn, 'app-sidebar__item')} type="button" title="Đăng xuất" onClick={handleLogout}>
          <span className={cx(styles.icon, responsiveStyles.icon)}>↪</span>
          <span className={cx(styles.label, responsiveStyles.label, 'app-sidebar__label')}>Đăng xuất</span>
        </button>
      </div>
    </aside>
  )
}

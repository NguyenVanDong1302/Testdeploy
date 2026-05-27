import { ReactNode, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar/Sidebar'
import NotificationsPanel from './NotificationsPanel'
import SearchPanel from './SearchPanel'
import styles from './AppLayout.module.css'
import desktopStyles from './AppLayout.desktop.module.css'
import tabletStyles from './AppLayout.tablet.module.css'
import mobileStyles from './AppLayout.mobile.module.css'
import { combineResponsiveStyles } from '../../lib/combineResponsiveStyles'

const COMPACT_LAYOUT_QUERY = '(max-width: 1024px)'

function getCompactLayoutMatches() {
  if (typeof window === 'undefined') return false
  return window.matchMedia(COMPACT_LAYOUT_QUERY).matches
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [compactMode, setCompactMode] = useState(getCompactLayoutMatches)
  const hideSidebarForRoute = compactMode && location.pathname.startsWith('/messages')

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const mediaQuery = window.matchMedia(COMPACT_LAYOUT_QUERY)
    const handleChange = (event?: MediaQueryListEvent) => {
      setCompactMode(event?.matches ?? mediaQuery.matches)
    }

    handleChange()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  useEffect(() => {
    if (!compactMode) return
    setNotificationsOpen(false)
    setSearchOpen(false)
  }, [compactMode])

  return (
    <div className={cx(styles.shell, responsiveStyles.shell, 'app-shell', hideSidebarForRoute && 'app-shell--messages-compact')}>
      {!hideSidebarForRoute ? (
        <Sidebar
          compactMode={compactMode}
          onToggleNotifications={() => {
            setSearchOpen(false)
            setNotificationsOpen((value) => !value)
          }}
          onToggleSearch={() => {
            setNotificationsOpen(false)
            setSearchOpen((value) => !value)
          }}
          notificationsOpen={notificationsOpen}
          searchOpen={searchOpen}
        />
      ) : null}

      <main className={cx(styles.main, responsiveStyles.main, 'app-layout__main', hideSidebarForRoute && 'app-layout__main--messages-compact')}>{children}</main>

      {!compactMode ? <NotificationsPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} /> : null}
      {!compactMode ? <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} /> : null}
    </div>
  )
}

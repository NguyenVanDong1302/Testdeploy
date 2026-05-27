import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../features/notifications/NotificationProvider'
import { combineResponsiveStyles } from '../../lib/combineResponsiveStyles'
import StoriesBar from './components/StoriesBar/StoriesBar'
import Feed from './components/Feed/Feed'
import styles from './HomePage.module.css'
import desktopStyles from './HomePage.desktop.module.css'
import tabletStyles from './HomePage.tablet.module.css'
import mobileStyles from './HomePage.mobile.module.css'

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

export default function HomePage() {
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()

  return (
    <div className={cx(styles.wrapper, responsiveStyles.wrapper, 'home-page__wrapper')}>
      <div className={cx(styles.center, responsiveStyles.center, 'home-page__center')}>
        <div className={responsiveStyles.mobileHeader}>
          <button className={responsiveStyles.mobileBrand} type="button" onClick={() => navigate('/')}>
            <span className={responsiveStyles.mobileBrandText}>T</span>
            <svg className={responsiveStyles.mobileChevron} viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </button>

          <div className={responsiveStyles.mobileHeaderActions}>
            <button className={responsiveStyles.mobileIconBtn} type="button" aria-label="Tao bai viet" onClick={() => navigate('/create')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>
            <button
              className={`${responsiveStyles.mobileIconBtn} ${responsiveStyles.mobileNotificationBtn}`}
              type="button"
              aria-label="Thông báo"
              onClick={() => navigate('/notifications')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20.5s-7-4.35-9.25-8.04C1 9.51 2.43 6 6.34 6c2.18 0 3.5 1.32 4.03 2.14C10.9 7.32 12.22 6 14.4 6c3.91 0 5.34 3.5 3.59 6.46C18.76 16.15 12 20.5 12 20.5Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
              </svg>
              {unreadCount > 0 ? <span className={responsiveStyles.mobileHeaderBadge} /> : null}
            </button>
          </div>
        </div>

        <StoriesBar />
        <Feed />
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './StoriesBar.module.css'
import desktopStyles from './StoriesBar.desktop.module.css'
import tabletStyles from './StoriesBar.tablet.module.css'
import mobileStyles from './StoriesBar.mobile.module.css'
import { useModal } from '../../../../components/Modal'
import { useToast } from '../../../../components/Toast'
import StoryViewer from './StoryViewer'
import { useStoriesApi } from '../../../../features/stories/stories.api'
import type { StoryGroup } from '../../../../features/stories/stories.types'
import { useUsersApi, type UserSummary } from '../../../../features/users/users.api'
import { getAvatarUrl } from '../../../../lib/avatar'
import { combineResponsiveStyles } from '../../../../lib/combineResponsiveStyles'
import { useAppStore } from '../../../../state/store'

function avatarOf(story?: StoryGroup | null) {
  return getAvatarUrl({ username: story?.username, avatarUrl: story?.avatarUrl })
}

function handleStoryAvatarError(event: SyntheticEvent<HTMLImageElement>, username: string) {
  const image = event.currentTarget
  if (image.dataset.fallback === '1') return
  image.dataset.fallback = '1'
  image.src = getAvatarUrl({ username })
}

function getStartItemIndex(group: StoryGroup) {
  const firstUnseenIndex = group.stories.findIndex((story) => !story.viewedByMe)
  return firstUnseenIndex >= 0 ? firstUnseenIndex : 0
}

function suggestionIdOf(user: UserSummary) {
  return String(user._id || user.id || user.username || '')
}

function buildSuggestedUsers(users: UserSummary[], stories: StoryGroup[], currentUsername: string, followingLookup: Set<string>) {
  const activeStoryAuthors = new Set(
    stories.map((group) => String(group.username || '').trim().toLowerCase()).filter(Boolean),
  )

  return users
    .filter((user) => {
      const username = String(user.username || '').trim()
      const normalizedUsername = username.toLowerCase()

      if (!username) return false
      if (!currentUsername) return false
      if (normalizedUsername === currentUsername) return false
      if (followingLookup.has(normalizedUsername)) return false
      if (activeStoryAuthors.has(normalizedUsername)) return false

      return true
    })
    .slice(0, 8)
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

export default function StoriesBar() {
  const modal = useModal()
  const navigate = useNavigate()
  const toast = useToast()
  const storiesApi = useStoriesApi()
  const usersApi = useUsersApi()
  const { state } = useAppStore()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [stories, setStories] = useState<StoryGroup[]>([])
  const [allUsers, setAllUsers] = useState<UserSummary[]>([])
  const [followingLookup, setFollowingLookup] = useState<Set<string>>(new Set())
  const [followPendingId, setFollowPendingId] = useState('')
  const currentUsername = String(state.username || '').trim().toLowerCase()

  const suggestedUsers = useMemo(
    () => buildSuggestedUsers(allUsers, stories, currentUsername, followingLookup),
    [allUsers, stories, currentUsername, followingLookup],
  )

  useEffect(() => {
    let cancelled = false

    storiesApi
      .list()
      .then((items) => {
        if (!cancelled) setStories(items)
      })
      .catch((error: any) => {
        if (!cancelled) toast.push(error?.message || 'Không tải được stories')
      })

    return () => {
      cancelled = true
    }
  }, [storiesApi, toast])

  useEffect(() => {
    if (!currentUsername) {
      setAllUsers([])
      setFollowingLookup(new Set())
      return
    }

    let cancelled = false

    Promise.all([usersApi.getAllUsers(), usersApi.getFollowing(currentUsername)])
      .then(([users, following]) => {
        if (cancelled) return
        setAllUsers(Array.isArray(users) ? users : [])
        setFollowingLookup(
          new Set((Array.isArray(following) ? following : []).map((user) => String(user.username || '').trim().toLowerCase()).filter(Boolean)),
        )
      })
      .catch(() => {
        if (cancelled) return
        setAllUsers([])
        setFollowingLookup(new Set())
      })

    return () => {
      cancelled = true
    }
  }, [currentUsername, usersApi])

  const openStoryViewer = (groupIndex: number, group: StoryGroup) => {
    modal.openFullscreen(
      <StoryViewer
        groups={stories}
        startGroupIndex={groupIndex}
        startItemIndex={getStartItemIndex(group)}
        onChanged={setStories}
      />,
    )
  }

  const handleCreateStory = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const created = await storiesApi.create(file)
      const list = await storiesApi.list()
      setStories(list)
      const idx = list.findIndex((entry) => entry.authorId === created.authorId)
      modal.openFullscreen(
        <StoryViewer
          groups={list}
          startGroupIndex={Math.max(idx, 0)}
          startItemIndex={0}
          onChanged={setStories}
        />,
      )
    } catch (error: any) {
      toast.push(error?.message || 'Không tạo được story')
    } finally {
      event.currentTarget.value = ''
    }
  }

  const handleFollowSuggestion = async (user: UserSummary) => {
    const targetId = suggestionIdOf(user)
    const username = String(user.username || '').trim()
    if (!targetId || !username || followPendingId) return

    setFollowPendingId(targetId)
    try {
      await usersApi.followUser({ followingId: user._id, username })
      setFollowingLookup((prev) => {
        const next = new Set(prev)
        next.add(username.toLowerCase())
        return next
      })
    } catch (error: any) {
      toast.push(error?.message || 'Không thể theo dõi người dùng')
    } finally {
      setFollowPendingId('')
    }
  }

  return (
    <div className={cx(styles.wrap, responsiveStyles.wrap, 'stories-bar')}>
      <button className={styles.storyBtn} type="button" onClick={() => fileRef.current?.click()}>
        <div className={cx(styles.story, responsiveStyles.story, 'stories-bar__item')}>
          <div className={`${styles.ring} ${styles.ringOwn}`}>
            <div className={`${styles.avatar} ${styles.ownAvatar}`}>+</div>
          </div>
          <div className={styles.name}>Tin của bạn</div>
        </div>
      </button>
      <input ref={fileRef} hidden type="file" accept="image/*,video/*" onChange={handleCreateStory} />
      {stories.map((s, index) => (
        <button
          key={s.id}
          className={styles.storyBtn}
          type="button"
          onClick={() => openStoryViewer(index, s)}
        >
          <div className={cx(styles.story, responsiveStyles.story, 'stories-bar__item')}>
            <div className={`${styles.ring} ${s.hasUnseen ? styles.ringUnseen : styles.ringSeen}`}>
              <img className={styles.avatar} src={avatarOf(s)} alt={s.username} onError={(event) => handleStoryAvatarError(event, s.username)} />
            </div>
            <div className={cx(styles.name, responsiveStyles.name, 'stories-bar__name')}>{s.username}</div>
          </div>
        </button>
      ))}

      {suggestedUsers.map((user) => {
        const suggestionId = suggestionIdOf(user)
        const isPending = followPendingId === suggestionId

        return (
          <div key={`suggestion-${suggestionId}`} className={cx(styles.story, responsiveStyles.story, styles.suggestedStory, 'stories-bar__item')}>
            <button
              type="button"
              className={styles.suggestionProfileBtn}
              onClick={() => navigate(`/profile/${encodeURIComponent(user.username)}`)}
              title={`Mở trang cá nhân ${user.username}`}
            >
              <div className={`${styles.ring} ${styles.ringSuggested}`}>
                <img
                  className={styles.avatar}
                  src={getAvatarUrl({ username: user.username, avatarUrl: user.avatarUrl })}
                  alt={user.username}
                  onError={(event) => handleStoryAvatarError(event, user.username)}
                />
              </div>
              <div className={cx(styles.name, responsiveStyles.name, 'stories-bar__name')}>{user.username}</div>
              <div className={cx(styles.helper, responsiveStyles.helper, 'stories-bar__helper')}>Đề xuất</div>
            </button>

            <button
              type="button"
              className={cx(styles.followQuickAction, responsiveStyles.followQuickAction)}
              disabled={isPending}
              onClick={() => handleFollowSuggestion(user)}
              aria-label={`Theo dõi ${user.username}`}
            >
              {isPending ? '...' : '+'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

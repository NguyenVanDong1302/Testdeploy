import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import styles from './ProfilePage.module.css'
import desktopStyles from './ProfilePage.desktop.module.css'
import tabletStyles from './ProfilePage.tablet.module.css'
import mobileStyles from './ProfilePage.mobile.module.css'
import { useApi, resolveMediaUrl } from '../../lib/api'
import { getAvatarUrl } from '../../lib/avatar'
import { combineResponsiveStyles } from '../../lib/combineResponsiveStyles'
import type { Post } from '../../types'
import { useToast } from '../../components/Toast'
import { useModal } from '../../components/Modal'
import CommentSheet from '../../components/comments/CommentSheet'
import { useAppStore } from '../../state/store'
import { useUsersApi, type UserProfile, type UserSummary } from '../../features/users/users.api'
import { useMessagesApi } from '../../features/messages/messages.api'
import { useStoriesApi } from '../../features/stories/stories.api'
import type { StoryGroup, StoryItem } from '../../features/stories/stories.types'
import StoryViewer from '../Home/components/StoriesBar/StoryViewer'

type Profile = UserProfile

const footerLinks = ['Meta', 'Giới thiệu', 'Blog', 'Việc làm', 'Trợ giúp', 'API', 'Quyền riêng tư', 'Điều khoản', 'Vị trí', 'Meta AI', 'Threads']

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

function IconGrid({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function IconReel({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm0 4h16M9 4l3 6M15 4l3 6M10 14.5v4l4-2-4-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
}
function IconTagged({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M20 12.5v5A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M14.5 3.8h5.7v5.7h-5.7z" stroke="currentColor" strokeWidth="1.8" /><circle cx="17.35" cy="6.65" r="0.95" fill="currentColor" /></svg>
}
function IconArchive({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 7.5h16M6.5 4h11A1.5 1.5 0 0 1 19 5.5v13A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M9 11.5h6M9 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
}
function IconGear({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" strokeWidth="1.8" /><path d="M19.4 15.1c.03-.2.05-.41.05-.62s-.02-.42-.05-.62l2-1.55a.7.7 0 0 0 .17-.9l-1.9-3.29a.7.7 0 0 0-.85-.31l-2.35.95c-.33-.26-.7-.48-1.1-.66l-.35-2.5A.7.7 0 0 0 14.33 3h-3.8a.7.7 0 0 0-.69.59l-.35 2.5c-.4.18-.77.4-1.1.66l-2.35-.95a.7.7 0 0 0-.85.31L3.29 9.4a.7.7 0 0 0 .17.9l2 1.55c-.03.2-.05.41-.05.62s.02.42.05.62l-2 1.55a.7.7 0 0 0-.17.9l1.9 3.29c.18.3.54.42.85.31l2.35-.95c.33.26.7.48 1.1.66l.35 2.5c.05.34.34.59.69.59h3.8c.35 0 .64-.25.69-.59l.35-2.5c.4-.18.77-.4 1.1-.66l2.35.95c.31.12.67-.01.85-.31l1.9-3.29a.7.7 0 0 0-.17-.9l-2-1.55Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
}
function IconMore({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M6.75 12a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm5.25 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm5.25 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" fill="currentColor" /></svg>
}
function IconCamera({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M7.2 6.5 8.8 4h6.4l1.6 2.5H19A2.5 2.5 0 0 1 21.5 9v8A2.5 2.5 0 0 1 19 19.5H5A2.5 2.5 0 0 1 2.5 17V9A2.5 2.5 0 0 1 5 6.5h2.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.7" /></svg>
}

function detectMediaType(item: any): 'image' | 'video' | null {
  const type = String(item?.type || item?.mediaType || '').toLowerCase()
  const mime = String(item?.mimeType || '').toLowerCase()
  const url = String(item?.url || item?.src || item || '').toLowerCase()
  if (type === 'video' || mime.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v)$/i.test(url)) return 'video'
  if (type === 'image' || mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(url)) return 'image'
  return null
}

function normalizeMedia(post: Post): { type: 'image' | 'video'; url: string; thumbnailUrl?: string }[] {
  const items = Array.isArray(post.media) ? post.media : []
  const list = items
    .map((item: any) => {
      const type = detectMediaType(item)
      const url = resolveMediaUrl(item?.url || item?.src)
      if (!type || !url) return null
      return {
        type,
        url,
        thumbnailUrl: resolveMediaUrl(item?.thumbnailUrl || item?.poster || item?.thumbUrl || ''),
      }
    })
    .filter(Boolean) as { type: 'image' | 'video'; url: string; thumbnailUrl?: string }[]

  if (!list.length && post.imageUrl) {
    const url = resolveMediaUrl(post.imageUrl)
    if (url) list.push({ type: detectMediaType({ url }) || 'image', url })
  }
  return list
}

function isReelPost(post: Post) {
  const media = normalizeMedia(post)
  return media.length === 1 && media[0]?.type === 'video'
}

function getTileThumb(post: Post) {
  const media = normalizeMedia(post)
  if (!media.length) return { kind: 'empty' as const, src: '' }
  const first = media[0]
  if (isReelPost(post)) {
    const thumb = resolveMediaUrl((post as any).thumbnailUrl || first.thumbnailUrl || (post as any).poster || '')
    if (thumb) return { kind: 'image' as const, src: thumb }
    return { kind: 'video' as const, src: first.url }
  }
  const imageItem = media.find((item) => item.type === 'image') || first
  return { kind: imageItem.type === 'video' ? 'video' as const : 'image' as const, src: imageItem.url }
}

function ReelTilePreview({ src }: { src: string }) {
  return <video className={styles.tileVideo} src={src} muted playsInline preload="metadata" />
}

function getArchivedStoryThumb(story: StoryItem) {
  const thumb = resolveMediaUrl(story.thumbnailUrl || story.mediaUrl)
  if (!thumb) return { kind: 'empty' as const, src: '' }
  return story.mediaType === 'video'
    ? { kind: 'video' as const, src: thumb }
    : { kind: 'image' as const, src: thumb }
}

function formatArchiveDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

function PostDetailModal({ post, onChanged }: { post: Post; onChanged: () => void }) {
  const media = useMemo(() => normalizeMedia(post), [post])
  const [active, setActive] = useState(0)
  const authorAvatar = getAvatarUrl({ username: post.authorUsername, authorAvatarUrl: (post as any).authorAvatarUrl })
  const current = media[active]
  const detailDate = post.createdAt ? new Date(post.createdAt).toLocaleString() : ''

  return (
    <div className={cx(styles.detailShell, responsiveStyles.detailShell)}>
      <div className={styles.detailMediaCol}>
        <div className={styles.detailMediaWrap}>
          {current?.type === 'video' ? (
            <video className={styles.detailMedia} src={current.url} controls playsInline preload="metadata" />
          ) : current?.url ? (
            <img className={styles.detailMedia} src={current.url} alt={post.content || 'post'} />
          ) : (
            <div className={styles.detailMediaEmpty}>Bài viết này chưa có media.</div>
          )}

          {media.length > 1 ? (
            <>
              <button type="button" className={`${styles.detailNav} ${styles.detailPrev}`} onClick={() => setActive((v) => (v - 1 + media.length) % media.length)}>
                ‹
              </button>
              <button type="button" className={`${styles.detailNav} ${styles.detailNext}`} onClick={() => setActive((v) => (v + 1) % media.length)}>
                ›
              </button>
            </>
          ) : null}
        </div>
        {media.length > 1 ? (
          <div className={styles.detailDots}>
            {media.map((_, index) => (
              <button key={index} type="button" className={`${styles.detailDot} ${index === active ? styles.detailDotActive : ''}`} onClick={() => setActive(index)} />
            ))}
          </div>
        ) : null}
      </div>

      <div className={cx(styles.detailSide, responsiveStyles.detailSide)}>
        <div className={styles.detailHeader}>
          <div className={styles.detailAuthor}>
            <img className={styles.detailAvatar} src={authorAvatar} alt={post.authorUsername || 'user'} />
            <div>
              <div className={styles.detailUsername}>{post.authorUsername || 'Người dùng'}</div>
              {detailDate ? <div className={styles.detailDate}>{detailDate}</div> : null}
              {post.content ? <div className={styles.detailCaption}>{post.content}</div> : null}
            </div>
          </div>
        </div>
        <div className={styles.detailComments}>
          <CommentSheet postId={post._id} onChanged={onChanged} mode="panel" hidePostMeta />
        </div>
      </div>
    </div>
  )
}

type FollowListTab = 'followers' | 'following'

function ConnectionsModal({
  username,
  usersApi,
  initialTab,
  onUnfollow,
}: {
  username: string
  usersApi: ReturnType<typeof useUsersApi>
  initialTab: FollowListTab
  onUnfollow: () => void
}) {
  const [activeTab, setActiveTab] = useState<FollowListTab>(initialTab)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [followers, setFollowers] = useState<UserSummary[]>([])
  const [following, setFollowing] = useState<UserSummary[]>([])
  const [pendingUnfollowId, setPendingUnfollowId] = useState('')
  const [confirmUnfollowUser, setConfirmUnfollowUser] = useState<UserSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const [followerRows, followingRows] = await Promise.all([
          usersApi.getFollowers(username),
          usersApi.getFollowing(username),
        ])
        if (cancelled) return
        setFollowers(followerRows || [])
        setFollowing(followingRows || [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [usersApi, username])

  const rows = activeTab === 'followers' ? followers : following
  const keyword = search.trim().toLowerCase()
  const filteredRows = rows.filter((row) => {
    if (!keyword) return true
    const usernameMatch = String(row.username || '').toLowerCase().includes(keyword)
    const nameMatch = String(row.fullName || '').toLowerCase().includes(keyword)
    return usernameMatch || nameMatch
  })

  const handleUnfollow = async (target: UserSummary) => {
    const targetId = target._id || target.id
    if (!targetId || pendingUnfollowId) return
    try {
      setPendingUnfollowId(targetId)
      await usersApi.unfollowUser({ followingId: targetId, username: target.username })
      setFollowing((prev) => prev.filter((item) => (item._id || item.id) !== targetId))
      onUnfollow()
    } finally {
      setPendingUnfollowId('')
      setConfirmUnfollowUser(null)
    }
  }

  return (
    <div className={styles.connectionsModal}>
      <div className={styles.connectionsTabs}>
        <button type="button" className={`${styles.connectionsTab} ${activeTab === 'followers' ? styles.connectionsTabActive : ''}`} onClick={() => setActiveTab('followers')}>
          Người theo dõi
        </button>
        <button type="button" className={`${styles.connectionsTab} ${activeTab === 'following' ? styles.connectionsTabActive : ''}`} onClick={() => setActiveTab('following')}>
          Đang theo dõi
        </button>
      </div>

      <div className={styles.connectionsSearchWrap}>
        <input className={styles.connectionsSearch} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm kiếm" />
      </div>

      <div className={styles.connectionsList}>
        {loading ? <div className={styles.connectionsEmpty}>Đang tải...</div> : null}
        {!loading && !filteredRows.length ? <div className={styles.connectionsEmpty}>Không tìm thấy người dùng.</div> : null}
        {!loading ? filteredRows.map((row) => {
          const rowId = row._id || row.id
          const isPending = pendingUnfollowId === rowId
          return (
            <div key={rowId} className={styles.connectionsItem}>
              <div className={styles.connectionsUser}>
                <img className={styles.connectionsAvatar} src={getAvatarUrl({ username: row.username, fullName: row.fullName, avatarUrl: row.avatarUrl })} alt={row.username || 'user'} />
                <div className={styles.connectionsMeta}>
                  <div className={styles.connectionsUsername}>{row.username || 'user'}</div>
                  <div className={styles.connectionsName}>{row.fullName || row.bio || ''}</div>
                </div>
              </div>
              {activeTab === 'following' ? (
                <button type="button" className={styles.connectionsActionBtn} disabled={isPending} onClick={() => setConfirmUnfollowUser(row)}>
                  {isPending ? 'Đang xử lý...' : 'Đang theo dõi'}
                </button>
              ) : (
                <span className={styles.connectionsTag}>Người theo dõi</span>
              )}
            </div>
          )
        }) : null}
      </div>

      {confirmUnfollowUser ? (
        <div className={styles.confirmLayer} onMouseDown={() => setConfirmUnfollowUser(null)}>
          <div className={styles.confirmCard} onMouseDown={(event) => event.stopPropagation()}>
            <img className={styles.confirmAvatar} src={getAvatarUrl({ username: confirmUnfollowUser.username, fullName: confirmUnfollowUser.fullName, avatarUrl: confirmUnfollowUser.avatarUrl })} alt={confirmUnfollowUser.username || 'user'} />
            <div className={styles.confirmText}>
              Nếu bạn đổi ý, bạn sẽ phải gửi yêu cầu theo dõi lại @{confirmUnfollowUser.username}.
            </div>
            <button type="button" className={`${styles.confirmBtn} ${styles.confirmDanger}`} onClick={() => void handleUnfollow(confirmUnfollowUser)}>
              Bỏ theo dõi
            </button>
            <button type="button" className={styles.confirmBtn} onClick={() => setConfirmUnfollowUser(null)}>
              Hủy
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function ProfilePage() {
  const { username = '' } = useParams()
  const api = useApi()
  const usersApi = useUsersApi()
  const messagesApi = useMessagesApi()
  const storiesApi = useStoriesApi()
  const toast = useToast()
  const nav = useNavigate()
  const modal = useModal()
  const { state } = useAppStore()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [archivedStories, setArchivedStories] = useState<StoryItem[]>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'posts' | 'reels' | 'tagged' | 'archive'>('posts')
  const [followPending, setFollowPending] = useState(false)
  const [messagePending, setMessagePending] = useState(false)

  const isOwnProfile = !!state.username && state.username === username

  useEffect(() => {
    if (!isOwnProfile && activeTab === 'archive') setActiveTab('posts')
  }, [activeTab, isOwnProfile])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setArchiveLoading(isOwnProfile)
        const [profileRes, postsRes, archiveRes] = await Promise.all([
          usersApi.getProfile(username),
          api.get('/posts?page=1&limit=100'),
          isOwnProfile ? storiesApi.listArchive() : Promise.resolve([] as StoryItem[]),
        ])

        if (cancelled) return
        const allPosts: Post[] = postsRes?.data?.items || postsRes?.items || []
        const mine = allPosts.filter((item) => String(item.authorUsername || item.authorId || '') === username)
        setPosts(mine)
        setProfile(profileRes)
        setArchivedStories(archiveRes || [])
      } catch (error: any) {
        if (cancelled) return
        toast.push(error?.message || 'Không tải được trang cá nhân')
      } finally {
        if (!cancelled) setArchiveLoading(false)
      }
    }
    if (username) load()
    return () => { cancelled = true }
  }, [api, isOwnProfile, storiesApi, toast, username, usersApi])

  const reelPosts = useMemo(() => posts.filter(isReelPost), [posts])
  const shownPosts = activeTab === 'posts' ? posts : activeTab === 'reels' ? reelPosts : []
  const archiveGroup = useMemo<StoryGroup[]>(() => (
    isOwnProfile && profile
      ? [{
          id: `archive-${profile._id}`,
          authorId: profile._id,
          username,
          avatarUrl: profile.avatarUrl,
          hasUnseen: false,
          latestCreatedAt: archivedStories[0]?.createdAt,
          stories: archivedStories,
        }]
      : []
  ), [archivedStories, isOwnProfile, profile, username])
  const avatarSrc = getAvatarUrl({ username, fullName: profile?.fullName, avatarUrl: profile?.avatarUrl })
  const displayName = profile?.fullName?.trim() || username
  const canMessage = !isOwnProfile && !!profile?._id
  const followersCount = profile?.counts?.followers ?? 0
  const followingCount = profile?.counts?.following ?? 0
  const showOwnPostsEmpty = isOwnProfile && activeTab === 'posts' && !shownPosts.length

  const openDetail = (post: Post) => {
    modal.open(
      <PostDetailModal
        post={post}
        onChanged={() => {
          setPosts((prev) => prev.map((item) => (item._id === post._id ? { ...item, commentsCount: (item.commentsCount || 0) + 1 } : item)))
        }}
      />,
    )
  }

  const openArchiveViewer = (startIndex: number) => {
    if (!archiveGroup.length) return
    modal.openFullscreen(
      <StoryViewer
        groups={archiveGroup}
        startGroupIndex={0}
        startItemIndex={startIndex}
        variant="archive"
        onChanged={(items) => {
          setArchivedStories(items[0]?.stories || [])
        }}
      />,
    )
  }

  const handleToggleFollow = async () => {
    if (!profile || !profile.username || followPending || isOwnProfile) return
    const wasFollowing = Boolean(profile.relationship?.isFollowing)
    setFollowPending(true)
    try {
      const result = wasFollowing
        ? await usersApi.unfollowUser({ followingId: profile._id, username: profile.username })
        : await usersApi.followUser({ followingId: profile._id, username: profile.username })

      setProfile((prev) => prev ? ({
        ...prev,
        counts: result.counts,
        relationship: {
          ...(prev.relationship || { isMe: false, isFollowedBy: false, isFollowing: false }),
          ...result.relationship,
        },
      }) : prev)
    } catch (error: any) {
      toast.push(error?.message || 'Không thể cập nhật follow')
    } finally {
      setFollowPending(false)
    }
  }

  const handleMessage = async () => {
    if (!profile?._id || messagePending) return
    setMessagePending(true)
    try {
      const conversation = await messagesApi.createDirectConversation({ targetUserId: profile._id, username: profile.username })
      nav('/messages', {
        state: {
          conversationId: conversation.id,
          directUser: {
            id: conversation.peer.id || profile._id,
            username: conversation.peer.username || profile.username,
            avatarUrl: conversation.peer.avatarUrl || profile.avatarUrl,
            bio: conversation.peer.bio || profile.bio,
          },
        },
      })
    } catch (error: any) {
      toast.push(error?.message || 'Không thể mở đoạn chat')
    } finally {
      setMessagePending(false)
    }
  }

  const openConnectionsModal = (tab: FollowListTab) => {
    if (!isOwnProfile || !profile) return
    modal.open(
      <ConnectionsModal
        username={username}
        usersApi={usersApi}
        initialTab={tab}
        onUnfollow={() => {
          setProfile((prev) => (
            prev
              ? {
                  ...prev,
                  counts: {
                    ...prev.counts,
                    following: Math.max(0, Number(prev.counts?.following || 0) - 1),
                  },
                }
              : prev
          ))
        }}
      />,
    )
  }

  return (
    <div className={cx(styles.page, responsiveStyles.page)}>
      <div className={cx(styles.container, responsiveStyles.container)}>
        <section className={cx(styles.header, responsiveStyles.header)}>
          <div className={cx(styles.avatarWrap, responsiveStyles.avatarWrap)}>
            <div className={cx(styles.avatar, responsiveStyles.avatar)}>
              <img className={styles.avatarImg} src={avatarSrc} alt={username} />
            </div>
          </div>

          <div className={cx(styles.meta, responsiveStyles.meta)}>
            <div className={cx(styles.topRow, responsiveStyles.topRow)}>
              <div className={cx(styles.usernameRow, responsiveStyles.usernameRow)}>
                <div className={cx(styles.username, responsiveStyles.username)}>{username}</div>
                {profile?.isVerified ? <span className={styles.verifiedBadge} title="Tài khoản đã xác thực">✓</span> : null}
                {!isOwnProfile && profile?.relationship?.isFollowedBy ? <span className={styles.mutualBadge}>Theo dõi bạn</span> : null}
                {isOwnProfile ? (
                  <button className={cx(styles.topIconBtn, responsiveStyles.topIconBtn)} type="button" title="Cài đặt" onClick={() => nav('/settings')}>
                    <IconGear size={18} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className={cx(styles.identityBlock, responsiveStyles.identityBlock)}>
              <div className={styles.name}>{displayName}</div>
              {profile?.bio ? <div className={styles.bio}>{profile.bio}</div> : null}
              {profile?.website ? <a className={styles.website} href={profile.website} target="_blank" rel="noreferrer">{profile.website}</a> : null}
            </div>

            <div className={cx(styles.stats, responsiveStyles.stats)}>
              <div className={styles.stat}><b>{posts.length}</b> posts</div>
              {isOwnProfile ? (
                <button type="button" className={`${styles.stat} ${styles.statBtn}`} onClick={() => openConnectionsModal('followers')}>
                  <b>{followersCount}</b> người theo dõi
                </button>
              ) : (
                <div className={styles.stat}><b>{followersCount}</b> người theo dõi</div>
              )}
              {isOwnProfile ? (
                <button type="button" className={`${styles.stat} ${styles.statBtn}`} onClick={() => openConnectionsModal('following')}>
                  <b>{followingCount}</b> đang theo dõi
                </button>
              ) : (
                <div className={styles.stat}><b>{followingCount}</b> đang theo dõi</div>
              )}
            </div>

            <div className={cx(styles.actionsBar, responsiveStyles.actionsBar)}>
              {isOwnProfile ? (
                <div className={cx(styles.actionGroup, styles.ownActionGroup, responsiveStyles.actionGroup, responsiveStyles.ownActionGroup)}>
                  <button className={cx(styles.actionBtn, styles.secondaryBtn, responsiveStyles.actionBtn)} type="button" onClick={() => nav('/settings')}>
                    Chỉnh sửa trang cá nhân
                  </button>
                  <button className={cx(styles.actionBtn, styles.secondaryBtn, responsiveStyles.actionBtn)} type="button" onClick={() => setActiveTab('archive')}>
                    Xem kho lưu trữ
                  </button>
                </div>
              ) : (
                <div className={cx(styles.actionGroup, responsiveStyles.actionGroup)}>
                  <button
                    className={cx(styles.actionBtn, profile?.relationship?.isFollowing ? styles.secondaryBtn : styles.primaryBtn, responsiveStyles.actionBtn)}
                    type="button"
                    onClick={handleToggleFollow}
                    disabled={followPending}
                  >
                    {followPending ? 'Đang xử lý...' : profile?.relationship?.isFollowing ? 'Đang theo dõi' : 'Theo dõi'}
                  </button>
                  <button className={cx(styles.actionBtn, styles.secondaryBtn, responsiveStyles.actionBtn)} type="button" onClick={handleMessage} disabled={!canMessage || messagePending}>
                    {messagePending ? 'Đang mở...' : 'Nhắn tin'}
                  </button>
                  <button className={cx(styles.iconBtn, styles.secondaryBtn, responsiveStyles.iconBtn)} type="button" title="Tùy chọn khác">
                    <IconMore size={17} />
                  </button>
                </div>
              )}
            </div>

            {!isOwnProfile ? (
              <div className={cx(styles.storyHighlights, responsiveStyles.storyHighlights)}>
                <div className={cx(styles.highlightItem, responsiveStyles.highlightItem)}>
                  <span className={cx(styles.highlightRing, responsiveStyles.highlightRing)}><img src={avatarSrc} alt={username} /></span>
                  <span className={styles.highlightLabel}>TÀ XƯA</span>
                </div>
                <div className={cx(styles.highlightItem, responsiveStyles.highlightItem)}>
                  <span className={cx(styles.highlightRing, responsiveStyles.highlightRing)}><img src={avatarSrc} alt={username} /></span>
                  <span className={styles.highlightLabel}>LÝ SƠN</span>
                </div>
                <div className={cx(styles.highlightItem, responsiveStyles.highlightItem)}>
                  <span className={cx(styles.highlightRing, responsiveStyles.highlightRing)}><img src={avatarSrc} alt={username} /></span>
                  <span className={styles.highlightLabel}>SAPA</span>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className={cx(styles.tabs, responsiveStyles.tabs)}>
          <button className={cx(styles.tab, responsiveStyles.tab, activeTab === 'posts' && styles.tabActive)} onClick={() => setActiveTab('posts')}><IconGrid /> <span>Posts</span></button>
          <button className={cx(styles.tab, responsiveStyles.tab, activeTab === 'reels' && styles.tabActive)} onClick={() => setActiveTab('reels')}><IconReel /> <span>Reels</span></button>
          <button className={cx(styles.tab, responsiveStyles.tab, activeTab === 'tagged' && styles.tabActive)} onClick={() => setActiveTab('tagged')}><IconTagged /> <span>Tagged</span></button>
          {isOwnProfile ? <button className={cx(styles.tab, responsiveStyles.tab, activeTab === 'archive' && styles.tabActive)} onClick={() => setActiveTab('archive')}><IconArchive /> <span>Archive</span></button> : null}
        </section>

        <section className={cx(styles.grid, responsiveStyles.grid)}>
          {activeTab === 'archive' ? archivedStories.map((story, index) => {
            const thumb = getArchivedStoryThumb(story)
            return (
              <button key={story.id} className={styles.tile} type="button" onClick={() => openArchiveViewer(index)}>
                {thumb.kind === 'image' ? <img src={thumb.src} alt={story.authorUsername || 'story archive'} loading="lazy" /> : null}
                {thumb.kind === 'video' ? <ReelTilePreview src={thumb.src} /> : null}
                {thumb.kind === 'empty' ? <div className={styles.tileFallback}>Không có media</div> : null}
                <span className={styles.storyBadge}>{story.mediaType === 'video' ? 'Tin video' : 'Tin ảnh'}</span>
                <span className={styles.storyMetaBadge}>{formatArchiveDate(story.archivedAt || story.createdAt)} · {story.viewersCount || 0} lượt xem</span>
                <span className={styles.tileOverlay}><span>Mở kho lưu trữ</span></span>
              </button>
            )
          }) : null}
          {showOwnPostsEmpty ? (
            <div className={cx(styles.emptyPostState, responsiveStyles.emptyPostState)}>
              <div className={styles.emptyPostIcon}>
                <IconCamera size={38} />
              </div>
              <h2 className={styles.emptyPostTitle}>Chia sẻ ảnh</h2>
              <p className={styles.emptyPostText}>Khi bạn chia sẻ ảnh, ảnh sẽ xuất hiện trên trang cá nhân của bạn.</p>
              <button type="button" className={styles.emptyPostCta} onClick={() => nav('/create')}>
                Chia sẻ ảnh đầu tiên của bạn
              </button>
            </div>
          ) : null}
          {(activeTab !== 'archive' ? shownPosts : []).map((post) => {
            const thumb = getTileThumb(post)
            return (
              <button key={post._id} className={styles.tile} type="button" onClick={() => openDetail(post)}>
                {thumb.kind === 'image' ? <img src={thumb.src} alt={post.content || 'post'} loading="lazy" /> : null}
                {thumb.kind === 'video' ? <ReelTilePreview src={thumb.src} /> : null}
                {thumb.kind === 'empty' ? <div className={styles.tileFallback}>Không có media</div> : null}
                {isReelPost(post) ? <span className={styles.reelBadge}>Reel</span> : null}
                <span className={styles.tileOverlay}><span>Mở bài viết</span></span>
              </button>
            )
          })}
          {!showOwnPostsEmpty && activeTab !== 'archive' && !shownPosts.length ? <div className={styles.emptyState}>{activeTab === 'posts' ? 'Chưa có bài viết.' : activeTab === 'reels' ? 'Chưa có reel nào.' : 'Chưa có bài viết được gắn thẻ.'}</div> : null}
          {activeTab === 'archive' && !archiveLoading && !archivedStories.length ? <div className={styles.emptyState}>Chưa có story nào trong kho lưu trữ.</div> : null}
          {activeTab === 'archive' && archiveLoading ? <div className={styles.emptyState}>Đang tải kho lưu trữ...</div> : null}
        </section>

        <footer className={cx(styles.footer, responsiveStyles.footer)}>
          <div className={styles.footerLinks}>{footerLinks.map((t) => <a key={t} href="#" onClick={(e) => e.preventDefault()}>{t}</a>)}</div>
        </footer>
      </div>
    </div>
  )
}

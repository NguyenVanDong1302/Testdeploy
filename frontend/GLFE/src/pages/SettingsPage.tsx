import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { useUsersApi } from '../features/users/users.api'
import { resolveMediaUrl } from '../lib/api'
import { combineResponsiveStyles } from '../lib/combineResponsiveStyles'
import { useAppStore } from '../state/store'
import styles from './SettingsPage.module.css'
import desktopStyles from './SettingsPage.desktop.module.css'
import tabletStyles from './SettingsPage.tablet.module.css'
import mobileStyles from './SettingsPage.mobile.module.css'

const GENDER_OPTIONS = [
  { value: '', label: 'Không muốn tiết lộ' },
  { value: 'Nam', label: 'Nam' },
  { value: 'Nu', label: 'Nữ' },
  { value: 'Khac', label: 'Khác' },
]

const USERNAME_PATTERN = /^[a-z0-9._]{3,30}$/
const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

function fallbackAvatar(username?: string) {
  const seed = encodeURIComponent(username || 'user')
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${seed}`
}

export default function SettingsPage() {
  const { state, setState } = useAppStore()
  const usersApi = useUsersApi()
  const toast = useToast()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const avatarObjectUrlRef = useRef('')

  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingUsername, setSavingUsername] = useState(false)

  const [form, setForm] = useState({
    fullName: '',
    website: '',
    bio: '',
    gender: '',
    showThreadsBadge: false,
    showSuggestedAccountsOnProfile: true,
    isPrivateAccount: false,
    showActivityStatus: true,
    avatarUrl: '',
    avatarFile: null as File | null,
  })

  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('')
  const [usernameDraft, setUsernameDraft] = useState('')
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })

  const revokeAvatarPreview = () => {
    if (!avatarObjectUrlRef.current) return
    URL.revokeObjectURL(avatarObjectUrlRef.current)
    avatarObjectUrlRef.current = ''
  }

  useEffect(() => {
    return () => {
      revokeAvatarPreview()
    }
  }, [])

  useEffect(() => {
    let mounted = true

    ;(async () => {
      try {
        setLoading(true)
        const profile = await usersApi.getProfile(state.username)
        if (!mounted) return

        revokeAvatarPreview()
        setAvatarPreviewUrl('')
        setForm({
          fullName: profile.fullName || '',
          website: profile.website || '',
          bio: profile.bio || '',
          gender: profile.gender || '',
          showThreadsBadge: Boolean(profile.showThreadsBadge),
          showSuggestedAccountsOnProfile: profile.showSuggestedAccountsOnProfile !== false,
          isPrivateAccount: Boolean(profile.isPrivateAccount),
          showActivityStatus: profile.showActivityStatus !== false,
          avatarUrl: profile.avatarUrl || '',
          avatarFile: null,
        })
        setUsernameDraft(profile.username || state.username)
      } catch (error: any) {
        if (!mounted) return
        toast.push(error?.message || 'Không tải được hồ sơ hiện tại')
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [state.username, toast, usersApi])

  const avatarSrc = useMemo(() => {
    if (avatarPreviewUrl) return avatarPreviewUrl
    const normalized = resolveMediaUrl(form.avatarUrl)
    return normalized || fallbackAvatar(state.username)
  }, [avatarPreviewUrl, form.avatarUrl, state.username])

  const handleAvatarPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    revokeAvatarPreview()
    const preview = URL.createObjectURL(file)
    avatarObjectUrlRef.current = preview
    setAvatarPreviewUrl(preview)
    setForm((current) => ({ ...current, avatarFile: file }))
  }

  const handleProfileSubmit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setSavingProfile(true)
      const nextProfile = await usersApi.updateMyProfile({
        fullName: form.fullName,
        website: form.website,
        bio: form.bio,
        gender: form.gender,
        showThreadsBadge: form.showThreadsBadge,
        showSuggestedAccountsOnProfile: form.showSuggestedAccountsOnProfile,
        isPrivateAccount: form.isPrivateAccount,
        showActivityStatus: form.showActivityStatus,
        avatarFile: form.avatarFile,
      })

      revokeAvatarPreview()
      setAvatarPreviewUrl('')
      setForm((current) => ({
        ...current,
        avatarFile: null,
        avatarUrl: nextProfile.avatarUrl || current.avatarUrl,
      }))

      toast.push('Da cap nhat ho so')
      navigate(`/profile/${encodeURIComponent(nextProfile.username || state.username)}`)
    } catch (error: any) {
      toast.push(error?.message || 'Cap nhat that bai')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleUsernameSubmit = async (event: FormEvent) => {
    event.preventDefault()

    const nextUsername = usernameDraft.trim().toLowerCase()
    if (!nextUsername) {
      toast.push('Vui long nhap username moi')
      return
    }
    if (!USERNAME_PATTERN.test(nextUsername)) {
      toast.push('Username chi gom chu thuong, so, dau gach duoi hoac dau cham (3-30 ky tu)')
      return
    }

    try {
      setSavingUsername(true)
      const profile = await usersApi.changeMyUsername({ username: nextUsername })
      const normalized = profile.username || nextUsername

      setState({ username: normalized })
      setUsernameDraft(normalized)
      toast.push('Đã đổi username thành công')
      navigate(`/profile/${encodeURIComponent(normalized)}`)
    } catch (error: any) {
      toast.push(error?.message || 'Không thể đổi username')
    } finally {
      setSavingUsername(false)
    }
  }

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault()

    const { currentPassword, newPassword, confirmPassword } = passwordForm
    if (!currentPassword || !newPassword) {
      toast.push('Vui lòng nhập mật khẩu hiện tại và mật khẩu mới')
      return
    }
    if (newPassword.length < 6) {
      toast.push('Mật khẩu mới phải có ít nhất 6 ký tự')
      return
    }
    if (confirmPassword && confirmPassword !== newPassword) {
      toast.push('Xac nhan mat khau khong khop')
      return
    }

    try {
      setSavingPassword(true)
      await usersApi.changeMyPassword({
        currentPassword,
        newPassword,
        confirmPassword,
      })

      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
      toast.push('Đổi mật khẩu thành công')
    } catch (error: any) {
      toast.push(error?.message || 'Không thể đổi mật khẩu')
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) {
    return <div className={`${styles.state} ${responsiveStyles.state}`}>Đang tải trang chỉnh sửa trang cá nhân...</div>
  }

  return (
    <div className={`${styles.page} ${responsiveStyles.page}`}>
      <form className={`${styles.container} ${responsiveStyles.container}`} onSubmit={handleProfileSubmit}>
        <div className={`${styles.profileCard} ${responsiveStyles.profileCard}`}>
          <div className={`${styles.profileLeft} ${responsiveStyles.profileLeft}`}>
            <img className={styles.avatar} src={avatarSrc} alt={state.username} />
            <div>
              <div className={`${styles.username} ${responsiveStyles.username}`}>{state.username}</div>
              <div className={`${styles.fullName} ${responsiveStyles.fullName}`}>{form.fullName || 'Chưa đặt tên hiển thị'}</div>
            </div>
          </div>
          <button className={`${styles.changePhotoBtn} ${responsiveStyles.changePhotoBtn}`} type="button" onClick={() => fileInputRef.current?.click()}>
            Đổi ảnh
          </button>
          <input ref={fileInputRef} hidden type="file" accept="image/*" onChange={handleAvatarPick} />
        </div>

        <section className={styles.fieldBlock}>
          <label className={styles.label}>Trang web</label>
          <input
            className={styles.input}
            placeholder="Trang web"
            value={form.website}
            onChange={(e) => setForm((current) => ({ ...current, website: e.target.value }))}
          />
        </section>

        <section className={styles.fieldBlock}>
          <label className={styles.label}>Tiểu sử</label>
          <div className={styles.textareaWrap}>
            <textarea
              className={styles.textarea}
              placeholder="Tiểu sử"
              maxLength={150}
              value={form.bio}
              onChange={(e) => setForm((current) => ({ ...current, bio: e.target.value }))}
            />
            <div className={styles.counter}>{form.bio.length} / 150</div>
          </div>
        </section>

        <section className={styles.fieldBlock}>
          <label className={styles.label}>Tên hiển thị</label>
          <input
            className={styles.input}
            placeholder="Tên hiển thị"
            value={form.fullName}
            onChange={(e) => setForm((current) => ({ ...current, fullName: e.target.value }))}
          />
        </section>

        <section className={styles.fieldBlock}>
          <label className={styles.label}>Giới tính</label>
          <div className={styles.selectWrap}>
            <select
              className={styles.select}
              value={form.gender}
              onChange={(e) => setForm((current) => ({ ...current, gender: e.target.value }))}
            >
              {GENDER_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.fieldBlock}>
          <label className={styles.label}>Hiển thị huy hiệu Threads</label>
          <div className={`${styles.switchCard} ${responsiveStyles.switchCard}`}>
            <div className={styles.switchTitle}>Hiển thị huy hiệu Threads</div>
            <button
              type="button"
              className={`${styles.switch} ${form.showThreadsBadge ? styles.switchOn : ''}`}
              onClick={() => setForm((current) => ({ ...current, showThreadsBadge: !current.showThreadsBadge }))}
              aria-pressed={form.showThreadsBadge}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>
        </section>

        <section className={styles.fieldBlock}>
          <label className={styles.label}>Gợi ý tài khoản trên trang cá nhân</label>
          <div className={`${styles.switchCard} ${responsiveStyles.switchCard}`}>
            <div className={styles.switchTitle}>Hiển thị gợi ý tài khoản trên trang cá nhân</div>
            <button
              type="button"
              className={`${styles.switch} ${form.showSuggestedAccountsOnProfile ? styles.switchOn : ''}`}
              onClick={() => setForm((current) => ({ ...current, showSuggestedAccountsOnProfile: !current.showSuggestedAccountsOnProfile }))}
              aria-pressed={form.showSuggestedAccountsOnProfile}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>
        </section>

        <section className={styles.fieldBlock}>
          <label className={styles.label}>Quyền riêng tư tài khoản</label>
          <div className={`${styles.switchCard} ${responsiveStyles.switchCard}`}>
            <div>
              <div className={styles.switchTitle}>Tài khoản riêng tư</div>
              <div className={styles.switchDesc}>Chỉ người theo dõi mới xem được nội dung của bạn.</div>
            </div>
            <button
              type="button"
              className={`${styles.switch} ${form.isPrivateAccount ? styles.switchOn : ''}`}
              onClick={() => setForm((current) => ({ ...current, isPrivateAccount: !current.isPrivateAccount }))}
              aria-pressed={form.isPrivateAccount}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>
        </section>

        <section className={styles.fieldBlock}>
          <label className={styles.label}>Trạng thái hoạt động</label>
          <div className={`${styles.switchCard} ${responsiveStyles.switchCard}`}>
            <div>
              <div className={styles.switchTitle}>Hiển thị trạng thái hoạt động</div>
              <div className={styles.switchDesc}>Cho phép người khác biết khi bạn đang online.</div>
            </div>
            <button
              type="button"
              className={`${styles.switch} ${form.showActivityStatus ? styles.switchOn : ''}`}
              onClick={() => setForm((current) => ({ ...current, showActivityStatus: !current.showActivityStatus }))}
              aria-pressed={form.showActivityStatus}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>
        </section>

        <div className={styles.actions}>
          <button className={`${styles.submitBtn} ${responsiveStyles.submitBtn}`} type="submit" disabled={savingProfile}>
            {savingProfile ? 'Dang luu...' : 'Luu thong tin ho so'}
          </button>
        </div>
      </form>

      <form className={`${styles.panel} ${responsiveStyles.panel}`} onSubmit={handleUsernameSubmit}>
        <div className={styles.panelTitle}>Đổi username</div>
        <div className={`${styles.inlineField} ${responsiveStyles.inlineField}`}>
          <input
            className={styles.input}
            value={usernameDraft}
            onChange={(e) => setUsernameDraft(e.target.value)}
            placeholder="username moi"
            autoComplete="off"
          />
          <button className={`${styles.secondaryBtn} ${responsiveStyles.secondaryBtn}`} type="submit" disabled={savingUsername}>
            {savingUsername ? 'Đang đổi...' : 'Đổi username'}
          </button>
        </div>
      </form>

      <form className={`${styles.panel} ${responsiveStyles.panel}`} onSubmit={handlePasswordSubmit}>
        <div className={styles.panelTitle}>Đổi mật khẩu</div>
        <div className={styles.grid2}>
          <input
            className={styles.input}
            type="password"
            value={passwordForm.currentPassword}
            onChange={(e) => setPasswordForm((current) => ({ ...current, currentPassword: e.target.value }))}
            placeholder="Mật khẩu hiện tại"
            autoComplete="current-password"
          />
          <input
            className={styles.input}
            type="password"
            value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm((current) => ({ ...current, newPassword: e.target.value }))}
            placeholder="Mật khẩu mới"
            autoComplete="new-password"
          />
          <input
            className={styles.input}
            type="password"
            value={passwordForm.confirmPassword}
            onChange={(e) => setPasswordForm((current) => ({ ...current, confirmPassword: e.target.value }))}
            placeholder="Xac nhan mat khau moi"
            autoComplete="new-password"
          />
        </div>
        <div className={styles.actionsLeft}>
          <button className={`${styles.secondaryBtn} ${responsiveStyles.secondaryBtn}`} type="submit" disabled={savingPassword}>
            {savingPassword ? 'Đang cập nhật...' : 'Đổi mật khẩu'}
          </button>
        </div>
      </form>
    </div>
  )
}

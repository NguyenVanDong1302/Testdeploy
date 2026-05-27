import { startTransition, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { resolveMediaUrl } from '../../lib/api'
import { useAppStore } from '../../state/store'
import {
  type AccountStatsResponse,
  type AdminAccountRow,
  type AdminPostDetail,
  type AdminPostRow,
  type AdminViolationsResponse,
  type PaginatedAdminAccounts,
  type PaginatedAdminPosts,
  useAdminApi,
} from '../../features/admin/admin.api'
import { combineResponsiveStyles } from '../../lib/combineResponsiveStyles'
import styles from './AdminPage.module.css'
import desktopStyles from './AdminPage.desktop.module.css'
import tabletStyles from './AdminPage.tablet.module.css'
import mobileStyles from './AdminPage.mobile.module.css'

type AdminTab = 'overview' | 'accounts' | 'posts' | 'reports' | 'violations'
type ReportDecision = 'no_violation' | 'delete_post' | 'strike_account' | 'lock_account'
type AccountModerationStatus = 'normal' | 'warning' | 'violating'
type PostModerationStatus = 'normal' | 'reported' | 'pending_review' | 'violating'
type PostAction = 'delete_post' | 'lock_comments' | 'unlock_comments'
type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

type AccountDraft = {
  commentBlocked: boolean
  messagingBlocked: boolean
  likeBlocked: boolean
  verified: boolean
  dailyPostLimit: number
  accountLocked: boolean
  lockReason: string
  moderationStatus: AccountModerationStatus
  moderationReason: string
}

type ReportDecisionTarget = {
  ids: string[]
  label: string
  source: 'reports' | 'detail'
}

const STORAGE_KEYS = {
  activeTab: 'admin_active_tab_v2',
  autoRefresh: 'admin_auto_refresh_v2',
}

const AUTO_REFRESH_INTERVAL = 60_000

const DEFAULT_POST_FILTERS = {
  startDate: '',
  endDate: '',
  sort: 'engagement_desc' as 'engagement_desc' | 'engagement_asc',
}

const DEFAULT_REPORT_FILTERS = {
  startDate: '',
  endDate: '',
  status: 'all' as 'all' | 'pending' | 'reviewed' | 'accepted' | 'rejected',
  source: 'all' as 'all' | 'user_report' | 'auto_nsfw',
}

const DEFAULT_ACCOUNT_FILTERS = {
  keyword: '',
  status: 'all' as 'all' | 'active' | 'locked',
}

const DEFAULT_POST_MODERATION_DRAFT: { status: PostModerationStatus; reason: string } = {
  status: 'normal',
  reason: '',
}

const REPORT_DECISION_OPTIONS: Array<{
  value: ReportDecision
  label: string
  help: string
  tone: BadgeTone
}> = [
  { value: 'no_violation', label: 'Không vi phạm', help: 'Đóng báo cáo đang chờ.', tone: 'neutral' },
  { value: 'delete_post', label: 'Xóa bài viết', help: 'Gỡ bài viết khỏi hệ thống.', tone: 'danger' },
  { value: 'strike_account', label: 'Cộng 1 lỗi', help: 'Tăng điểm vi phạm cho chủ bài viết.', tone: 'warning' },
  { value: 'lock_account', label: 'Khóa tài khoản', help: 'Khóa tài khoản ngay lập tức.', tone: 'danger' },
]

const ACCOUNT_MODERATION_OPTIONS: Array<{ value: AccountModerationStatus; label: string }> = [
  { value: 'normal', label: 'Bình thường' },
  { value: 'warning', label: 'Cảnh báo' },
  { value: 'violating', label: 'Vi phạm' },
]

const POST_MODERATION_OPTIONS: Array<{ value: PostModerationStatus; label: string }> = [
  { value: 'normal', label: 'Bình thường' },
  { value: 'reported', label: 'Bị báo cáo' },
  { value: 'pending_review', label: 'Chờ duyệt' },
  { value: 'violating', label: 'Vi phạm' },
]

const ACCOUNT_MODERATION_LABELS: Record<AccountModerationStatus, string> = {
  normal: 'Bình thường',
  warning: 'Cảnh báo',
  violating: 'Vi phạm',
}

const POST_MODERATION_LABELS: Record<PostModerationStatus, string> = {
  normal: 'Bình thường',
  reported: 'Bị báo cáo',
  pending_review: 'Chờ duyệt',
  violating: 'Vi phạm',
}

const REPORT_STATUS_LABELS: Record<string, string> = {
  pending: 'Đang chờ',
  reviewed: 'Đã xem xét',
  accepted: 'Đã xác nhận',
  rejected: 'Đã bỏ qua',
}

const REPORT_SOURCE_LABELS: Record<string, string> = {
  user_report: 'Người dùng báo cáo',
  auto_nsfw: 'Tự động phát hiện',
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

function formatDate(date?: string | null) {
  if (!date) return '--'
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return '--'
  return parsed.toLocaleString('vi-VN')
}

function formatNumber(value?: number | null) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0)
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function formatAccountStatus(status?: string | null, locked = false) {
  if (locked) return 'Đã khóa'
  return ACCOUNT_MODERATION_LABELS[normalizeAccountModerationStatus(status)] || 'Bình thường'
}

function formatPostStatus(status?: string | null) {
  return POST_MODERATION_LABELS[normalizePostModerationStatus(status)] || 'Bình thường'
}

function formatReportStatus(status?: string | null) {
  return REPORT_STATUS_LABELS[String(status || '')] || status || 'Đang chờ'
}

function formatReportSource(source?: string | null) {
  return REPORT_SOURCE_LABELS[String(source || '')] || 'Người dùng báo cáo'
}

function formatReportDecision(value: ReportDecision) {
  return REPORT_DECISION_OPTIONS.find((option) => option.value === value)?.label || value
}

function formatRole(role?: string | null) {
  return String(role || '').toLowerCase() === 'admin' ? 'Quản trị viên' : 'Người dùng'
}

function normalizeAccountModerationStatus(value?: string | null): AccountModerationStatus {
  if (value === 'warning' || value === 'violating') return value
  return 'normal'
}

function normalizePostModerationStatus(value?: string | null): PostModerationStatus {
  if (value === 'reported' || value === 'pending_review' || value === 'violating') return value
  return 'normal'
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.empty}>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

function isVideoPreview(mediaType?: string, url?: string) {
  const byType = String(mediaType || '').toLowerCase() === 'video'
  if (byType) return true
  const raw = String(url || '').toLowerCase()
  return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/.test(raw)
}

function toAccountDraft(row: AdminAccountRow): AccountDraft {
  return {
    commentBlocked: Boolean(row.restrictions?.commentBlocked),
    messagingBlocked: Boolean(row.restrictions?.messagingBlocked),
    likeBlocked: Boolean(row.restrictions?.likeBlocked),
    verified: Boolean(row.isVerified),
    dailyPostLimit: Math.max(Number(row.restrictions?.dailyPostLimit || 0), 0),
    accountLocked: Boolean(row.accountLocked),
    lockReason: row.accountLockedReason || '',
    moderationStatus: normalizeAccountModerationStatus(row.moderationStatus),
    moderationReason: row.moderationReason || '',
  }
}

function hasAccountDraftChanged(row: AdminAccountRow, draft: AccountDraft) {
  const current = toAccountDraft(row)
  return (
    current.commentBlocked !== draft.commentBlocked
    || current.messagingBlocked !== draft.messagingBlocked
    || current.likeBlocked !== draft.likeBlocked
    || current.verified !== draft.verified
    || current.dailyPostLimit !== draft.dailyPostLimit
    || current.accountLocked !== draft.accountLocked
    || current.lockReason !== draft.lockReason
    || current.moderationStatus !== draft.moderationStatus
    || current.moderationReason !== draft.moderationReason
  )
}

function summarizeAccountRestrictions(draft: AccountDraft) {
  const items = [
    draft.verified ? 'đã xác minh' : '',
    draft.commentBlocked ? 'chặn bình luận' : '',
    draft.messagingBlocked ? 'chặn nhắn tin' : '',
    draft.likeBlocked ? 'chặn thích' : '',
    draft.dailyPostLimit > 0 ? `${draft.dailyPostLimit} bài/ngày` : '',
  ].filter(Boolean)

  return items.length ? items.join(', ') : 'Không giới hạn'
}

function loadStoredTab(): AdminTab {
  if (typeof window === 'undefined') return 'overview'
  const raw = window.localStorage.getItem(STORAGE_KEYS.activeTab)
  if (raw === 'accounts' || raw === 'posts' || raw === 'reports' || raw === 'violations' || raw === 'overview') {
    return raw
  }
  return 'overview'
}

function loadStoredBoolean(key: string, fallback = false) {
  if (typeof window === 'undefined') return fallback
  return window.localStorage.getItem(key) === '1'
}

function matchesSearch(values: Array<string | number | boolean | null | undefined>, query: string) {
  if (!query) return true
  const haystack = values
    .map((value) => String(value ?? '').trim().toLowerCase())
    .join(' ')
  return haystack.includes(query)
}

function sanitizeReportActions(actions?: ReportDecision[]) {
  const unique = Array.from(new Set((actions || []).filter(Boolean))) as ReportDecision[]
  if (!unique.length) return ['no_violation'] as ReportDecision[]
  if (unique.includes('no_violation') && unique.length > 1) {
    return unique.filter((item) => item !== 'no_violation') as ReportDecision[]
  }
  return unique
}

function resolveReportActionToggle(previous: ReportDecision[], action: ReportDecision) {
  if (action === 'no_violation') return ['no_violation'] as ReportDecision[]

  const withoutNeutral = sanitizeReportActions(previous).filter((item) => item !== 'no_violation')
  if (withoutNeutral.includes(action)) {
    const next = withoutNeutral.filter((item) => item !== action)
    return next.length ? next : (['no_violation'] as ReportDecision[])
  }

  return [...withoutNeutral, action] as ReportDecision[]
}

function escapeCsvCell(value: unknown) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function downloadCsv(filename: string, rows: Array<Array<unknown>>) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const csv = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
}

function badgeToneForAccount(status?: string, locked?: boolean): BadgeTone {
  if (locked) return 'danger'
  if (status === 'violating') return 'danger'
  if (status === 'warning') return 'warning'
  return 'neutral'
}

function badgeToneForPost(status?: string): BadgeTone {
  if (status === 'violating') return 'danger'
  if (status === 'pending_review' || status === 'reported') return 'warning'
  return 'neutral'
}

function badgeToneForReport(status?: string): BadgeTone {
  if (status === 'accepted') return 'danger'
  if (status === 'rejected') return 'success'
  if (status === 'pending') return 'warning'
  return 'neutral'
}

function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone
  children: ReactNode
}) {
  const toneClassName = {
    neutral: styles.badgeNeutral,
    success: styles.badgeSuccess,
    warning: styles.badgeWarning,
    danger: styles.badgeDanger,
    info: styles.badgeInfo,
  }[tone]

  return <span className={`${styles.badge} ${toneClassName}`}>{children}</span>
}

function MetricCard({
  label,
  value,
  help,
  tone = 'neutral',
}: {
  label: string
  value: string
  help?: string
  tone?: BadgeTone
}) {
  return (
    <div className={`${styles.metricCard} ${styles[`metricCard${tone[0].toUpperCase()}${tone.slice(1)}`] || ''}`}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValue}>{value}</div>
      {help ? <div className={styles.metricHelp}>{help}</div> : null}
    </div>
  )
}

function Toggle({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean
  label: string
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={styles.switch}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className={styles.switchTrack}>
        <span className={styles.switchThumb} />
      </span>
      <span>{label}</span>
    </label>
  )
}

export default function AdminPage() {
  const adminApi = useAdminApi()
  const { state } = useAppStore()
  const isAdmin = state.role === 'admin'

  const [activeTab, setActiveTab] = useState<AdminTab>(() => loadStoredTab())
  const [pageSearch, setPageSearch] = useState('')
  const deferredSearch = useDeferredValue(pageSearch.trim().toLowerCase())

  const [loading, setLoading] = useState(false)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(() => loadStoredBoolean(STORAGE_KEYS.autoRefresh))

  const [months, setMonths] = useState(12)
  const [accountStats, setAccountStats] = useState<AccountStatsResponse | null>(null)
  const [overviewTopPosts, setOverviewTopPosts] = useState<PaginatedAdminPosts | null>(null)
  const [overviewQueue, setOverviewQueue] = useState<PaginatedAdminPosts | null>(null)

  const [accountDraftFilters, setAccountDraftFilters] = useState(DEFAULT_ACCOUNT_FILTERS)
  const [accountFilters, setAccountFilters] = useState(DEFAULT_ACCOUNT_FILTERS)
  const [accountsPage, setAccountsPage] = useState(1)
  const [accountsData, setAccountsData] = useState<PaginatedAdminAccounts | null>(null)
  const [accountDraftMap, setAccountDraftMap] = useState<Record<string, AccountDraft>>({})
  const [accountSavingMap, setAccountSavingMap] = useState<Record<string, boolean>>({})
  const [savingVisibleAccounts, setSavingVisibleAccounts] = useState(false)
  const [accountDetailId, setAccountDetailId] = useState<string | null>(null)

  const [postDraftFilters, setPostDraftFilters] = useState(DEFAULT_POST_FILTERS)
  const [postFilters, setPostFilters] = useState(DEFAULT_POST_FILTERS)
  const [postsPage, setPostsPage] = useState(1)
  const [postsData, setPostsData] = useState<PaginatedAdminPosts | null>(null)
  const [postActionSavingMap, setPostActionSavingMap] = useState<Record<string, boolean>>({})

  const [reportDraftFilters, setReportDraftFilters] = useState(DEFAULT_REPORT_FILTERS)
  const [reportFilters, setReportFilters] = useState(DEFAULT_REPORT_FILTERS)
  const [reportsPage, setReportsPage] = useState(1)
  const [reportsData, setReportsData] = useState<PaginatedAdminPosts | null>(null)
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([])
  const [reportDecisionTarget, setReportDecisionTarget] = useState<ReportDecisionTarget | null>(null)
  const [reportDecisionActions, setReportDecisionActions] = useState<ReportDecision[]>(['no_violation'])
  const [reportDecisionReason, setReportDecisionReason] = useState('')
  const [reportDecisionSaving, setReportDecisionSaving] = useState(false)

  const [violationsData, setViolationsData] = useState<AdminViolationsResponse | null>(null)

  const [postDetailOpen, setPostDetailOpen] = useState(false)
  const [postDetailLoading, setPostDetailLoading] = useState(false)
  const [postDetailData, setPostDetailData] = useState<AdminPostDetail | null>(null)
  const [postDetailSource, setPostDetailSource] = useState<'posts' | 'reports'>('posts')
  const [postModerationDraft, setPostModerationDraft] = useState(DEFAULT_POST_MODERATION_DRAFT)
  const [postDetailSaving, setPostDetailSaving] = useState(false)

  const tabs = useMemo(
    () => [
      { key: 'overview' as const, label: 'Tổng quan' },
      { key: 'accounts' as const, label: 'Tài khoản' },
      { key: 'posts' as const, label: 'Bài viết' },
      { key: 'reports' as const, label: 'Báo cáo' },
      { key: 'violations' as const, label: 'Vi phạm' },
    ],
    [],
  )

  const loadOverviewData = async (silent = false) => {
    try {
      if (!silent) setOverviewLoading(true)
      const [stats, queue, topPosts, violations] = await Promise.all([
        adminApi.getAccountStats(months),
        adminApi.getReportedPosts({
          page: 1,
          limit: 6,
          status: 'pending',
          source: 'all',
        }),
        adminApi.getPosts({
          page: 1,
          limit: 6,
          sort: 'engagement_desc',
        }),
        adminApi.getViolations(true),
      ])
      setAccountStats(stats)
      setOverviewQueue(queue)
      setOverviewTopPosts(topPosts)
      setViolationsData(violations)
      setLastSyncedAt(new Date().toISOString())
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải được tổng quan quản trị'))
    } finally {
      if (!silent) setOverviewLoading(false)
    }
  }

  const loadAccountsData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const accounts = await adminApi.getAccounts({
        page: accountsPage,
        limit: 20,
        keyword: accountFilters.keyword,
        status: accountFilters.status,
      })
      setAccountsData(accounts)
      setAccountDraftMap((previous) => {
        const next = { ...previous }
        for (const item of accounts.items || []) {
          const previousDraft = previous[item.id]
          next[item.id] = previousDraft && hasAccountDraftChanged(item, previousDraft)
            ? { ...previousDraft }
            : toAccountDraft(item)
        }
        return next
      })
      setLastSyncedAt(new Date().toISOString())
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải được danh sách tài khoản'))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const loadPostsData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const posts = await adminApi.getPosts({
        page: postsPage,
        limit: 20,
        startDate: postFilters.startDate,
        endDate: postFilters.endDate,
        sort: postFilters.sort,
      })
      setPostsData(posts)
      setLastSyncedAt(new Date().toISOString())
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải được danh sách bài viết'))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const loadReportsData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const reports = await adminApi.getReportedPosts({
        page: reportsPage,
        limit: 20,
        startDate: reportFilters.startDate,
        endDate: reportFilters.endDate,
        status: reportFilters.status,
        source: reportFilters.source,
      })
      setReportsData(reports)
      setLastSyncedAt(new Date().toISOString())
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải được danh sách báo cáo'))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const loadViolationsData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const violations = await adminApi.getViolations(true)
      setViolationsData(violations)
      setLastSyncedAt(new Date().toISOString())
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải được danh sách vi phạm'))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const loadCurrentTab = async (silent = false) => {
    if (activeTab === 'overview') return loadOverviewData(silent)
    if (activeTab === 'accounts') return loadAccountsData(silent)
    if (activeTab === 'posts') return loadPostsData(silent)
    if (activeTab === 'reports') return loadReportsData(silent)
    return loadViolationsData(silent)
  }

  const refreshDashboard = async (silent = false) => {
    setError('')
    const tasks: Promise<unknown>[] = [loadOverviewData(silent)]
    if (activeTab !== 'overview') {
      tasks.push(loadCurrentTab(silent))
    }
    await Promise.allSettled(tasks)
  }

  useEffect(() => {
    if (!isAdmin) return
    void loadOverviewData(false)
  }, [isAdmin, months])

  useEffect(() => {
    if (!isAdmin) return
    if (activeTab === 'overview') return
    void loadCurrentTab(false)
  }, [
    activeTab,
    isAdmin,
    accountsPage,
    accountFilters,
    postsPage,
    postFilters,
    reportsPage,
    reportFilters,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEYS.activeTab, activeTab)
  }, [activeTab])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEYS.autoRefresh, autoRefresh ? '1' : '0')
  }, [autoRefresh])

  useEffect(() => {
    setPageSearch('')
  }, [activeTab])

  useEffect(() => {
    setSelectedReportIds((previous) => {
      const currentIds = new Set((reportsData?.items || []).map((item) => item.id))
      return previous.filter((id) => currentIds.has(id))
    })
  }, [reportsData])

  useEffect(() => {
    if (!autoRefresh || !isAdmin) return
    const timer = window.setInterval(() => {
      void refreshDashboard(true)
    }, AUTO_REFRESH_INTERVAL)
    return () => window.clearInterval(timer)
  }, [
    autoRefresh,
    isAdmin,
    activeTab,
    months,
    accountsPage,
    accountFilters,
    postsPage,
    postFilters,
    reportsPage,
    reportFilters,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (reportDecisionTarget && !reportDecisionSaving) {
        setReportDecisionTarget(null)
        return
      }
      if (postDetailOpen && !postDetailSaving) {
        setPostDetailOpen(false)
        return
      }
      if (accountDetailId && !accountSavingMap[accountDetailId]) {
        setAccountDetailId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [accountDetailId, accountSavingMap, postDetailOpen, postDetailSaving, reportDecisionTarget, reportDecisionSaving])

  const updateAccountDraft = (id: string, patch: Partial<AccountDraft>) => {
    setAccountDraftMap((previous) => ({
      ...previous,
      [id]: {
        ...(previous[id] || {
          commentBlocked: false,
          messagingBlocked: false,
          likeBlocked: false,
          verified: false,
          dailyPostLimit: 0,
          accountLocked: false,
          lockReason: '',
          moderationStatus: 'normal',
          moderationReason: '',
        }),
        ...patch,
      },
    }))
  }

  const persistAccountRow = async (row: AdminAccountRow) => {
    const draft = accountDraftMap[row.id] || toAccountDraft(row)
    await Promise.all([
      adminApi.updateUserRestrictions(row.id, {
        commentBlocked: draft.commentBlocked,
        messagingBlocked: draft.messagingBlocked,
        likeBlocked: draft.likeBlocked,
        verified: draft.verified,
        dailyPostLimit: draft.dailyPostLimit,
        accountLocked: draft.accountLocked,
        lockReason: draft.lockReason,
      }),
      adminApi.updateUserModeration(row.id, {
        status: draft.moderationStatus,
        reason: draft.moderationReason.trim(),
      }),
    ])
  }

  const saveAccountRow = async (row: AdminAccountRow) => {
    setAccountSavingMap((previous) => ({ ...previous, [row.id]: true }))
    setError('')
    setSuccess('')
    try {
      await persistAccountRow(row)
      setSuccess(`Đã lưu thay đổi cho @${row.username}`)
      await Promise.allSettled([loadAccountsData(true), loadOverviewData(true)])
    } catch (err) {
      setError(getErrorMessage(err, 'Không cập nhật được tài khoản'))
    } finally {
      setAccountSavingMap((previous) => ({ ...previous, [row.id]: false }))
    }
  }

  const saveVisibleAccountChanges = async () => {
    const candidates = (accountsData?.items || []).filter((row) => {
      const draft = accountDraftMap[row.id] || toAccountDraft(row)
      return hasAccountDraftChanged(row, draft)
    })
    if (!candidates.length) {
      setSuccess('Không có thay đổi nào cần lưu trong trang hiện tại.')
      return
    }

    const savingIds = Object.fromEntries(candidates.map((row) => [row.id, true]))
    setSavingVisibleAccounts(true)
    setAccountSavingMap((previous) => ({ ...previous, ...savingIds }))
    setError('')
    setSuccess('')

    try {
      const results = await Promise.allSettled(candidates.map((row) => persistAccountRow(row)))
      const successCount = results.filter((item) => item.status === 'fulfilled').length
      const firstFailure = results.find((item) => item.status === 'rejected') as PromiseRejectedResult | undefined

      if (firstFailure) {
        setError(getErrorMessage(firstFailure.reason, 'Có tài khoản lưu thất bại'))
      }
      setSuccess(`Đã lưu ${successCount}/${candidates.length} tài khoản trong trang hiện tại.`)
      await Promise.allSettled([loadAccountsData(true), loadOverviewData(true)])
    } finally {
      setSavingVisibleAccounts(false)
      setAccountSavingMap((previous) => {
        const next = { ...previous }
        for (const row of candidates) {
          next[row.id] = false
        }
        return next
      })
    }
  }

  const resetAccountRow = (row: AdminAccountRow) => {
    updateAccountDraft(row.id, toAccountDraft(row))
  }

  const openAccountDetail = (row: AdminAccountRow) => {
    setAccountDraftMap((previous) => ({
      ...previous,
      [row.id]: previous[row.id] || toAccountDraft(row),
    }))
    setAccountDetailId(row.id)
  }

  const closeAccountDetail = (force = false) => {
    if (accountDetailId && accountSavingMap[accountDetailId] && !force) return
    setAccountDetailId(null)
  }

  const openPostDetail = async (postId: string, source: 'posts' | 'reports') => {
    setPostDetailSource(source)
    setPostDetailOpen(true)
    setPostDetailLoading(true)
    setPostDetailData(null)
    setPostModerationDraft(DEFAULT_POST_MODERATION_DRAFT)
    setError('')
    try {
      const detail = await adminApi.getPostDetail(postId)
      setPostDetailData(detail)
      setPostModerationDraft({
        status: normalizePostModerationStatus(detail.post.moderationStatus),
        reason: detail.post.moderationReason || '',
      })
    } catch (err) {
      setPostDetailOpen(false)
      setError(getErrorMessage(err, 'Không tải được chi tiết bài viết'))
    } finally {
      setPostDetailLoading(false)
    }
  }

  const closePostDetail = (force = false) => {
    if (postDetailSaving && !force) return
    setPostDetailOpen(false)
    setPostDetailLoading(false)
    setPostDetailData(null)
    setPostModerationDraft(DEFAULT_POST_MODERATION_DRAFT)
  }

  const savePostModeration = async () => {
    const postId = postDetailData?.post?.id
    if (!postId) return

    setPostDetailSaving(true)
    setError('')
    setSuccess('')
    try {
      await adminApi.updatePostModeration(postId, {
        status: postModerationDraft.status,
        reason: postModerationDraft.reason.trim(),
      })
      const detail = await adminApi.getPostDetail(postId)
      setPostDetailData(detail)
      setPostModerationDraft({
        status: normalizePostModerationStatus(detail.post.moderationStatus),
        reason: detail.post.moderationReason || postModerationDraft.reason,
      })
      setSuccess('Đã cập nhật kiểm duyệt cho bài viết.')
      await Promise.allSettled([loadOverviewData(true), loadCurrentTab(true)])
    } catch (err) {
      setError(getErrorMessage(err, 'Không cập nhật được kiểm duyệt bài viết'))
    } finally {
      setPostDetailSaving(false)
    }
  }

  const runPostActionFromDetail = async (action: PostAction) => {
    const postId = postDetailData?.post?.id
    if (!postId) return
    if (action === 'delete_post' && !window.confirm('Xóa bài viết này khỏi hệ thống?')) return

    setPostDetailSaving(true)
    setError('')
    setSuccess('')

    try {
      await adminApi.applyPostAction(postId, {
        action,
        reason: postModerationDraft.reason.trim(),
      })
      const actionLabel =
        action === 'delete_post'
          ? 'xóa bài viết'
          : action === 'lock_comments'
            ? 'khóa bình luận'
            : 'mở lại bình luận'
      setSuccess(`Đã ${actionLabel} thành công.`)
      if (action === 'delete_post') {
        closePostDetail(true)
      } else {
        const detail = await adminApi.getPostDetail(postId)
        setPostDetailData(detail)
      }
      await Promise.allSettled([loadOverviewData(true), loadCurrentTab(true)])
    } catch (err) {
      setError(getErrorMessage(err, 'Không áp dụng được thao tác bài viết'))
    } finally {
      setPostDetailSaving(false)
    }
  }

  const runQuickPostAction = async (row: AdminPostRow, action: PostAction) => {
    if (action === 'delete_post' && !window.confirm('Xóa bài viết này khỏi hệ thống?')) return

    setPostActionSavingMap((previous) => ({ ...previous, [row.id]: true }))
    setError('')
    setSuccess('')
    try {
      await adminApi.applyPostAction(row.id, { action })
      setSuccess(
        action === 'lock_comments'
          ? 'Đã khóa bình luận cho bài viết.'
          : action === 'unlock_comments'
            ? 'Đã mở lại bình luận cho bài viết.'
            : 'Đã xóa bài viết thành công.',
      )
      await Promise.allSettled([loadOverviewData(true), loadCurrentTab(true)])
    } catch (err) {
      setError(getErrorMessage(err, 'Không áp dụng được thao tác bài viết'))
    } finally {
      setPostActionSavingMap((previous) => ({ ...previous, [row.id]: false }))
    }
  }

  const openReportDecisionModal = (
    ids: string[],
    label: string,
    defaultActions: ReportDecision[] = ['no_violation'],
    source: 'reports' | 'detail' = 'reports',
  ) => {
    setReportDecisionTarget({ ids, label, source })
    setReportDecisionActions(defaultActions)
    setReportDecisionReason('')
  }

  const saveReportDecision = async () => {
    if (!reportDecisionTarget?.ids.length) return
    const actions = sanitizeReportActions(reportDecisionActions)

    setReportDecisionSaving(true)
    setError('')
    setSuccess('')
    try {
      const results = await Promise.allSettled(
        reportDecisionTarget.ids.map((postId) =>
          adminApi.resolveReportedPost(postId, {
            actions,
            decision: actions[0],
            reason: reportDecisionReason.trim(),
          }),
        ),
      )
      const successCount = results.filter((item) => item.status === 'fulfilled').length
      const firstFailure = results.find((item) => item.status === 'rejected') as PromiseRejectedResult | undefined
      if (firstFailure) {
        setError(getErrorMessage(firstFailure.reason, 'Có báo cáo xử lý thất bại'))
      }
      setSuccess(`Đã xử lý ${successCount}/${reportDecisionTarget.ids.length} mục trong danh sách báo cáo.`)
      setSelectedReportIds((previous) => previous.filter((id) => !reportDecisionTarget.ids.includes(id)))
      setReportDecisionTarget(null)
      if (reportDecisionTarget.source === 'detail') {
        closePostDetail()
      }
      await Promise.allSettled([loadOverviewData(true), loadReportsData(true), loadViolationsData(true)])
    } finally {
      setReportDecisionSaving(false)
    }
  }

  const selectedReportRows = useMemo(() => {
    const reportMap = new Map((reportsData?.items || []).map((item) => [item.id, item]))
    return selectedReportIds.map((id) => reportMap.get(id)).filter(Boolean) as AdminPostRow[]
  }, [reportsData, selectedReportIds])

  const overviewPendingTotal = overviewQueue?.total || 0
  const violationSummary = violationsData?.summary || { violatingAccounts: 0, violatingPosts: 0 }
  const riskAccounts = useMemo(() => {
    return [...(violationsData?.accounts || [])]
      .sort((left, right) => {
        const leftScore = (left.accountLocked ? 100 : 0) + (left.strikesCount || 0) * 10
        const rightScore = (right.accountLocked ? 100 : 0) + (right.strikesCount || 0) * 10
        return rightScore - leftScore
      })
      .slice(0, 6)
  }, [violationsData])

  const visibleAccounts = useMemo(() => {
    return (accountsData?.items || []).filter((row) =>
      matchesSearch(
        [
          row.username,
          row.email,
          row.role,
          row.moderationStatus,
          row.moderationReason,
          row.accountLockedReason,
          row.strikesCount,
        ],
        deferredSearch,
      ),
    )
  }, [accountsData, deferredSearch])

  const visiblePosts = useMemo(() => {
    return (postsData?.items || []).filter((row) =>
      matchesSearch(
        [
          row.title,
          row.fullTitle,
          row.authorUsername,
          row.moderationStatus,
          row.moderationReason,
          row.reportCount,
        ],
        deferredSearch,
      ),
    )
  }, [postsData, deferredSearch])

  const visibleReports = useMemo(() => {
    return (reportsData?.items || []).filter((row) =>
      matchesSearch(
        [
          row.title,
          row.authorUsername,
          row.latestReason,
          row.reportSource,
          row.moderationStatus,
          row.pendingCount,
        ],
        deferredSearch,
      ),
    )
  }, [reportsData, deferredSearch])

  const visibleViolationAccounts = useMemo(() => {
    return (violationsData?.accounts || []).filter((row) =>
      matchesSearch(
        [
          row.username,
          row.email,
          row.moderationStatus,
          row.moderationReason,
          row.accountLockedReason,
          row.strikesCount,
        ],
        deferredSearch,
      ),
    )
  }, [violationsData, deferredSearch])

  const visibleViolationPosts = useMemo(() => {
    return (violationsData?.posts || []).filter((row) =>
      matchesSearch(
        [
          row.title,
          row.authorUsername,
          row.moderationStatus,
          row.moderationReason,
          row.reportCount,
        ],
        deferredSearch,
      ),
    )
  }, [violationsData, deferredSearch])

  const selectedAccountRow = useMemo(() => {
    if (!accountDetailId) return null
    return (accountsData?.items || []).find((row) => row.id === accountDetailId) || null
  }, [accountDetailId, accountsData])

  const selectedAccountDraft = selectedAccountRow
    ? accountDraftMap[selectedAccountRow.id] || toAccountDraft(selectedAccountRow)
    : null
  const selectedAccountChanged = selectedAccountRow && selectedAccountDraft
    ? hasAccountDraftChanged(selectedAccountRow, selectedAccountDraft)
    : false
  const selectedAccountSaving = selectedAccountRow ? Boolean(accountSavingMap[selectedAccountRow.id]) : false

  const accountSummary = useMemo(() => {
    return {
      locked: visibleAccounts.filter((row) => row.accountLocked).length,
      warning: visibleAccounts.filter((row) => row.moderationStatus === 'warning').length,
      violating: visibleAccounts.filter((row) => row.moderationStatus === 'violating').length,
      changed: visibleAccounts.filter((row) => hasAccountDraftChanged(row, accountDraftMap[row.id] || toAccountDraft(row))).length,
    }
  }, [accountDraftMap, visibleAccounts])

  const postSummary = useMemo(() => {
    const totalEngagement = visiblePosts.reduce((sum, row) => sum + (row.engagementCount || 0), 0)
    const totalReports = visiblePosts.reduce((sum, row) => sum + (row.reportCount || 0), 0)
    const lockedComments = visiblePosts.filter((row) => row.allowComments === false).length
    return {
      totalEngagement,
      totalReports,
      lockedComments,
      averageEngagement: visiblePosts.length ? Math.round(totalEngagement / visiblePosts.length) : 0,
    }
  }, [visiblePosts])

  const reportSummary = useMemo(() => {
    return {
      pending: visibleReports.reduce((sum, row) => sum + (row.pendingCount || 0), 0),
      autoFlagged: visibleReports.filter((row) => row.reportSource === 'auto_nsfw').length,
      deletedSnapshots: visibleReports.filter((row) => row.postExists === false).length,
      selected: selectedReportRows.length,
    }
  }, [selectedReportRows.length, visibleReports])

  const allVisibleReportsSelected = useMemo(() => {
    if (!visibleReports.length) return false
    return visibleReports.every((row) => selectedReportIds.includes(row.id))
  }, [selectedReportIds, visibleReports])

  const quickSearchPlaceholder = {
    overview: 'Tìm nhanh trong tổng quan',
    accounts: 'Tìm tài khoản đang hiển thị',
    posts: 'Tìm bài viết đang hiển thị',
    reports: 'Tìm báo cáo đang hiển thị',
    violations: 'Tìm nội dung vi phạm',
  }[activeTab]

  const headerBusy = loading || overviewLoading || savingVisibleAccounts || reportDecisionSaving || postDetailSaving
  const hasActiveTabData = {
    overview: Boolean(accountStats || overviewQueue || overviewTopPosts),
    accounts: Boolean(accountsData),
    posts: Boolean(postsData),
    reports: Boolean(reportsData),
    violations: Boolean(violationsData),
  }[activeTab]
  const showPageLoading = (loading || overviewLoading) && !error && !hasActiveTabData
  const showInlineSync = (loading || overviewLoading) && !error && hasActiveTabData

  const exportCurrentView = () => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    if (activeTab === 'accounts') {
      const rows: Array<Array<unknown>> = [
        ['Tên người dùng', 'Email', 'Vai trò', 'Kiểm duyệt', 'Đã khóa', 'Lỗi', 'Lượt đăng nhập', 'Đăng nhập cuối', 'Giới hạn bài/ngày'],
        ...visibleAccounts.map((row) => {
          const draft = accountDraftMap[row.id] || toAccountDraft(row)
          return [
            row.username,
            row.email,
            formatRole(row.role),
            formatAccountStatus(draft.moderationStatus, draft.accountLocked),
            draft.accountLocked ? 'Có' : 'Không',
            row.strikesCount,
            row.loginCount,
            row.lastLoginAt || '',
            draft.dailyPostLimit,
          ]
        }),
      ]
      downloadCsv(`admin-accounts-${timestamp}.csv`, rows)
      setSuccess(`Đã xuất ${visibleAccounts.length} tài khoản ra CSV.`)
      return
    }

    if (activeTab === 'posts') {
      const rows: Array<Array<unknown>> = [
        ['Tiêu đề', 'Tác giả', 'Ngày tạo', 'Lượt thích', 'Bình luận', 'Báo cáo', 'Tương tác', 'Kiểm duyệt', 'Bình luận'],
        ...visiblePosts.map((row) => [
          row.fullTitle || row.title,
          row.authorUsername,
          row.createdAt || '',
          row.likesCount,
          row.commentsCount,
          row.reportCount || 0,
          row.engagementCount,
          formatPostStatus(row.moderationStatus),
          row.allowComments === false ? 'Đã khóa' : 'Đang mở',
        ]),
      ]
      downloadCsv(`admin-posts-${timestamp}.csv`, rows)
      setSuccess(`Đã xuất ${visiblePosts.length} bài viết ra CSV.`)
      return
    }

    if (activeTab === 'reports') {
      const rows: Array<Array<unknown>> = [
        ['Tiêu đề', 'Tác giả', 'Tổng báo cáo', 'Đang chờ', 'Lý do mới nhất', 'Báo cáo gần nhất', 'Nguồn', 'Kiểm duyệt'],
        ...visibleReports.map((row) => [
          row.fullTitle || row.title,
          row.authorUsername,
          row.reportCount || 0,
          row.pendingCount || 0,
          row.latestReason || '',
          row.lastReportedAt || '',
          formatReportSource(row.reportSource),
          formatPostStatus(row.moderationStatus),
        ]),
      ]
      downloadCsv(`admin-reports-${timestamp}.csv`, rows)
      setSuccess(`Đã xuất ${visibleReports.length} báo cáo ra CSV.`)
      return
    }

    if (activeTab === 'violations') {
      const rows: Array<Array<unknown>> = [
        ['Nhóm', 'Chính', 'Phụ', 'Trạng thái', 'Lý do', 'Chỉ số 1', 'Chỉ số 2'],
        ...visibleViolationAccounts.map((row) => [
          'Tài khoản',
          row.username,
          row.email,
          formatAccountStatus(row.moderationStatus, row.accountLocked),
          row.accountLocked ? row.accountLockedReason : row.moderationReason,
          row.strikesCount,
          row.loginCount,
        ]),
        ...visibleViolationPosts.map((row) => [
          'Bài viết',
          row.title,
          row.authorUsername,
          formatPostStatus(row.moderationStatus),
          row.moderationReason,
          row.reportCount,
          row.engagementCount,
        ]),
      ]
      downloadCsv(`admin-violations-${timestamp}.csv`, rows)
      setSuccess('Đã xuất danh sách vi phạm ra CSV.')
      return
    }

    const rows: Array<Array<unknown>> = [
      ['Chỉ số', 'Giá trị'],
      ['Tổng tài khoản', accountStats?.summary?.totalAccounts || 0],
      ['Tổng lượt đăng nhập', accountStats?.summary?.totalLogins || 0],
      ['Hoạt động 30 ngày', accountStats?.summary?.activeLast30Days || 0],
      ['Báo cáo đang chờ', overviewPendingTotal],
      ['Tài khoản vi phạm', violationSummary.violatingAccounts],
      ['Bài viết vi phạm', violationSummary.violatingPosts],
    ]
    downloadCsv(`admin-overview-${timestamp}.csv`, rows)
    setSuccess('Đã xuất tổng quan quản trị ra CSV.')
  }

  if (!isAdmin) {
    return (
      <div className={`${styles.page} ${responsiveStyles.page}`}>
        <div className={styles.unauthorized}>
          <h2>Không có quyền truy cập</h2>
          <p>Tài khoản hiện tại không có quyền quản trị.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.page} ${responsiveStyles.page}`}>
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroEyebrow}>Quản trị</div>
          <h1 className={styles.title}>Bảng điều khiển quản trị</h1>
          <div className={styles.heroMeta}>
            <Badge tone={headerBusy ? 'warning' : 'success'}>{headerBusy ? 'Đang đồng bộ' : 'Sẵn sàng'}</Badge>
            <span>Đồng bộ cuối: {formatDate(lastSyncedAt)}</span>
            <span>Tự động làm mới: {autoRefresh ? 'Bật (60s)' : 'Tắt'}</span>
          </div>
          <div className={styles.heroActions}>
            <button type="button" className={styles.primaryButton} onClick={() => void refreshDashboard(false)} disabled={headerBusy}>
              Làm mới
            </button>
            <button type="button" className={styles.secondaryButton} onClick={exportCurrentView}>
              Xuất CSV
            </button>
            <label className={styles.toggleInline}>
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              <span>Tự động làm mới</span>
            </label>
            <label className={styles.inlineFieldCompact}>
              <span>Khoảng thống kê</span>
              <select className={styles.compactSelect} value={months} onChange={(event) => setMonths(Number(event.target.value) || 12)}>
                <option value={6}>6 tháng</option>
                <option value={12}>12 tháng</option>
                <option value={18}>18 tháng</option>
                <option value={24}>24 tháng</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <div className={styles.metricGrid}>
        <MetricCard label="Tổng tài khoản" value={formatNumber(accountStats?.summary?.totalAccounts)} help="Tất cả người dùng" tone="info" />
        <MetricCard label="Hoạt động 30 ngày" value={formatNumber(accountStats?.summary?.activeLast30Days)} help="Tài khoản có đăng nhập gần đây" tone="success" />
        <MetricCard label="Báo cáo chờ xử lý" value={formatNumber(overviewPendingTotal)} help="Bài viết đang chờ xem xét" tone="warning" />
        <MetricCard
          label="Vi phạm"
          value={`${formatNumber(violationSummary.violatingAccounts)} tài khoản / ${formatNumber(violationSummary.violatingPosts)} bài`}
          help="Tài khoản và bài viết cần xử lý"
          tone="danger"
        />
      </div>

      <section className={styles.toolbar}>
        <div className={`${styles.tabs} ${responsiveStyles.tabs}`}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabButtonActive : ''}`}
              onClick={() => startTransition(() => setActiveTab(tab.key))}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className={styles.toolbarControls}>
          {showInlineSync ? <span className={styles.syncBadge}>Đang cập nhật...</span> : null}
          <label className={styles.searchBox}>
            <span>Tìm nhanh</span>
            <input value={pageSearch} onChange={(event) => setPageSearch(event.target.value)} placeholder={quickSearchPlaceholder} />
          </label>
          {/* <button type="button" className={styles.secondaryButton} onClick={() => void loadCurrentTab(false)} disabled={headerBusy}>
            Làm mới tab
          </button> */}
        </div>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}
      {showPageLoading ? <div className={styles.loading}>Đang tải dữ liệu...</div> : null}

      {activeTab === 'overview' ? (
        <section className={`${styles.panel} ${responsiveStyles.panel}`}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionEyebrow}>Tổng quan</div>
              <h2 className={styles.sectionTitle}>Những mục cần theo dõi</h2>
            </div>
          </div>

          <div className={styles.overviewGrid}>
            <div className={styles.surfaceCard}>
              <div className={styles.surfaceHeader}>
                <div>
                  <div className={styles.cardTitle}>Đăng nhập nhiều</div>
                  <div className={styles.cardSubtitle}>Người dùng hoạt động gần đây</div>
                </div>
                <button type="button" className={styles.inlineLink} onClick={() => startTransition(() => setActiveTab('accounts'))}>
                  Mở tài khoản
                </button>
              </div>
              {(accountStats?.topLoginUsers || []).length ? (
                <div className={styles.miniList}>
                  {(accountStats?.topLoginUsers || []).map((user) => (
                    <div key={user.id} className={styles.miniListItem}>
                      <div>
                        <div className={styles.miniListTitle}>@{user.username}</div>
                        <div className={styles.miniListMeta}>
                          <Badge tone={user.role === 'admin' ? 'info' : 'neutral'}>{formatRole(user.role)}</Badge>
                          <span>{formatDate(user.lastLoginAt)}</span>
                        </div>
                      </div>
                      <strong>{formatNumber(user.loginCount)} lượt</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Chưa có dữ liệu đăng nhập" text="Khi có hoạt động, danh sách sẽ hiển thị tại đây." />
              )}
            </div>

            <div className={styles.surfaceCard}>
              <div className={styles.surfaceHeader}>
                <div>
                  <div className={styles.cardTitle}>Tài khoản rủi ro</div>
                  <div className={styles.cardSubtitle}>Tài khoản bị khóa, cảnh báo hoặc có lỗi</div>
                </div>
                <button type="button" className={styles.inlineLink} onClick={() => startTransition(() => setActiveTab('violations'))}>
                  Mở vi phạm
                </button>
              </div>
              {riskAccounts.length ? (
                <div className={styles.miniList}>
                  {riskAccounts.map((row) => (
                    <div key={row.id} className={styles.miniListItem}>
                      <div>
                        <div className={styles.miniListTitle}>@{row.username}</div>
                        <div className={styles.miniListMeta}>
                          <Badge tone={badgeToneForAccount(row.moderationStatus, row.accountLocked)}>
                            {formatAccountStatus(row.moderationStatus, row.accountLocked)}
                          </Badge>
                          <span>{row.accountLocked ? row.accountLockedReason || 'Khóa bởi quản trị viên' : row.moderationReason || '--'}</span>
                        </div>
                      </div>
                      <strong>{row.strikesCount} lỗi</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Chưa có tài khoản rủi ro" text="Hệ thống chưa ghi nhận tài khoản cần xử lý." />
              )}
            </div>

            <div className={styles.surfaceCard}>
              <div className={styles.surfaceHeader}>
                <div>
                  <div className={styles.cardTitle}>Báo cáo chờ xử lý</div>
                  <div className={styles.cardSubtitle}>Bài viết cần quản trị viên xem xét</div>
                </div>
                <button type="button" className={styles.inlineLink} onClick={() => startTransition(() => setActiveTab('reports'))}>
                  Mở báo cáo
                </button>
              </div>
              {(overviewQueue?.items || []).length ? (
                <div className={styles.miniList}>
                  {(overviewQueue?.items || []).map((row) => (
                    <div key={row.id} className={styles.miniListItem}>
                      <div>
                        <div className={styles.miniListTitle}>{row.title}</div>
                        <div className={styles.miniListMeta}>
                          <Badge tone="warning">{row.pendingCount || 0} chờ</Badge>
                          <span>@{row.authorUsername}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() => {
                          startTransition(() => setActiveTab('reports'))
                          void openPostDetail(row.id, 'reports')
                        }}
                      >
                        Xem xét
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Không có báo cáo chờ" text="Hiện chưa có bài viết cần xem xét." />
              )}
            </div>

            <div className={`${styles.surfaceCard} ${styles.surfaceCardWide}`}>
              <div className={styles.surfaceHeader}>
                <div>
                  <div className={styles.cardTitle}>Bài viết nổi bật</div>
                  <div className={styles.cardSubtitle}>Các bài viết có tương tác cao</div>
                </div>
                <button type="button" className={styles.inlineLink} onClick={() => startTransition(() => setActiveTab('posts'))}>
                  Mở bài viết
                </button>
              </div>
              {(overviewTopPosts?.items || []).length ? (
                <div className={styles.snapshotGrid}>
                  {(overviewTopPosts?.items || []).map((row) => {
                    const previewUrl = resolveMediaUrl(row.thumbnailUrl || '')
                    return (
                      <article key={row.id} className={styles.snapshotCard}>
                        {previewUrl ? (
                          isVideoPreview(row.mediaType, previewUrl) ? (
                            <video className={styles.snapshotMedia} src={previewUrl} muted playsInline preload="metadata" />
                          ) : (
                            <img className={styles.snapshotMedia} src={previewUrl} alt={row.title} />
                          )
                        ) : (
                          <div className={styles.snapshotFallback}>Không có media</div>
                        )}
                        <div className={styles.snapshotBody}>
                          <h3>{row.title}</h3>
                          <p>@{row.authorUsername}</p>
                          <div className={styles.snapshotStats}>
                            <Badge tone="info">{formatNumber(row.engagementCount)} tương tác</Badge>
                            <Badge tone={row.reportCount ? 'warning' : 'neutral'}>{formatNumber(row.reportCount || 0)} báo cáo</Badge>
                          </div>
                          <div className={styles.inlineActions}>
                            <button type="button" className={styles.ghostButton} onClick={() => void openPostDetail(row.id, 'posts')}>
                              Xem chi tiết
                            </button>
                            <a className={styles.inlineLink} href={`/post/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">
                              Mở bài viết
                            </a>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <EmptyState title="Chưa có bài viết" text="Khi có dữ liệu, bài viết nổi bật sẽ hiển thị tại đây." />
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'accounts' ? (
        <section className={`${styles.panel} ${responsiveStyles.panel}`}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionEyebrow}>Tài khoản</div>
              <h2 className={styles.sectionTitle}>Quản lý tài khoản</h2>
            </div>
            <div className={styles.inlineActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => {
                setAccountsPage(1)
                setAccountDraftFilters(DEFAULT_ACCOUNT_FILTERS)
                startTransition(() => setAccountFilters(DEFAULT_ACCOUNT_FILTERS))
              }}>
                Đặt lại bộ lọc
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void saveVisibleAccountChanges()}
                disabled={savingVisibleAccounts || accountSummary.changed === 0}
              >
                {savingVisibleAccounts ? 'Đang lưu...' : `Lưu ${accountSummary.changed} thay đổi`}
              </button>
            </div>
          </div>

          <div className={`${styles.filters} ${responsiveStyles.filters}`}>
            <label className={styles.inlineField}>
              <span>Tìm tài khoản</span>
              <input
                value={accountDraftFilters.keyword}
                onChange={(event) => setAccountDraftFilters((previous) => ({ ...previous, keyword: event.target.value }))}
                placeholder="Tên người dùng hoặc email"
              />
            </label>
            <label className={styles.inlineField}>
              <span>Trạng thái</span>
              <select
                value={accountDraftFilters.status}
                onChange={(event) =>
                  setAccountDraftFilters((previous) => ({
                    ...previous,
                    status: event.target.value as 'all' | 'active' | 'locked',
                  }))
                }
              >
                <option value="all">Tất cả</option>
                <option value="active">Đang hoạt động</option>
                <option value="locked">Đã khóa</option>
              </select>
            </label>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                setAccountsPage(1)
                startTransition(() => setAccountFilters({ ...accountDraftFilters }))
              }}
            >
              Lọc
            </button>
          </div>

          <div className={styles.metricGridCompact}>
            <MetricCard label="Đang hiển thị" value={formatNumber(visibleAccounts.length)} help="Sau tìm kiếm nhanh" tone="info" />
            <MetricCard label="Đã khóa" value={formatNumber(accountSummary.locked)} help="Tài khoản đang bị khóa" tone="danger" />
            <MetricCard label="Cảnh báo" value={formatNumber(accountSummary.warning)} help="Cần theo dõi" tone="warning" />
            <MetricCard label="Vi phạm" value={formatNumber(accountSummary.violating)} help="Cần xử lý" tone="danger" />
          </div>

          <div className={styles.tableCard}>
            {!accountsData && loading ? (
              <div className={styles.loading}>Đang tải danh sách tài khoản...</div>
            ) : visibleAccounts.length ? (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Tài khoản</th>
                        <th>Hoạt động</th>
                        <th>Trạng thái</th>
                        <th>Giới hạn</th>
                        <th>Hành động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAccounts.map((row) => {
                        const draft = accountDraftMap[row.id] || toAccountDraft(row)
                        const changed = hasAccountDraftChanged(row, draft)
                        const moderationNote = draft.accountLocked
                          ? draft.lockReason || row.accountLockedReason || '--'
                          : draft.moderationReason || row.moderationReason || '--'
                        return (
                          <tr key={row.id} className={changed ? styles.rowDirty : ''}>
                            <td>
                              <div className={styles.cellStack}>
                                <strong>@{row.username}</strong>
                                <span>{row.email}</span>
                                <div className={styles.badgeGroup}>
                                  <Badge tone={row.role === 'admin' ? 'info' : 'neutral'}>{formatRole(row.role)}</Badge>
                                  {draft.verified ? <Badge tone="success">Đã xác minh</Badge> : null}
                                  <Badge tone={badgeToneForAccount(draft.moderationStatus, draft.accountLocked)}>
                                    {formatAccountStatus(draft.moderationStatus, draft.accountLocked)}
                                  </Badge>
                                  {row.strikesCount > 0 ? <Badge tone="warning">{row.strikesCount} lỗi</Badge> : null}
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className={styles.cellStack}>
                                <strong>{formatNumber(row.loginCount)} lượt đăng nhập</strong>
                                <span>Lần cuối: {formatDate(row.lastLoginAt)}</span>
                                <span>Tạo lúc: {formatDate(row.createdAt)}</span>
                              </div>
                            </td>
                            <td>
                              <div className={styles.cellStack}>
                                <div className={styles.badgeGroup}>
                                  <Badge tone={badgeToneForAccount(draft.moderationStatus, draft.accountLocked)}>
                                    {formatAccountStatus(draft.moderationStatus, draft.accountLocked)}
                                  </Badge>
                                  {changed ? <Badge tone="warning">Có thay đổi</Badge> : null}
                                </div>
                                <span>{moderationNote}</span>
                              </div>
                            </td>
                            <td>
                              <div className={styles.cellStack}>
                                <span>{summarizeAccountRestrictions(draft)}</span>
                                <span>{draft.accountLocked ? `Khóa từ: ${formatDate(row.accountLockedAt)}` : 'Tài khoản đang mở'}</span>
                              </div>
                            </td>
                            <td>
                              <div className={styles.actionColumn}>
                                <button
                                  type="button"
                                  className={styles.primaryButton}
                                  onClick={() => openAccountDetail(row)}
                                >
                                  Chi tiết
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={styles.pagination}>
                  <button type="button" onClick={() => setAccountsPage((previous) => Math.max(previous - 1, 1))} disabled={accountsPage <= 1}>
                    Trước
                  </button>
                  <span>Trang {accountsData?.page}/{accountsData?.totalPages} • {formatNumber(accountsData?.total)} tài khoản</span>
                  <button
                    type="button"
                    onClick={() => setAccountsPage((previous) => Math.min(previous + 1, accountsData?.totalPages || 1))}
                    disabled={accountsPage >= (accountsData?.totalPages || 1)}
                  >
                    Sau
                  </button>
                </div>
              </>
            ) : (
              <EmptyState title="Không có tài khoản phù hợp" text="Thử đổi bộ lọc hoặc xóa tìm kiếm nhanh." />
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'posts' ? (
        <section className={`${styles.panel} ${responsiveStyles.panel}`}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionEyebrow}>Bài viết</div>
              <h2 className={styles.sectionTitle}>Quản lý bài viết</h2>
            </div>
          </div>

          <div className={`${styles.filters} ${responsiveStyles.filters}`}>
            <label className={styles.inlineField}>
              <span>Từ ngày</span>
              <input
                type="date"
                value={postDraftFilters.startDate}
                onChange={(event) => setPostDraftFilters((previous) => ({ ...previous, startDate: event.target.value }))}
              />
            </label>
            <label className={styles.inlineField}>
              <span>Đến ngày</span>
              <input
                type="date"
                value={postDraftFilters.endDate}
                onChange={(event) => setPostDraftFilters((previous) => ({ ...previous, endDate: event.target.value }))}
              />
            </label>
            <label className={styles.inlineField}>
              <span>Sắp xếp tương tác</span>
              <select
                value={postDraftFilters.sort}
                onChange={(event) =>
                  setPostDraftFilters((previous) => ({
                    ...previous,
                    sort: event.target.value as 'engagement_desc' | 'engagement_asc',
                  }))
                }
              >
                <option value="engagement_desc">Giảm dần</option>
                <option value="engagement_asc">Tăng dần</option>
              </select>
            </label>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                setPostsPage(1)
                startTransition(() => setPostFilters({ ...postDraftFilters }))
              }}
            >
              Lọc
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                setPostsPage(1)
                setPostDraftFilters(DEFAULT_POST_FILTERS)
                startTransition(() => setPostFilters(DEFAULT_POST_FILTERS))
              }}
            >
              Đặt lại
            </button>
          </div>

          <div className={styles.metricGridCompact}>
            <MetricCard label="Đang hiển thị" value={formatNumber(visiblePosts.length)} help="Sau tìm kiếm nhanh" tone="info" />
            <MetricCard label="Tổng tương tác" value={formatNumber(postSummary.totalEngagement)} help="Lượt thích và bình luận" tone="success" />
            <MetricCard label="Tổng báo cáo" value={formatNumber(postSummary.totalReports)} help="Cần theo dõi" tone="warning" />
            <MetricCard label="Bình luận bị khóa" value={formatNumber(postSummary.lockedComments)} help="Có thể mở lại trong bảng" tone="neutral" />
          </div>

          <div className={styles.tableCard}>
            {!postsData && loading ? (
              <div className={styles.loading}>Đang tải danh sách bài viết...</div>
            ) : visiblePosts.length ? (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Bài viết</th>
                        <th>Chỉ số</th>
                        <th>Trạng thái</th>
                        <th>Thời gian</th>
                        <th>Hành động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePosts.map((row) => {
                        const previewUrl = resolveMediaUrl(row.thumbnailUrl || '')
                        const saving = !!postActionSavingMap[row.id]
                        return (
                          <tr key={row.id}>
                            <td>
                              <div className={styles.postCell}>
                                {previewUrl ? (
                                  isVideoPreview(row.mediaType, previewUrl) ? (
                                    <video className={styles.tableThumb} src={previewUrl} muted playsInline preload="metadata" />
                                  ) : (
                                    <img className={styles.tableThumb} src={previewUrl} alt={row.title} />
                                  )
                                ) : (
                                  <div className={styles.tableThumbFallback}>Không có media</div>
                                )}
                                <div className={styles.cellStack}>
                                  <strong>{row.title}</strong>
                                  <span>@{row.authorUsername}</span>
                                  <div className={styles.badgeGroup}>
                                    <Badge tone={badgeToneForPost(row.moderationStatus)}>{formatPostStatus(row.moderationStatus)}</Badge>
                                    <Badge tone={row.allowComments === false ? 'warning' : 'success'}>
                                      {row.allowComments === false ? 'Đã khóa bình luận' : 'Đang mở bình luận'}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className={styles.metricList}>
                                <span>Thích: <strong>{formatNumber(row.likesCount)}</strong></span>
                                <span>Bình luận: <strong>{formatNumber(row.commentsCount)}</strong></span>
                                <span>Báo cáo: <strong>{formatNumber(row.reportCount || 0)}</strong></span>
                                <span>Tương tác: <strong>{formatNumber(row.engagementCount)}</strong></span>
                              </div>
                            </td>
                            <td>
                              <div className={styles.cellStack}>
                                {row.moderationReason ? <span>{row.moderationReason}</span> : <span>Chưa có lý do kiểm duyệt</span>}
                                {row.reportCount ? <Badge tone="warning">Cần xem báo cáo</Badge> : null}
                              </div>
                            </td>
                            <td>
                              <div className={styles.cellStack}>
                                <strong>{formatDate(row.createdAt)}</strong>
                                <span>TB tương tác: {formatNumber(postSummary.averageEngagement)}</span>
                              </div>
                            </td>
                            <td>
                              <div className={styles.actionColumn}>
                                <button type="button" className={styles.primaryButton} onClick={() => void openPostDetail(row.id, 'posts')}>
                                  Xem chi tiết
                                </button>
                                <button
                                  type="button"
                                  className={styles.secondaryButton}
                                  disabled={saving}
                                  onClick={() => void runQuickPostAction(row, row.allowComments === false ? 'unlock_comments' : 'lock_comments')}
                                >
                                  {saving ? 'Đang xử lý...' : row.allowComments === false ? 'Mở bình luận' : 'Khóa bình luận'}
                                </button>
                                <a className={styles.inlineLink} href={`/post/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">
                                  Mở bài viết
                                </a>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={styles.pagination}>
                  <button type="button" onClick={() => setPostsPage((previous) => Math.max(previous - 1, 1))} disabled={postsPage <= 1}>
                    Trước
                  </button>
                  <span>Trang {postsData?.page}/{postsData?.totalPages} • {formatNumber(postsData?.total)} bài viết</span>
                  <button
                    type="button"
                    onClick={() => setPostsPage((previous) => Math.min(previous + 1, postsData?.totalPages || 1))}
                    disabled={postsPage >= (postsData?.totalPages || 1)}
                  >
                    Sau
                  </button>
                </div>
              </>
            ) : (
              <EmptyState title="Không có bài viết phù hợp" text="Thử đổi bộ lọc thời gian hoặc xóa tìm kiếm nhanh." />
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'reports' ? (
        <section className={`${styles.panel} ${responsiveStyles.panel}`}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionEyebrow}>Báo cáo</div>
              <h2 className={styles.sectionTitle}>Xử lý báo cáo bài viết</h2>
            </div>
            {selectedReportRows.length ? (
              <div className={styles.bulkBanner}>
                <span>Đang chọn {selectedReportRows.length} mục</span>
                <div className={styles.inlineActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => openReportDecisionModal(selectedReportIds, `${selectedReportRows.length} báo cáo`, ['no_violation'])}
                  >
                    Bỏ qua báo cáo
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => openReportDecisionModal(selectedReportIds, `${selectedReportRows.length} báo cáo`, ['delete_post'])}
                  >
                    Xử lý hàng loạt
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className={`${styles.filters} ${responsiveStyles.filters}`}>
            <label className={styles.inlineField}>
              <span>Từ ngày</span>
              <input
                type="date"
                value={reportDraftFilters.startDate}
                onChange={(event) => setReportDraftFilters((previous) => ({ ...previous, startDate: event.target.value }))}
              />
            </label>
            <label className={styles.inlineField}>
              <span>Đến ngày</span>
              <input
                type="date"
                value={reportDraftFilters.endDate}
                onChange={(event) => setReportDraftFilters((previous) => ({ ...previous, endDate: event.target.value }))}
              />
            </label>
            <label className={styles.inlineField}>
              <span>Trạng thái</span>
              <select
                value={reportDraftFilters.status}
                onChange={(event) =>
                  setReportDraftFilters((previous) => ({
                    ...previous,
                    status: event.target.value as 'all' | 'pending' | 'reviewed' | 'accepted' | 'rejected',
                  }))
                }
              >
                <option value="all">Tất cả</option>
                <option value="pending">Đang chờ</option>
                <option value="reviewed">Đã xem xét</option>
                <option value="accepted">Đã xác nhận</option>
                <option value="rejected">Đã bỏ qua</option>
              </select>
            </label>
            <label className={styles.inlineField}>
              <span>Nguồn báo cáo</span>
              <select
                value={reportDraftFilters.source}
                onChange={(event) =>
                  setReportDraftFilters((previous) => ({
                    ...previous,
                    source: event.target.value as 'all' | 'user_report' | 'auto_nsfw',
                  }))
                }
              >
                <option value="all">Tất cả</option>
                <option value="user_report">Người dùng</option>
                <option value="auto_nsfw">Tự động phát hiện</option>
              </select>
            </label>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                setReportsPage(1)
                startTransition(() => setReportFilters({ ...reportDraftFilters }))
              }}
            >
              Lọc
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                setReportsPage(1)
                setReportDraftFilters(DEFAULT_REPORT_FILTERS)
                startTransition(() => setReportFilters(DEFAULT_REPORT_FILTERS))
              }}
            >
              Đặt lại
            </button>
          </div>

          <div className={styles.metricGridCompact}>
            <MetricCard label="Đang chờ" value={formatNumber(reportSummary.pending)} help="Trong danh sách hiện tại" tone="warning" />
            <MetricCard label="Tự động phát hiện" value={formatNumber(reportSummary.autoFlagged)} help="Do hệ thống gửi lên" tone="info" />
            <MetricCard label="Bài đã xóa" value={formatNumber(reportSummary.deletedSnapshots)} help="Còn bản ghi để xem lại" tone="neutral" />
            <MetricCard label="Đang chọn" value={formatNumber(reportSummary.selected)} help="Dùng cho xử lý hàng loạt" tone="success" />
          </div>

          <div className={styles.tableCard}>
            {!reportsData && loading ? (
              <div className={styles.loading}>Đang tải danh sách báo cáo...</div>
            ) : visibleReports.length ? (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            checked={allVisibleReportsSelected}
                            onChange={() =>
                              setSelectedReportIds((previous) =>
                                allVisibleReportsSelected
                                  ? previous.filter((id) => !visibleReports.some((row) => row.id === id))
                                  : Array.from(new Set([...previous, ...visibleReports.map((row) => row.id)])),
                              )
                            }
                          />
                        </th>
                        <th>Bài viết</th>
                        <th>Chi tiết báo cáo</th>
                        <th>Trạng thái</th>
                        <th>Thời gian</th>
                        <th>Hành động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReports.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedReportIds.includes(row.id)}
                              onChange={() =>
                                setSelectedReportIds((previous) =>
                                  previous.includes(row.id)
                                    ? previous.filter((id) => id !== row.id)
                                    : [...previous, row.id],
                                )
                              }
                            />
                          </td>
                          <td>
                            <div className={styles.cellStack}>
                              <strong>{row.title}</strong>
                              <span>@{row.authorUsername}</span>
                              <div className={styles.badgeGroup}>
                                <Badge tone={row.reportSource === 'auto_nsfw' ? 'info' : 'neutral'}>
                                  {formatReportSource(row.reportSource)}
                                </Badge>
                                {row.postExists === false ? <Badge tone="warning">Chỉ còn bản ghi</Badge> : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.metricList}>
                              <span>Báo cáo: <strong>{formatNumber(row.reportCount || 0)}</strong></span>
                              <span>Đang chờ: <strong>{formatNumber(row.pendingCount || 0)}</strong></span>
                              <span>Lý do mới nhất: <strong>{row.latestReason || '--'}</strong></span>
                            </div>
                          </td>
                          <td>
                            <div className={styles.cellStack}>
                              <div className={styles.badgeGroup}>
                                {(row.statuses || []).length ? (
                                  row.statuses?.map((status) => (
                                    <Badge key={status} tone={badgeToneForReport(status)}>
                                      {formatReportStatus(status)}
                                    </Badge>
                                  ))
                                ) : (
                                  <Badge tone="warning">Đang chờ</Badge>
                                )}
                                <Badge tone={badgeToneForPost(row.moderationStatus)}>{formatPostStatus(row.moderationStatus)}</Badge>
                              </div>
                              {row.moderationReason ? <span>{row.moderationReason}</span> : null}
                            </div>
                          </td>
                          <td>
                            <div className={styles.cellStack}>
                              <strong>{formatDate(row.lastReportedAt)}</strong>
                              <span>Tạo bài: {formatDate(row.createdAt)}</span>
                            </div>
                          </td>
                          <td>
                            <div className={styles.actionColumn}>
                              <button type="button" className={styles.primaryButton} onClick={() => void openPostDetail(row.id, 'reports')}>
                                Xem xét
                              </button>
                              <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => openReportDecisionModal([row.id], row.title || row.id, ['no_violation'])}
                              >
                                Bỏ qua
                              </button>
                              <a className={styles.inlineLink} href={`/post/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">
                                Mở bài viết
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.pagination}>
                  <button type="button" onClick={() => setReportsPage((previous) => Math.max(previous - 1, 1))} disabled={reportsPage <= 1}>
                    Trước
                  </button>
                  <span>Trang {reportsData?.page}/{reportsData?.totalPages} • {formatNumber(reportsData?.total)} bài bị báo cáo</span>
                  <button
                    type="button"
                    onClick={() => setReportsPage((previous) => Math.min(previous + 1, reportsData?.totalPages || 1))}
                    disabled={reportsPage >= (reportsData?.totalPages || 1)}
                  >
                    Sau
                  </button>
                </div>
              </>
            ) : (
              <EmptyState title="Không có báo cáo phù hợp" text="Danh sách hiện trống hoặc bộ lọc quá hẹp." />
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'violations' ? (
        <section className={`${styles.panel} ${responsiveStyles.panel}`}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionEyebrow}>Vi phạm</div>
              <h2 className={styles.sectionTitle}>Nội dung cần xử lý</h2>
            </div>
          </div>

          <div className={styles.metricGridCompact}>
            <MetricCard label="Tài khoản vi phạm" value={formatNumber(violationSummary.violatingAccounts)} help="Cảnh báo, khóa hoặc có lỗi" tone="danger" />
            <MetricCard label="Bài viết vi phạm" value={formatNumber(violationSummary.violatingPosts)} help="Đang ở trạng thái vi phạm" tone="danger" />
            <MetricCard label="Tài khoản hiển thị" value={formatNumber(visibleViolationAccounts.length)} help="Sau tìm kiếm nhanh" tone="warning" />
            <MetricCard label="Bài viết hiển thị" value={formatNumber(visibleViolationPosts.length)} help="Sau tìm kiếm nhanh" tone="warning" />
          </div>

          <div className={styles.dualPane}>
            <div className={styles.tableCard}>
              <div className={styles.surfaceHeader}>
                <div>
                  <div className={styles.cardTitle}>Tài khoản cần xử lý</div>
                  <div className={styles.cardSubtitle}>Đã khóa, cảnh báo hoặc có lỗi</div>
                </div>
              </div>
              {visibleViolationAccounts.length ? (
                <div className={styles.stackList}>
                  {visibleViolationAccounts.map((row) => (
                    <div key={row.id} className={styles.stackItem}>
                      <div className={styles.stackItemMain}>
                        <div className={styles.stackItemTitle}>@{row.username}</div>
                        <div className={styles.badgeGroup}>
                          <Badge tone={badgeToneForAccount(row.moderationStatus, row.accountLocked)}>
                            {formatAccountStatus(row.moderationStatus, row.accountLocked)}
                          </Badge>
                          {row.strikesCount ? <Badge tone="warning">{row.strikesCount} lỗi</Badge> : null}
                        </div>
                        <p>{row.accountLocked ? row.accountLockedReason || '--' : row.moderationReason || '--'}</p>
                      </div>
                      <div className={styles.stackItemMeta}>
                        <span>{row.email}</span>
                        <span>{formatNumber(row.loginCount)} lượt đăng nhập</span>
                        <a className={styles.inlineLink} href={`/profile/${encodeURIComponent(row.username)}`} target="_blank" rel="noreferrer">
                          Mở hồ sơ
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Không có tài khoản phù hợp" text="Từ khóa hiện tại không khớp với danh sách vi phạm." />
              )}
            </div>

            <div className={styles.tableCard}>
              <div className={styles.surfaceHeader}>
                <div>
                  <div className={styles.cardTitle}>Bài viết vi phạm</div>
                  <div className={styles.cardSubtitle}>Lý do kiểm duyệt và mức độ báo cáo</div>
                </div>
              </div>
              {visibleViolationPosts.length ? (
                <div className={styles.stackList}>
                  {visibleViolationPosts.map((row) => (
                    <div key={row.id} className={styles.stackItem}>
                      <div className={styles.stackItemMain}>
                        <div className={styles.stackItemTitle}>{row.title}</div>
                        <div className={styles.badgeGroup}>
                          <Badge tone={badgeToneForPost(row.moderationStatus)}>{formatPostStatus(row.moderationStatus)}</Badge>
                          <Badge tone="warning">{formatNumber(row.reportCount)} báo cáo</Badge>
                        </div>
                        <p>{row.moderationReason || '--'}</p>
                      </div>
                      <div className={styles.stackItemMeta}>
                        <span>@{row.authorUsername}</span>
                        <span>{formatNumber(row.engagementCount)} tương tác</span>
                        <button type="button" className={styles.inlineLinkButton} onClick={() => void openPostDetail(row.id, 'posts')}>
                          Xem chi tiết
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Không có bài viết phù hợp" text="Từ khóa hiện tại không khớp với danh sách vi phạm." />
              )}
            </div>
          </div>
        </section>
      ) : null}

      {selectedAccountRow && selectedAccountDraft ? (
        <div className={`${styles.modalOverlay} ${responsiveStyles.modalOverlay}`} onMouseDown={() => closeAccountDetail()}>
          <div className={`${styles.accountModalCard} ${responsiveStyles.accountModalCard}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Chi tiết tài khoản @{selectedAccountRow.username}</h3>
                <div className={styles.modalSubtitle}>
                  {selectedAccountRow.email} • {formatNumber(selectedAccountRow.loginCount)} lượt đăng nhập
                </div>
              </div>
              <button type="button" className={styles.closeModalBtn} onClick={() => closeAccountDetail()} disabled={selectedAccountSaving}>
                Đóng
              </button>
            </div>

            <div className={`${styles.modalContent} ${responsiveStyles.modalContent}`}>
              <div className={styles.modalMain}>
                <div className={styles.modalPostHeader}>
                  <div>
                    <strong>@{selectedAccountRow.username}</strong>
                    <div className={styles.muted}>Tạo lúc: {formatDate(selectedAccountRow.createdAt)}</div>
                  </div>
                  <div className={styles.badgeGroup}>
                    <Badge tone={selectedAccountRow.role === 'admin' ? 'info' : 'neutral'}>{formatRole(selectedAccountRow.role)}</Badge>
                    {selectedAccountDraft.verified ? <Badge tone="success">Đã xác minh</Badge> : null}
                    <Badge tone={badgeToneForAccount(selectedAccountDraft.moderationStatus, selectedAccountDraft.accountLocked)}>
                      {formatAccountStatus(selectedAccountDraft.moderationStatus, selectedAccountDraft.accountLocked)}
                    </Badge>
                    {selectedAccountChanged ? <Badge tone="warning">Chưa lưu</Badge> : null}
                  </div>
                </div>

                <div className={styles.accountInfoGrid}>
                  <div>
                    <span>Lần đăng nhập cuối</span>
                    <strong>{formatDate(selectedAccountRow.lastLoginAt)}</strong>
                  </div>
                  <div>
                    <span>Số lỗi</span>
                    <strong>{formatNumber(selectedAccountRow.strikesCount)}</strong>
                  </div>
                  <div>
                    <span>Giới hạn hiện tại</span>
                    <strong>{summarizeAccountRestrictions(selectedAccountDraft)}</strong>
                  </div>
                  <div>
                    <span>Cập nhật gần nhất</span>
                    <strong>{formatDate(selectedAccountRow.updatedAt)}</strong>
                  </div>
                </div>

                <div className={styles.surfaceBlock}>
                  <div className={styles.cardTitle}>Ghi chú trạng thái</div>
                  <div className={styles.cardSubtitle}>
                    {selectedAccountDraft.accountLocked
                      ? selectedAccountDraft.lockReason || selectedAccountRow.accountLockedReason || 'Tài khoản đang bị khóa nhưng chưa có lý do.'
                      : selectedAccountDraft.moderationReason || selectedAccountRow.moderationReason || 'Chưa có ghi chú kiểm duyệt.'}
                  </div>
                  <a className={styles.inlineLink} href={`/profile/${encodeURIComponent(selectedAccountRow.username)}`} target="_blank" rel="noreferrer">
                    Mở hồ sơ người dùng
                  </a>
                </div>
              </div>

              <div className={styles.modalSide}>
                <div className={styles.surfaceBlock}>
                  <div className={styles.cardTitle}>Kiểm duyệt</div>
                  <div className={styles.controlGroup}>
                    <select
                      className={styles.fullInput}
                      value={selectedAccountDraft.moderationStatus}
                      disabled={selectedAccountSaving}
                      onChange={(event) =>
                        updateAccountDraft(selectedAccountRow.id, {
                          moderationStatus: event.target.value as AccountModerationStatus,
                        })
                      }
                    >
                      {ACCOUNT_MODERATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className={styles.textArea}
                      rows={4}
                      value={selectedAccountDraft.moderationReason}
                      disabled={selectedAccountSaving}
                      onChange={(event) => updateAccountDraft(selectedAccountRow.id, { moderationReason: event.target.value })}
                      placeholder="Lý do kiểm duyệt hoặc ghi chú nội bộ"
                    />
                  </div>
                </div>

                <div className={styles.surfaceBlock}>
                  <div className={styles.cardTitle}>Giới hạn</div>
                  <div className={styles.accountControlGrid}>
                    <Toggle checked={selectedAccountDraft.verified} label="Xác minh" disabled={selectedAccountSaving} onChange={(next) => updateAccountDraft(selectedAccountRow.id, { verified: next })} />
                    <Toggle checked={selectedAccountDraft.commentBlocked} label="Chặn bình luận" disabled={selectedAccountSaving} onChange={(next) => updateAccountDraft(selectedAccountRow.id, { commentBlocked: next })} />
                    <Toggle checked={selectedAccountDraft.messagingBlocked} label="Chặn nhắn tin" disabled={selectedAccountSaving} onChange={(next) => updateAccountDraft(selectedAccountRow.id, { messagingBlocked: next })} />
                    <Toggle checked={selectedAccountDraft.likeBlocked} label="Chặn thích" disabled={selectedAccountSaving} onChange={(next) => updateAccountDraft(selectedAccountRow.id, { likeBlocked: next })} />
                  </div>
                  <label className={styles.inlineFieldCompact}>
                    <span>Giới hạn bài/ngày</span>
                    <input
                      className={styles.fullInput}
                      type="number"
                      min={0}
                      value={selectedAccountDraft.dailyPostLimit}
                      disabled={selectedAccountSaving}
                      onChange={(event) =>
                        updateAccountDraft(selectedAccountRow.id, {
                          dailyPostLimit: Math.max(Number(event.target.value) || 0, 0),
                        })
                      }
                    />
                  </label>
                </div>

                <div className={styles.surfaceBlock}>
                  <div className={styles.cardTitle}>Khóa tài khoản</div>
                  <Toggle
                    checked={selectedAccountDraft.accountLocked}
                    label={selectedAccountDraft.accountLocked ? 'Đang khóa' : 'Đang mở'}
                    disabled={selectedAccountSaving}
                    onChange={(next) => updateAccountDraft(selectedAccountRow.id, { accountLocked: next })}
                  />
                  <textarea
                    className={styles.textArea}
                    rows={4}
                    value={selectedAccountDraft.lockReason}
                    disabled={selectedAccountSaving}
                    onChange={(event) => updateAccountDraft(selectedAccountRow.id, { lockReason: event.target.value })}
                    placeholder="Lý do khóa tài khoản"
                  />
                </div>

                <div className={styles.accountModalActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => resetAccountRow(selectedAccountRow)}
                    disabled={selectedAccountSaving || !selectedAccountChanged}
                  >
                    Đặt lại
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void saveAccountRow(selectedAccountRow)}
                    disabled={selectedAccountSaving || !selectedAccountChanged}
                  >
                    {selectedAccountSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {postDetailOpen ? (
        <div className={`${styles.modalOverlay} ${responsiveStyles.modalOverlay}`} onMouseDown={closePostDetail}>
          <div className={`${styles.modalCard} ${responsiveStyles.modalCard}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Chi tiết bài viết</h3>
                <div className={styles.modalSubtitle}>
                  Nguồn: {postDetailSource === 'reports' ? 'Báo cáo' : 'Danh sách bài viết'}
                </div>
              </div>
              <button type="button" className={styles.closeModalBtn} onClick={closePostDetail} disabled={postDetailSaving}>
                Đóng
              </button>
            </div>

            {postDetailLoading ? <div className={styles.loading}>Đang tải chi tiết...</div> : null}

            {!postDetailLoading && postDetailData?.post ? (
              <div className={`${styles.modalContent} ${responsiveStyles.modalContent}`}>
                <div className={`${styles.modalMain} ${responsiveStyles.modalMain}`}>
                  <div className={styles.modalPostHeader}>
                    <div>
                      <strong>@{postDetailData.post.authorUsername}</strong>
                      <div className={styles.muted}>{formatDate(postDetailData.post.createdAt)}</div>
                    </div>
                    <div className={styles.badgeGroup}>
                      <Badge tone={badgeToneForPost(postDetailData.post.moderationStatus)}>{formatPostStatus(postDetailData.post.moderationStatus)}</Badge>
                      <Badge tone={postDetailData.post.allowComments ? 'success' : 'warning'}>
                        {postDetailData.post.allowComments ? 'Đang mở bình luận' : 'Đã khóa bình luận'}
                      </Badge>
                    </div>
                  </div>

                  {(() => {
                    const previewUrl = resolveMediaUrl(
                      postDetailData.post.thumbnailUrl || postDetailData.post.media?.[0]?.url || postDetailData.post.imageUrl || '',
                    )
                    if (!previewUrl) return <div className={styles.snapshotFallback}>Không có media xem trước</div>
                    if (isVideoPreview(postDetailData.post.mediaType, previewUrl)) {
                      return <video className={styles.modalPreview} src={previewUrl} controls playsInline preload="metadata" />
                    }
                    return <img className={styles.modalPreview} src={previewUrl} alt={postDetailData.post.title || 'post'} />
                  })()}

                  {postDetailData.post.content ? <div className={styles.modalCaption}>{postDetailData.post.content}</div> : null}

                  <div className={styles.modalStats}>
                    <span>Thích: {formatNumber(postDetailData.post.likesCount)}</span>
                    <span>Bình luận: {formatNumber(postDetailData.post.commentsCount)}</span>
                    <span>Báo cáo: {formatNumber(postDetailData.post.reportCount)}</span>
                    <span>Ngày tạo: {formatDate(postDetailData.post.createdAt)}</span>
                  </div>
                </div>

                <div className={styles.modalSide}>
                  <div className={styles.modalInfoGrid}>
                    <div><b>ID:</b> {postDetailData.post.id}</div>
                    <div><b>Tác giả:</b> @{postDetailData.post.authorUsername}</div>
                    <div><b>Nguồn báo cáo:</b> {formatReportSource(postDetailData.post.reportSource)}</div>
                    <div><b>Báo cáo gần nhất:</b> {formatDate(postDetailData.post.lastReportedAt)}</div>
                    <div><b>Bài viết còn tồn tại:</b> {postDetailData.post.postExists === false ? 'Không' : 'Có'}</div>
                  </div>

                  <div className={styles.surfaceBlock}>
                    <div className={styles.cardTitle}>Kiểm duyệt</div>
                    <div className={styles.controlGroup}>
                      <select
                        className={styles.fullInput}
                        value={postModerationDraft.status}
                        onChange={(event) =>
                          setPostModerationDraft((previous) => ({
                            ...previous,
                            status: event.target.value as PostModerationStatus,
                          }))
                        }
                      >
                        {POST_MODERATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        className={styles.textArea}
                        rows={4}
                        value={postModerationDraft.reason}
                        onChange={(event) =>
                          setPostModerationDraft((previous) => ({
                            ...previous,
                            reason: event.target.value,
                          }))
                        }
                        placeholder="Lý do kiểm duyệt hoặc ghi chú gửi người dùng"
                      />
                      <button type="button" className={styles.primaryButton} onClick={() => void savePostModeration()} disabled={postDetailSaving}>
                        {postDetailSaving ? 'Đang lưu...' : 'Lưu kiểm duyệt'}
                      </button>
                    </div>
                  </div>

                  <div className={styles.surfaceBlock}>
                    <div className={styles.cardTitle}>Thao tác nhanh</div>
                    <div className={styles.inlineActions}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void runPostActionFromDetail(postDetailData.post.allowComments ? 'lock_comments' : 'unlock_comments')}
                        disabled={postDetailSaving}
                      >
                        {postDetailData.post.allowComments ? 'Khóa bình luận' : 'Mở bình luận'}
                      </button>
                      {postDetailData.reports.length ? (
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={() => openReportDecisionModal([postDetailData.post.id], postDetailData.post.title || postDetailData.post.id, ['no_violation'], 'detail')}
                          disabled={postDetailSaving}
                        >
                          Xử lý báo cáo
                        </button>
                      ) : null}
                      <button type="button" className={styles.dangerButton} onClick={() => void runPostActionFromDetail('delete_post')} disabled={postDetailSaving}>
                        Xóa bài viết
                      </button>
                    </div>
                    <a className={styles.inlineLink} href={postDetailData.post.postPath || `/post/${postDetailData.post.id}`} target="_blank" rel="noreferrer">
                      Mở bài viết trên giao diện người dùng
                    </a>
                  </div>

                  <div className={styles.reportList}>
                    <div className={styles.reportListTitle}>Lịch sử báo cáo</div>
                    {postDetailData.reports.length ? (
                      postDetailData.reports.map((item) => (
                        <div key={item.id} className={styles.reportItem}>
                          <div className={styles.badgeGroup}>
                            <Badge tone={badgeToneForReport(item.status)}>{formatReportStatus(item.status)}</Badge>
                            <Badge tone={item.source === 'auto_nsfw' ? 'info' : 'neutral'}>
                              {formatReportSource(item.source)}
                            </Badge>
                          </div>
                          <div><b>@{item.reporterUsername || 'không rõ'}</b></div>
                          {item.reason ? <div>{item.reason}</div> : null}
                          {item.detectionSignals?.length ? <div className={styles.muted}>Tín hiệu: {item.detectionSignals.join(', ')}</div> : null}
                          <div className={styles.muted}>{formatDate(item.createdAt)}</div>
                        </div>
                      ))
                    ) : (
                      <div className={styles.reportItem}>Bài viết này chưa có lịch sử báo cáo.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {reportDecisionTarget ? (
        <div className={`${styles.modalOverlay} ${responsiveStyles.modalOverlay}`} onMouseDown={() => !reportDecisionSaving && setReportDecisionTarget(null)}>
          <div className={`${styles.penaltyModalCard} ${responsiveStyles.penaltyModalCard}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Xử lý báo cáo</h3>
                <div className={styles.modalSubtitle}>Mục tiêu: {reportDecisionTarget.label}</div>
              </div>
              <button type="button" className={styles.closeModalBtn} onClick={() => setReportDecisionTarget(null)} disabled={reportDecisionSaving}>
                Đóng
              </button>
            </div>

            <div className={styles.penaltyBody}>
              <div className={styles.reportActionChecks}>
                {REPORT_DECISION_OPTIONS.map((option) => (
                  <label key={option.value} className={styles.reportActionOption}>
                    <input
                      type="checkbox"
                      checked={reportDecisionActions.includes(option.value)}
                      onChange={() => setReportDecisionActions((previous) => resolveReportActionToggle(previous, option.value))}
                      disabled={reportDecisionSaving}
                    />
                    <div>
                      <div>{option.label}</div>
                      <div className={styles.muted}>{option.help}</div>
                    </div>
                  </label>
                ))}
              </div>

              <textarea
                className={styles.penaltyReasonInput}
                value={reportDecisionReason}
                onChange={(event) => setReportDecisionReason(event.target.value)}
                placeholder="Lý do xử lý hoặc ghi chú kiểm duyệt"
                rows={4}
                disabled={reportDecisionSaving}
              />

              <div className={styles.inlineActions}>
                <Badge tone="info">Đang chọn: {sanitizeReportActions(reportDecisionActions).map(formatReportDecision).join(', ')}</Badge>
                <button type="button" className={styles.secondaryButton} onClick={() => setReportDecisionTarget(null)} disabled={reportDecisionSaving}>
                  Hủy
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void saveReportDecision()}
                  disabled={reportDecisionSaving || !sanitizeReportActions(reportDecisionActions).length}
                >
                  {reportDecisionSaving ? 'Đang lưu...' : 'Lưu quyết định'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

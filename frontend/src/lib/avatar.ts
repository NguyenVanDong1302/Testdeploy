import { resolveMediaUrl } from './api'

export type AvatarLike = {
  username?: string | null
  fullName?: string | null
  authorUsername?: string | null
  user?: string | null
  avatar?: string | null
  avatarUrl?: string | null
  authorAvatarUrl?: string | null
  photoURL?: string | null
  image?: string | null
  profileImage?: string | null
  profilePicture?: string | null
}

function initialsOf(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return 'U'
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function fallbackAvatarDataUri(seed?: string | null, label?: string | null) {
  const source = String(seed || label || 'user')
  let hash = 0
  for (let i = 0; i < source.length; i += 1) hash = source.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  const bg = `hsl(${hue} 48% 46%)`
  const fg = '#ffffff'
  const initials = initialsOf(label || source)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="64" fill="${bg}" />
      <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
        font-family="Inter, Arial, sans-serif" font-size="44" font-weight="700" fill="${fg}">${initials}</text>
    </svg>
  `.trim()
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

export function getAvatarUrl(input?: AvatarLike | string | null) {
  if (!input) return fallbackAvatarDataUri('user', 'User')

  if (typeof input === 'string') {
    const direct = resolveMediaUrl(input)
    if (direct) return direct
    return fallbackAvatarDataUri(input, input)
  }

  const direct = input.avatarUrl || input.authorAvatarUrl || input.avatar || input.photoURL || input.image || input.profileImage || input.profilePicture
  if (direct) return resolveMediaUrl(direct)

  const label = input.fullName || input.authorUsername || input.username || input.user || 'User'
  const seed = String(input.username || input.authorUsername || input.user || label)
  return fallbackAvatarDataUri(seed, label)
}

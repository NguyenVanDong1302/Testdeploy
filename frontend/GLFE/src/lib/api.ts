import { useCallback, useMemo } from 'react'
import { useAppStore } from '../state/store'

export const API_BASE_URL = trimTrailingSlash((import.meta.env.VITE_API_BASE_URL || '/api').trim() || '/api')
const DEFAULT_BACKEND_PORT = (import.meta.env.VITE_BACKEND_PORT || '4000').trim() || '4000'

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, '')
}

export function buildApiUrl(path: string) {
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${normalizedPath}`
}

function currentOrigin() {
  if (typeof window === 'undefined') return ''
  return trimTrailingSlash(window.location.origin)
}

function isLoopbackHost(hostname: string) {
  const normalized = String(hostname || '').trim().toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '0.0.0.0'
    || normalized === '::1'
    || normalized === '[::1]'
}

export const MEDIA_BASE_URL = trimTrailingSlash(
  String(import.meta.env.VITE_MEDIA_BASE_URL || currentOrigin() || `http://localhost:${DEFAULT_BACKEND_PORT}`),
)

export type ApiError = Error & { status?: number; data?: any }

export function resolveMediaUrl(url?: string | null) {
  if (!url) return ''
  const raw = String(url).trim().replace(/\\/g, '/')
  if (!raw) return ''
  if (/^(data:|blob:)/i.test(raw)) return raw

  if (/^(https?:)?\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw, currentOrigin() || `http://localhost:${DEFAULT_BACKEND_PORT}`)
      const fullPath = `${parsed.pathname}${parsed.search}${parsed.hash}`
      if (fullPath.toLowerCase().includes('/uploads/') && isLoopbackHost(parsed.hostname)) {
        return `${MEDIA_BASE_URL}${fullPath.startsWith('/') ? fullPath : `/${fullPath}`}`
      }
      return parsed.toString()
    } catch {
      return raw
    }
  }

  const uploadsIndex = raw.toLowerCase().indexOf('/uploads/')
  if (uploadsIndex >= 0) return `${MEDIA_BASE_URL}${raw.slice(uploadsIndex)}`
  if (raw.toLowerCase().startsWith('uploads/')) return `${MEDIA_BASE_URL}/${raw}`
  return `${MEDIA_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`
}

export function useApi() {
  const { state } = useAppStore()

  const buildHeaders = useCallback(
    (isFormData = false) => {
      const h: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' }
      if (state.username) h['X-Username'] = state.username
      if (state.token) h['Authorization'] = `Bearer ${state.token}`
      return h
    },
    [state.username, state.token],
  )

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
      const res = await fetch(buildApiUrl(path), {
        ...init,
        headers: {
          ...buildHeaders(isFormData),
          ...(init?.headers || {}),
        },
      })

      const text = await res.text()
      let data: any = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = { raw: text }
      }

      if (!res.ok) {
        const err: ApiError = new Error(data?.message || `HTTP ${res.status}`)
        err.status = res.status
        err.data = data
        throw err
      }

      return data
    },
    [buildHeaders],
  )

  return useMemo(
    () => ({
      get: (p: string) => request(p),
      post: (p: string, body?: any) => request(p, { method: 'POST', body: JSON.stringify(body || {}) }),
      del: (p: string, body?: any) => request(p, {
        method: 'DELETE',
        ...(body === undefined ? {} : { body: JSON.stringify(body || {}) }),
      }),
      put: (p: string, body?: any) => request(p, { method: 'PUT', body: JSON.stringify(body || {}) }),
      patch: (p: string, body?: any) => request(p, { method: 'PATCH', body: JSON.stringify(body || {}) }),
      postForm: (p: string, body: FormData) => request(p, { method: 'POST', body }),
      patchForm: (p: string, body: FormData) => request(p, { method: 'PATCH', body }),
    }),
    [request],
  )
}

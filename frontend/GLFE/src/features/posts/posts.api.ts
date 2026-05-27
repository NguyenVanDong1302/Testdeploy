import type { CreatePostPayload, CreatePostResponse } from './posts.types'
import type { ApiError } from '../../lib/api'
import { buildApiUrl, useApi } from '../../lib/api'

export async function createPostApi(args: {
  payload: CreatePostPayload
  token?: string
  username?: string
}): Promise<CreatePostResponse> {
  const { payload, token, username } = args
  const form = new FormData()

  if (payload.content) form.append('content', payload.content)
  form.append('visibility', payload.visibility || 'public')
  form.append('isAnonymous', String(!!payload.isAnonymous))
  form.append('allowComments', String(payload.allowComments !== false))
  form.append('hideLikeCount', String(!!payload.hideLikeCount))
  if (payload.location) form.append('location', payload.location)
  if (payload.altText) form.append('altText', payload.altText)
  if (payload.collaborators?.length) form.append('collaborators', payload.collaborators.join(','))
  if (payload.tags?.length) form.append('tags', payload.tags.join(','))
  for (const file of payload.files || []) form.append('media', file)

  const headers: Record<string, string> = {}
  if (username) headers['X-Username'] = username
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(buildApiUrl('/posts'), {
    method: 'POST',
    headers,
    body: form,
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
}

export function usePostsApi() {
  const api = useApi()

  return {
    updatePost: async (
      postId: string,
      payload: {
        content?: string
        visibility?: 'public' | 'friends' | 'private'
        allowComments?: boolean
        hideLikeCount?: boolean
        location?: string
      },
    ) => {
      const response = await api.patch(`/posts/${postId}`, payload || {})
      return response?.data || response
    },
    deletePost: async (postId: string) => {
      const response = await api.del(`/posts/${postId}`)
      return response?.data || response
    },
  }
}

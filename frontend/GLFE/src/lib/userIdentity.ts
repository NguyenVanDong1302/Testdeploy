export async function usernameToUserId(username: string): Promise<string> {
  const raw = String(username || '').trim()
  if (!raw) return ''

  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const data = new TextEncoder().encode(raw)
    const digest = await window.crypto.subtle.digest('SHA-256', data)
    const bytes = Array.from(new Uint8Array(digest))
    return bytes
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16)
  }

  let hash = 0
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(16, '0').slice(0, 16)
}

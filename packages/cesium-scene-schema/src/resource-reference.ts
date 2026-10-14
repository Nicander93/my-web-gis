/** Portable resource identity; native grant URLs belong only to the prepared runtime document. */
export type ResourceReference =
  | { kind: 'relative'; path: string }
  | { kind: 'absolute'; path: string }
  | { kind: 'url'; url: string; credentialRef?: string }

export function isRuntimeResourceUrl(value: string): boolean {
  try { return new URL(value).hostname === 'webgis-resource.localhost' || new URL(value).protocol === 'webgis-resource:' }
  catch { return false }
}

export function validateResourceReference(value: unknown): value is ResourceReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const reference = value as Record<string, unknown>
  if (reference.kind === 'url') {
    if (typeof reference.url !== 'string' || !/^https?:\/\//i.test(reference.url) || /[\u0000-\u0020]/.test(reference.url) || isRuntimeResourceUrl(reference.url)) return false
    try {
      const url = new URL(reference.url)
      if (url.username || url.password) return false
      let secret = false
      url.searchParams.forEach((_value, key) => { if (/^(token|access_token|key|api_key|apikey|authorization)$/i.test(key)) secret = true })
      if (secret) return false
    } catch { return false }
    return (reference.credentialRef === undefined || typeof reference.credentialRef === 'string' && !!reference.credentialRef.trim()) &&
      Object.keys(reference).every((key) => ['kind', 'url', 'credentialRef'].includes(key))
  }
  if (!['relative', 'absolute'].includes(String(reference.kind)) || typeof reference.path !== 'string' ||
    !reference.path || /[\u0000-\u001f]/.test(reference.path) || Object.keys(reference).some((key) => !['kind', 'path'].includes(key))) return false
  const path = reference.path.replace(/\\/g, '/')
  const absolute = /^[a-z]:\//i.test(path) || /^\/\/[^/]+\/[^/]+(?:\/|$)/.test(path)
  if (reference.kind === 'absolute') return absolute && !path.slice(/^[a-z]:/i.test(path) ? 2 : 0).includes(':')
  return !absolute && !path.startsWith('/') && !path.includes(':')
}

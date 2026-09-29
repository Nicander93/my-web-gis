/**
 * Session / device credential vault for service auth.
 * NEVER write token values into Project, Scene, fixtures, or logs.
 * Persists only CredentialRef.key on Dataset; values live here (memory)
 * or in platform secure store when available.
 */

export type CredentialKind = 'query-token' | 'bearer'

export interface StoredCredential {
  key: string
  kind: CredentialKind
  /** Query param name when kind is query-token. */
  param?: string
  /** Secret value — memory only. */
  value: string
}

const memory = new Map<string, StoredCredential>()
let seq = 0

function nextKey(prefix = 'svc'): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

/** Store a credential in session memory; returns a reference key for Dataset.credentialRef. */
export function putSessionCredential(input: {
  kind: CredentialKind
  value: string
  param?: string
  key?: string
}): string {
  const key = input.key ?? nextKey()
  memory.set(key, {
    key,
    kind: input.kind,
    param: input.param,
    value: input.value
  })
  return key
}

export function getSessionCredential(key: string): StoredCredential | undefined {
  return memory.get(key)
}

export function deleteSessionCredential(key: string): void {
  memory.delete(key)
}

export function clearSessionCredentials(): void {
  memory.clear()
}

/**
 * Best-effort platform secure persist. Browser cannot safely persist; returns false.
 * Tauri: reserved for future OS keychain integration — currently session-only.
 */
export async function persistCredentialSecurely(_key: string): Promise<boolean> {
  // Desktop secure store hook (future). Do not fall back to localStorage for tokens.
  return false
}

export function canPersistCredentialsSafely(): boolean {
  // Until OS keychain is wired, require session input each run for secrets.
  return false
}

/** Test helper */
export function _resetCredentialsForTests(): void {
  memory.clear()
  seq = 0
}
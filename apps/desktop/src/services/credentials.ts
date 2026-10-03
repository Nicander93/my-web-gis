/**
 * Session / device credential vault for service auth.
 * NEVER write token values into Project, Scene, fixtures, or logs.
 * Persists only CredentialRef.key on Dataset; values live here (memory)
 * or in platform secure store when available (Tauri → OS keychain).
 */

export type CredentialKind = 'query-token' | 'bearer'

export interface StoredCredential {
  key: string
  kind: CredentialKind
  /** Query param name when kind is query-token. */
  param?: string
  /** Secret value — memory only (and OS keychain when persisted). */
  value: string
}

/** Injectable secure-store backend (Tauri invoke or vitest mock). */
export interface SecureCredentialBackend {
  isAvailable(): boolean
  set(key: string, payload: string): Promise<void>
  get(key: string): Promise<string | null>
  delete(key: string): Promise<void>
}

interface PersistedCredentialPayload {
  kind: CredentialKind
  param?: string
  value: string
}

const memory = new Map<string, StoredCredential>()
let seq = 0

/** Test / override backend. `undefined` = auto-detect Tauri; `null` = force unavailable. */
let injectedBackend: SecureCredentialBackend | null | undefined = undefined
let tauriBackendPromise: Promise<SecureCredentialBackend | null> | null = null

function nextKey(prefix = 'svc'): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

async function createTauriBackend(): Promise<SecureCredentialBackend | null> {
  if (!isTauriRuntime()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return {
      isAvailable: () => true,
      set: async (key, payload) => {
        await invoke('secure_credential_set', { key, payload })
      },
      get: async (key) => {
        const value = await invoke<string | null>('secure_credential_get', { key })
        return value ?? null
      },
      delete: async (key) => {
        await invoke('secure_credential_delete', { key })
      }
    }
  } catch {
    return null
  }
}

function resolveBackendSync(): SecureCredentialBackend | null {
  if (injectedBackend !== undefined) return injectedBackend
  // Sync path cannot load invoke; availability for canPersist uses isTauriRuntime.
  return null
}

async function resolveBackend(): Promise<SecureCredentialBackend | null> {
  if (injectedBackend !== undefined) return injectedBackend
  if (!tauriBackendPromise) {
    tauriBackendPromise = createTauriBackend()
  }
  return tauriBackendPromise
}

function serializePayload(cred: StoredCredential): string {
  const payload: PersistedCredentialPayload = {
    kind: cred.kind,
    value: cred.value
  }
  if (cred.param !== undefined) payload.param = cred.param
  return JSON.stringify(payload)
}

function parsePayload(key: string, raw: string): StoredCredential | undefined {
  try {
    const parsed = JSON.parse(raw) as PersistedCredentialPayload
    if (parsed.kind !== 'query-token' && parsed.kind !== 'bearer') return undefined
    if (typeof parsed.value !== 'string' || !parsed.value) return undefined
    if (parsed.param !== undefined && typeof parsed.param !== 'string') return undefined
    return {
      key,
      kind: parsed.kind,
      param: parsed.param,
      value: parsed.value
    }
  } catch {
    return undefined
  }
}

async function deleteSecureBestEffort(key: string): Promise<void> {
  try {
    const backend = await resolveBackend()
    if (!backend?.isAvailable()) return
    await backend.delete(key)
  } catch {
    // best-effort
  }
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

/**
 * Ensure credential is in session memory, loading from OS secure store on miss.
 * Existing sync callers of getSessionCredential still work after hydrate.
 */
export async function ensureCredentialLoaded(
  key: string
): Promise<StoredCredential | undefined> {
  const existing = memory.get(key)
  if (existing) return existing
  return loadCredentialSecurely(key)
}

export function deleteSessionCredential(key: string): void {
  memory.delete(key)
  void deleteSecureBestEffort(key)
}

export function clearSessionCredentials(): void {
  const keys = [...memory.keys()]
  memory.clear()
  for (const key of keys) {
    void deleteSecureBestEffort(key)
  }
}

/**
 * Wipe in-memory vault only; OS secure store is untouched.
 * Models process death / app restart (memory gone, Credential Manager still holds payload).
 * Do not confuse with clearSessionCredentials, which also deletes OS entries.
 */
export function wipeSessionMemoryOnly(): void {
  memory.clear()
}

/**
 * Persist StoredCredential already in memory into the OS secure store.
 * Returns true on success. Never uses localStorage.
 */
export async function persistCredentialSecurely(key: string): Promise<boolean> {
  const cred = memory.get(key)
  if (!cred) return false
  const backend = await resolveBackend()
  if (!backend?.isAvailable()) return false
  try {
    await backend.set(key, serializePayload(cred))
    return true
  } catch {
    return false
  }
}

/**
 * Load credential from OS secure store into session memory.
 * Returns the hydrated credential, or undefined when missing / unavailable.
 */
export async function loadCredentialSecurely(
  key: string
): Promise<StoredCredential | undefined> {
  const existing = memory.get(key)
  if (existing) return existing
  const backend = await resolveBackend()
  if (!backend?.isAvailable()) return undefined
  try {
    const raw = await backend.get(key)
    if (!raw) return undefined
    const cred = parsePayload(key, raw)
    if (!cred) return undefined
    memory.set(key, cred)
    return cred
  } catch {
    return undefined
  }
}

/** True when running under Tauri (or a test backend that reports available). */
export function canPersistCredentialsSafely(): boolean {
  if (injectedBackend !== undefined) {
    return injectedBackend?.isAvailable() ?? false
  }
  return isTauriRuntime()
}

/**
 * Hydrate all credentialRef keys found on project datasets into session memory.
 * Best-effort; does not invent secrets when OS store has no entry.
 */
export async function hydrateCredentialsFromRefs(keys: Iterable<string>): Promise<void> {
  const unique = [...new Set([...keys].filter(Boolean))]
  await Promise.all(unique.map((key) => loadCredentialSecurely(key)))
}

/** Collect credentialRef.key values from a project-like datasets list. */
export function collectCredentialRefKeys(
  datasets: ReadonlyArray<{ kind?: string; source?: { type?: string; credentialRef?: { key?: string } } }>
): string[] {
  const keys: string[] = []
  for (const ds of datasets) {
    const key = ds.source?.credentialRef?.key
    if (key) keys.push(key)
  }
  return keys
}

/** Test helper: inject mock backend (`null` = force no persist). */
export function _setSecureCredentialBackendForTests(
  backend: SecureCredentialBackend | null | undefined
): void {
  injectedBackend = backend
  tauriBackendPromise = null
}

/** Test helper */
export function _resetCredentialsForTests(): void {
  memory.clear()
  seq = 0
  injectedBackend = undefined
  tauriBackendPromise = null
}

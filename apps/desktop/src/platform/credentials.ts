/**
 * 用于服务认证的会话和设备级凭据库。
 * 永远不要把 token 的值写进项目、场景、测试夹具或日志。
 * Dataset 上只持久化 CredentialRef.key；具体的值存在这里的内存里。
 * or in platform secure store when available (Tauri → OS keychain).
 */

export type CredentialKind = 'query-token' | 'bearer' | 'http-authorization'

export interface StoredCredential {
  key: string
  kind: CredentialKind
  /** kind 为 query-token 时使用的查询参数名。 */
  param?: string
  /** Secret value — memory only (and OS keychain when persisted). */
  value: string
}

/** 可注入的安全存储后端（Tauri invoke 或测试里的 mock）。 */
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

/** 测试或覆盖用的后端。`undefined` 表示自动探测 Tauri，`null` 表示强制不可用。 */
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
  // 同步路径无法加载 invoke；canPersist 是否可用改由 isTauriRuntime 判断。
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
    if (parsed.kind !== 'query-token' && parsed.kind !== 'bearer' && parsed.kind !== 'http-authorization') return undefined
    if (typeof parsed.value !== 'string' || !parsed.value) return undefined
    if (parsed.kind === 'http-authorization' && !/^(Basic|Bearer) [^\r\n]+$/.test(parsed.value)) return undefined
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
    // 尽力而为
  }
}

/** 把凭据存进会话内存，返回一个键供 Dataset.credentialRef 使用。 */
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

/** 已有的 bearer 记录里存的是 token；显式 HTTP 记录里存的是完整的请求头。 */
export function credentialAuthorization(credential: StoredCredential): string | undefined {
  if (credential.kind === 'bearer') return `Bearer ${credential.value}`
  if (credential.kind === 'http-authorization' && /^(Basic|Bearer) [^\r\n]+$/.test(credential.value)) return credential.value
  return undefined
}

/**
 * 确保凭据已经在会话内存里，缺的时候从操作系统的安全存储加载。
 * 补全之后，原有同步调用 getSessionCredential 的代码仍然可用。
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
 * 只清空内存里的凭据库，操作系统的安全存储不受影响。
 * 模拟进程结束或应用重启：内存没了，凭据管理器中仍有数据。
 * 不要和 clearSessionCredentials 混淆，后者会连操作系统里的条目一起删除。
 */
export function wipeSessionMemoryOnly(): void {
  memory.clear()
}

/**
 * 把已经在内存里的 StoredCredential 持久化到操作系统的安全存储。
 * 成功时返回 true。从不使用 localStorage。
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
 * 从操作系统的安全存储把凭据加载进会话内存。
 * 返回补全后的凭据；缺失或不可用时返回 undefined。
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

/** 在 Tauri 下运行（或测试后端报告可用）时为 true。 */
export function canPersistCredentialsSafely(): boolean {
  if (injectedBackend !== undefined) {
    return injectedBackend?.isAvailable() ?? false
  }
  return isTauriRuntime()
}

/**
 * 把项目数据集上出现的所有 credentialRef 键都加载进会话内存。
 * 尽力而为；操作系统存储里没有条目时，不凭空编造密钥。
 */
export async function hydrateCredentialsFromRefs(keys: Iterable<string>): Promise<void> {
  const unique = [...new Set([...keys].filter(Boolean))]
  await Promise.all(unique.map((key) => loadCredentialSecurely(key)))
}

/** 从类似项目的数据集列表里收集 credentialRef.key 的值。 */
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

/** 测试辅助。: inject mock backend (`null` = force no persist). */
export function _setSecureCredentialBackendForTests(
  backend: SecureCredentialBackend | null | undefined
): void {
  injectedBackend = backend
  tauriBackendPromise = null
}

/** 测试辅助。 */
export function _resetCredentialsForTests(): void {
  memory.clear()
  seq = 0
  injectedBackend = undefined
  tauriBackendPromise = null
}

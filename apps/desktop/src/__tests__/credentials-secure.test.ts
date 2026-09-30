import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetCredentialsForTests,
  _setSecureCredentialBackendForTests,
  canPersistCredentialsSafely,
  clearSessionCredentials,
  collectCredentialRefKeys,
  deleteSessionCredential,
  ensureCredentialLoaded,
  getSessionCredential,
  hydrateCredentialsFromRefs,
  loadCredentialSecurely,
  persistCredentialSecurely,
  putSessionCredential,
  wipeSessionMemoryOnly,
  type SecureCredentialBackend
} from '@/services/credentials'

function memoryBackend(): SecureCredentialBackend & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    isAvailable: () => true,
    set: async (key, payload) => {
      store.set(key, payload)
    },
    get: async (key) => store.get(key) ?? null,
    delete: async (key) => {
      store.delete(key)
    }
  }
}

describe('secure credential persistence', () => {
  beforeEach(() => {
    _resetCredentialsForTests()
  })

  it('canPersistCredentialsSafely is false without Tauri or injected backend', () => {
    expect(canPersistCredentialsSafely()).toBe(false)
  })

  it('canPersistCredentialsSafely is true with available injected backend', () => {
    _setSecureCredentialBackendForTests(memoryBackend())
    expect(canPersistCredentialsSafely()).toBe(true)
  })

  it('canPersistCredentialsSafely is false when backend forced null', () => {
    _setSecureCredentialBackendForTests(null)
    expect(canPersistCredentialsSafely()).toBe(false)
  })

  it('persistCredentialSecurely writes metadata+secret and returns true', async () => {
    const backend = memoryBackend()
    _setSecureCredentialBackendForTests(backend)
    const key = putSessionCredential({
      kind: 'query-token',
      param: 'token',
      value: 'SECRET-VALUE'
    })
    await expect(persistCredentialSecurely(key)).resolves.toBe(true)
    const raw = backend.store.get(key)
    expect(raw).toBeTruthy()
    expect(raw).toContain('SECRET-VALUE')
    expect(raw).toContain('query-token')
    expect(JSON.parse(raw!).param).toBe('token')
  })

  it('persistCredentialSecurely returns false when nothing in memory or no backend', async () => {
    await expect(persistCredentialSecurely('missing')).resolves.toBe(false)
    const key = putSessionCredential({ kind: 'bearer', value: 'x' })
    _setSecureCredentialBackendForTests(null)
    await expect(persistCredentialSecurely(key)).resolves.toBe(false)
  })

  it('loadCredentialSecurely hydrates session memory after clear', async () => {
    const backend = memoryBackend()
    _setSecureCredentialBackendForTests(backend)
    const key = putSessionCredential({ kind: 'bearer', value: 'BEARER-SECRET' })
    await persistCredentialSecurely(key)

    // Simulate restart: clear memory but keep OS store
    const saved = backend.store.get(key)!
    _resetCredentialsForTests()
    _setSecureCredentialBackendForTests(memoryBackend())
    const restoredBackend = memoryBackend()
    restoredBackend.store.set(key, saved)
    _setSecureCredentialBackendForTests(restoredBackend)

    expect(getSessionCredential(key)).toBeUndefined()
    const loaded = await loadCredentialSecurely(key)
    expect(loaded?.value).toBe('BEARER-SECRET')
    expect(loaded?.kind).toBe('bearer')
    expect(getSessionCredential(key)?.value).toBe('BEARER-SECRET')
  })

  it('ensureCredentialLoaded returns memory hit without touching backend', async () => {
    const backend = memoryBackend()
    let gets = 0
    _setSecureCredentialBackendForTests({
      ...backend,
      get: async (key) => {
        gets += 1
        return backend.get(key)
      }
    })
    const key = putSessionCredential({ kind: 'bearer', value: 'hit' })
    await expect(ensureCredentialLoaded(key)).resolves.toMatchObject({ value: 'hit' })
    expect(gets).toBe(0)
  })

  it('deleteSessionCredential removes OS entry best-effort', async () => {
    const backend = memoryBackend()
    _setSecureCredentialBackendForTests(backend)
    const key = putSessionCredential({ kind: 'bearer', value: 'gone' })
    await persistCredentialSecurely(key)
    expect(backend.store.has(key)).toBe(true)
    deleteSessionCredential(key)
    // allow microtask for best-effort delete
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(getSessionCredential(key)).toBeUndefined()
    expect(backend.store.has(key)).toBe(false)
  })

  it('clearSessionCredentials clears memory and OS entries', async () => {
    const backend = memoryBackend()
    _setSecureCredentialBackendForTests(backend)
    const a = putSessionCredential({ kind: 'bearer', value: 'a' })
    const b = putSessionCredential({ kind: 'query-token', param: 't', value: 'b' })
    await persistCredentialSecurely(a)
    await persistCredentialSecurely(b)
    clearSessionCredentials()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(getSessionCredential(a)).toBeUndefined()
    expect(backend.store.size).toBe(0)
  })

  it('hydrateCredentialsFromRefs loads multiple keys', async () => {
    const backend = memoryBackend()
    _setSecureCredentialBackendForTests(backend)
    const k1 = putSessionCredential({ kind: 'bearer', value: 'one', key: 'ref-1' })
    const k2 = putSessionCredential({
      kind: 'query-token',
      param: 'token',
      value: 'two',
      key: 'ref-2'
    })
    await persistCredentialSecurely(k1)
    await persistCredentialSecurely(k2)
    const saved = new Map(backend.store)
    _resetCredentialsForTests()
    const restored = memoryBackend()
    for (const [k, v] of saved) restored.store.set(k, v)
    _setSecureCredentialBackendForTests(restored)

    await hydrateCredentialsFromRefs([k1, k2, k1])
    expect(getSessionCredential(k1)?.value).toBe('one')
    expect(getSessionCredential(k2)?.value).toBe('two')
  })

  it('collectCredentialRefKeys extracts keys from datasets', () => {
    expect(
      collectCredentialRefKeys([
        { kind: 'wms', source: { credentialRef: { key: 'a' } } },
        { kind: 'vector', source: {} },
        { kind: 'wfs', source: { credentialRef: { key: 'b' } } }
      ])
    ).toEqual(['a', 'b'])
  })


  it('wipeSessionMemoryOnly clears memory but keeps OS store (restart model)', async () => {
    const backend = memoryBackend()
    _setSecureCredentialBackendForTests(backend)
    const key = putSessionCredential({
      kind: 'query-token',
      param: 'token',
      value: 'RESTART-SECRET',
      key: 'ref-restart'
    })
    await persistCredentialSecurely(key)
    expect(backend.store.has(key)).toBe(true)

    wipeSessionMemoryOnly()
    expect(getSessionCredential(key)).toBeUndefined()
    expect(backend.store.has(key)).toBe(true)

    const loaded = await ensureCredentialLoaded(key)
    expect(loaded?.value).toBe('RESTART-SECRET')
    expect(loaded?.param).toBe('token')
    expect(getSessionCredential(key)?.value).toBe('RESTART-SECRET')
  })
  it('never suggests localStorage path — persist fails without secure backend', async () => {
    _setSecureCredentialBackendForTests(null)
    const key = putSessionCredential({ kind: 'bearer', value: 'no-localstorage' })
    await expect(persistCredentialSecurely(key)).resolves.toBe(false)
    expect(typeof localStorage === 'undefined' || !localStorage.getItem(key)).toBe(true)
  })
})

/**
 * 可选运行：针对真实操作系统凭据管理器，重新验证场景 I 的凭据。
 *
 * 开关：设置 DESKTOP_WEBGIS_LIVE_KEYCHAIN=1 才会运行。
 * 探测程序：DESKTOP_WEBGIS_KEYCHAIN_PROBE 指向 secure-credential-probe.exe 的路径。
 *   （由 run-live-keychain-reverify.mjs 在 cargo build 之后设置）
 *
 * 默认的 `pnpm --filter @desktop-webgis/desktop test` 会跳过这个文件里的实连用例。
 * 永远不记录 token 或密钥的值。
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _resetCredentialsForTests,
  _setSecureCredentialBackendForTests,
  collectCredentialRefKeys,
  ensureCredentialLoaded,
  getSessionCredential,
  hydrateCredentialsFromRefs,
  persistCredentialSecurely,
  putSessionCredential,
  wipeSessionMemoryOnly,
  type SecureCredentialBackend
} from '@/platform/credentials'

const LIVE = process.env.DESKTOP_WEBGIS_LIVE_KEYCHAIN === '1'
const PROBE = process.env.DESKTOP_WEBGIS_KEYCHAIN_PROBE?.trim() || ''

function requireProbe(): string {
  if (!PROBE) {
    throw new Error('DESKTOP_WEBGIS_KEYCHAIN_PROBE is required for live keychain tests')
  }
  return PROBE
}

function probeBackend(): SecureCredentialBackend {
  const probe = requireProbe()
  return {
    isAvailable: () => true,
    set: async (key, payload) => {
      const r = spawnSync(probe, ['set', key, payload], { encoding: 'utf8' })
      if (r.status !== 0) {
        throw new Error(`probe set failed (status=${r.status}): ${r.stderr || r.stdout || 'no output'}`)
      }
    },
    get: async (key) => {
      const r = spawnSync(probe, ['get', key], { encoding: 'utf8' })
      if (r.status === 2) return null
      if (r.status !== 0) {
        throw new Error(`probe get failed (status=${r.status}): ${r.stderr || 'no output'}`)
      }
      return r.stdout ?? null
    },
    delete: async (key) => {
      const r = spawnSync(probe, ['delete', key], { encoding: 'utf8' })
      if (r.status !== 0) {
        throw new Error(`probe delete failed (status=${r.status}): ${r.stderr || 'no output'}`)
      }
    }
  }
}

function uniqueKey(suffix: string): string {
  return `scene-i-reverify-${process.pid}-${Date.now().toString(36)}-${suffix}`
}

async function listenMockAuthServer(expectedBearer: string): Promise<{
  server: Server
  baseUrl: string
  seenAuth: { value: string | undefined }
}> {
  const seenAuth: { value: string | undefined } = { value: undefined }
  const server = createServer((req: IncomingMessage, res) => {
    seenAuth.value = req.headers.authorization
    if (req.headers.authorization === `Bearer ${expectedBearer}`) {
      res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' })
      res.end(
        '<?xml version="1.0"?><WMS_Capabilities version="1.3.0"><Capability><Layer><Title>ok</Title></Layer></Capability></WMS_Capabilities>'
      )
      return
    }
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('unauthorized')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('failed to bind mock server')
  return { server, baseUrl: `http://127.0.0.1:${addr.port}`, seenAuth }
}

describe.skipIf(!LIVE)('scene I live keychain re-verify (OS Credential Manager)', () => {
  const keysToCleanup: string[] = []

  beforeEach(() => {
    _resetCredentialsForTests()
    _setSecureCredentialBackendForTests(probeBackend())
  })

  afterEach(async () => {
    const backend = probeBackend()
    for (const key of keysToCleanup.splice(0)) {
      try {
        await backend.delete(key)
      } catch {
        // 尽力而为 cleanup
      }
    }
    _resetCredentialsForTests()
  })

  it('A: OS CM round-trip via probe (store → get → delete)', async () => {
    const key = uniqueKey('cm')
    keysToCleanup.push(key)
    const secret = 'LIVE-CM-SECRET-VALUE'
    const payload = JSON.stringify({ kind: 'bearer', value: secret })

    const backend = probeBackend()
    await backend.set(key, payload)
    const raw = await backend.get(key)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { kind: string; value: string }
    expect(parsed.kind).toBe('bearer')
    expect(parsed.value).toBe(secret)
    // 不要记录密钥。
    expect(parsed.value.length).toBe(secret.length)

    await backend.delete(key)
    expect(await backend.get(key)).toBeNull()
    keysToCleanup.pop()
  })

  it('B: restart simulate — wipeSessionMemoryOnly then hydrate/ensureCredentialLoaded', async () => {
    const key = uniqueKey('restart')
    keysToCleanup.push(key)
    const secret = 'RESTART-HYDRATE-SECRET'

    putSessionCredential({
      kind: 'query-token',
      param: 'token',
      value: secret,
      key
    })
    await expect(persistCredentialSecurely(key)).resolves.toBe(true)

    // 应用重启：进程内存已经没了，操作系统的凭据存储不受影响。
    wipeSessionMemoryOnly()
    expect(getSessionCredential(key)).toBeUndefined()

    const refs = collectCredentialRefKeys([
      { kind: 'wfs', source: { credentialRef: { key } } }
    ])
    expect(refs).toEqual([key])
    await hydrateCredentialsFromRefs(refs)

    const loaded = await ensureCredentialLoaded(key)
    expect(loaded?.kind).toBe('query-token')
    expect(loaded?.param).toBe('token')
    expect(loaded?.value).toBe(secret)
    expect(getSessionCredential(key)?.value).toBe(secret)
  })

  it('C: restore-network — after hydrate, auth builder usable without re-entry (mock HTTP)', async () => {
    const key = uniqueKey('reconnect')
    keysToCleanup.push(key)
    const secret = 'RECONNECT-BEARER-SECRET'

    putSessionCredential({ kind: 'bearer', value: secret, key })
    await expect(persistCredentialSecurely(key)).resolves.toBe(true)

    wipeSessionMemoryOnly()
    expect(getSessionCredential(key)).toBeUndefined()

    // 模拟打开项目时的凭据补全，以及之后重新连接的路径（wfs-load 的 buildAuth）。
    await hydrateCredentialsFromRefs([key])
    const cred =
      getSessionCredential(key) ?? (await ensureCredentialLoaded(key))
    expect(cred?.value).toBe(secret)

    const { server, baseUrl, seenAuth } = await listenMockAuthServer(secret)
    try {
      const res = await fetch(`${baseUrl}/wms?SERVICE=WMS&REQUEST=GetCapabilities`, {
        headers: { Authorization: `Bearer ${cred!.value}` }
      })
      expect(res.status).toBe(200)
      expect(seenAuth.value).toBe(`Bearer ${secret}`)
      // 检查请求体，但不回显密钥。
      const text = await res.text()
      expect(text).toContain('WMS_Capabilities')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
    }
  })
})

describe('scene I live keychain gate (always runs)', () => {
  it('skips live suite unless DESKTOP_WEBGIS_LIVE_KEYCHAIN=1', () => {
    if (!LIVE) {
      expect(LIVE).toBe(false)
    } else {
      expect(PROBE.length).toBeGreaterThan(0)
    }
  })
})
/**
 * Opt-in Scene I **true process restart** credential re-verify.
 *
 * Gate: DESKTOP_WEBGIS_LIVE_KEYCHAIN=1
 * Probe: DESKTOP_WEBGIS_KEYCHAIN_PROBE (set by run-ui-restart-reverify.mjs)
 *
 * What this proves:
 *   Writer OS process persists via the same keyring service as the Tauri desktop app
 *   (`desktop-webgis` / Windows Credential Manager), then **exits completely**.
 *   A **fresh** process (new PID, empty session vault — never calls wipeSessionMemoryOnly)
 *   hydrates via hydrateCredentialsFromRefs / ensureCredentialLoaded.
 *
 * What this does NOT prove:
 *   Full Tauri GUI window quit + relaunch, offline project open UI, live tokenized OGC.
 *
 * Phase mode (child vitest invocation):
 *   DESKTOP_WEBGIS_UI_RESTART_PHASE=hydrate — only the hydrate reader case runs.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  _resetCredentialsForTests,
  _setSecureCredentialBackendForTests,
  collectCredentialRefKeys,
  ensureCredentialLoaded,
  getSessionCredential,
  hydrateCredentialsFromRefs,
  type SecureCredentialBackend
} from '@/services/credentials'

const LIVE = process.env.DESKTOP_WEBGIS_LIVE_KEYCHAIN === '1'
const PROBE = process.env.DESKTOP_WEBGIS_KEYCHAIN_PROBE?.trim() || ''
const PHASE = process.env.DESKTOP_WEBGIS_UI_RESTART_PHASE?.trim() || ''
const HYDRATE_KEY = process.env.DESKTOP_WEBGIS_UI_RESTART_KEY?.trim() || ''
const HYDRATE_VALUE_LEN = Number(process.env.DESKTOP_WEBGIS_UI_RESTART_VALUE_LEN || '0')
const HYDRATE_KIND = process.env.DESKTOP_WEBGIS_UI_RESTART_KIND?.trim() || 'bearer'

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const writerChildPath = join(desktopRoot, 'scripts', 'ui-restart-writer-child.mjs')

function requireProbe(): string {
  if (!PROBE) {
    throw new Error('DESKTOP_WEBGIS_KEYCHAIN_PROBE is required for UI restart process tests')
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
  return `scene-i-ui-restart-${process.pid}-${Date.now().toString(36)}-${suffix}`
}

function processAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const isHydrateChild = PHASE === 'hydrate'

describe.skipIf(!LIVE || !isHydrateChild)(
  'scene I UI restart hydrate child (fresh process; no wipeSessionMemoryOnly)',
  () => {
    afterEach(() => {
      _resetCredentialsForTests()
    })

    it('hydrates from OS CM in this process which never held the secret in the vault', async () => {
      expect(HYDRATE_KEY.length).toBeGreaterThan(0)
      expect(HYDRATE_VALUE_LEN).toBeGreaterThan(0)

      _resetCredentialsForTests()
      _setSecureCredentialBackendForTests(probeBackend())

      // Fresh process vault must be empty before hydrate.
      expect(getSessionCredential(HYDRATE_KEY)).toBeUndefined()

      const refs = collectCredentialRefKeys([
        { kind: 'wfs', source: { credentialRef: { key: HYDRATE_KEY } } }
      ])
      await hydrateCredentialsFromRefs(refs)

      const loaded = await ensureCredentialLoaded(HYDRATE_KEY)
      expect(loaded?.kind).toBe(HYDRATE_KIND)
      expect(loaded?.value.length).toBe(HYDRATE_VALUE_LEN)
      expect(getSessionCredential(HYDRATE_KEY)?.value.length).toBe(HYDRATE_VALUE_LEN)

      // Machine-readable result for orchestrator (no secret value).
      const result = {
        ok: true,
        readerPid: process.pid,
        key: HYDRATE_KEY,
        kind: loaded?.kind,
        valueLen: loaded?.value.length,
        usedWipeSessionMemoryOnly: false
      }
      // eslint-disable-next-line no-console
      console.log(`UI_RESTART_HYDRATE_RESULT ${JSON.stringify(result)}`)
    })
  }
)

describe.skipIf(!LIVE || isHydrateChild)(
  'scene I true process restart (OS process boundary; not GUI)',
  () => {
    const keysToCleanup: string[] = []

    afterEach(async () => {
      const backend = probeBackend()
      for (const key of keysToCleanup.splice(0)) {
        try {
          await backend.delete(key)
        } catch {
          // best-effort cleanup
        }
      }
      _resetCredentialsForTests()
    })

    it('D: writer process exits; fresh vitest process hydrates (no wipeSessionMemoryOnly)', async () => {
      expect(existsSync(writerChildPath)).toBe(true)

      const key = uniqueKey('proc')
      keysToCleanup.push(key)
      const secret = 'UI-RESTART-PROC-SECRET'
      const kind = 'bearer'
      const payload = JSON.stringify({ kind, value: secret })
      const handshakePath = join(
        tmpdir(),
        `scene-i-ui-restart-hs-${process.pid}-${Date.now().toString(36)}.json`
      )

      const probe = requireProbe()

      // --- Phase 1: separate Node writer process persists then exits ---
      const writer = spawnSync(
        process.execPath,
        [writerChildPath, probe, key, payload, handshakePath],
        { encoding: 'utf8' }
      )
      expect(writer.status, `writer stderr: ${writer.stderr}`).toBe(0)
      expect(existsSync(handshakePath)).toBe(true)

      const handshake = JSON.parse(readFileSync(handshakePath, 'utf8')) as {
        writerPid: number
        key: string
        valueLen: number
        kind: string
      }
      expect(handshake.key).toBe(key)
      expect(handshake.valueLen).toBe(secret.length)
      expect(handshake.kind).toBe(kind)
      expect(handshake.writerPid).toBeGreaterThan(0)
      expect(handshake.writerPid).not.toBe(process.pid)
      // Writer must be dead (true process exit, not wipeSessionMemoryOnly).
      expect(processAlive(handshake.writerPid)).toBe(false)

      // Probe get from yet another short-lived process (process-level CM read).
      const probeGet = spawnSync(probe, ['get', key], { encoding: 'utf8' })
      expect(probeGet.status).toBe(0)
      const rawFromProbe = probeGet.stdout ?? ''
      const parsedProbe = JSON.parse(rawFromProbe) as { kind: string; value: string }
      expect(parsedProbe.kind).toBe(kind)
      expect(parsedProbe.value.length).toBe(secret.length)
      // Do not log secret

      // --- Phase 2: fresh vitest process hydrates via credentials.ts ---
      const vitestBin = join(
        desktopRoot,
        '..',
        '..',
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'vitest.CMD' : 'vitest'
      )
      expect(existsSync(vitestBin)).toBe(true)

      const hydrateEnv = {
        ...process.env,
        DESKTOP_WEBGIS_LIVE_KEYCHAIN: '1',
        DESKTOP_WEBGIS_KEYCHAIN_PROBE: probe,
        DESKTOP_WEBGIS_UI_RESTART_PHASE: 'hydrate',
        DESKTOP_WEBGIS_UI_RESTART_KEY: key,
        DESKTOP_WEBGIS_UI_RESTART_VALUE_LEN: String(secret.length),
        DESKTOP_WEBGIS_UI_RESTART_KIND: kind
      }

      const hydrate = spawnSync(
        vitestBin,
        ['run', 'src/__tests__/credentials-ui-restart-process.test.ts'],
        {
          cwd: desktopRoot,
          encoding: 'utf8',
          shell: true,
          env: hydrateEnv
        }
      )
      expect(hydrate.status, `hydrate stderr/out: ${hydrate.stderr}\n${hydrate.stdout}`).toBe(0)

      const resultLine = (hydrate.stdout || '')
        .split(/\r?\n/)
        .find((line) => line.includes('UI_RESTART_HYDRATE_RESULT '))
      expect(resultLine, 'missing UI_RESTART_HYDRATE_RESULT line').toBeTruthy()
      const jsonPart = resultLine!.split('UI_RESTART_HYDRATE_RESULT ')[1]
      const hydrateResult = JSON.parse(jsonPart) as {
        ok: boolean
        readerPid: number
        valueLen: number
        usedWipeSessionMemoryOnly: boolean
      }
      expect(hydrateResult.ok).toBe(true)
      expect(hydrateResult.valueLen).toBe(secret.length)
      expect(hydrateResult.usedWipeSessionMemoryOnly).toBe(false)
      expect(hydrateResult.readerPid).toBeGreaterThan(0)
      expect(hydrateResult.readerPid).not.toBe(handshake.writerPid)
      expect(hydrateResult.readerPid).not.toBe(process.pid)

      // Cleanup handshake file (CM entry cleaned in afterEach).
      try {
        unlinkSync(handshakePath)
      } catch {
        // ignore
      }

      // Persist a small orchestrator summary for evidence (no secrets).
      const summaryPath = join(
        tmpdir(),
        `scene-i-ui-restart-summary-${process.pid}.json`
      )
      writeFileSync(
        summaryPath,
        JSON.stringify(
          {
            writerPid: handshake.writerPid,
            readerPid: hydrateResult.readerPid,
            orchestratorPid: process.pid,
            writerAliveAfterExit: processAlive(handshake.writerPid),
            usedWipeSessionMemoryOnly: false,
            guiRelaunchAutomated: false,
            keyPrefix: key.slice(0, 24)
          },
          null,
          2
        )
      )
      // eslint-disable-next-line no-console
      console.log(`UI_RESTART_SUMMARY path=${summaryPath}`)
    })
  }
)

describe('scene I UI restart process gate (always runs)', () => {
  it('skips live process-restart suite unless DESKTOP_WEBGIS_LIVE_KEYCHAIN=1', () => {
    if (!LIVE) {
      expect(LIVE).toBe(false)
    } else if (isHydrateChild) {
      expect(HYDRATE_KEY.length).toBeGreaterThan(0)
    } else {
      expect(PROBE.length).toBeGreaterThan(0)
    }
  })
})
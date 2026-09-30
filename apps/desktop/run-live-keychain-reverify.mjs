import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(desktopRoot, '..', '..')
const tauriDir = join(desktopRoot, 'src-tauri')
const isWin = process.platform === 'win32'

console.log('[live-keychain] building secure-credential-probe ...')
const build = spawnSync(
  'cargo',
  ['build', '--bin', 'secure-credential-probe', '--manifest-path', join(tauriDir, 'Cargo.toml')],
  { cwd: repoRoot, stdio: 'inherit', shell: isWin, env: process.env }
)
if (build.status !== 0) {
  console.error('[live-keychain] cargo build failed')
  process.exit(build.status ?? 1)
}

const probe = join(
  tauriDir,
  'target',
  'debug',
  isWin ? 'secure-credential-probe.exe' : 'secure-credential-probe'
)
if (!existsSync(probe)) {
  console.error(`[live-keychain] probe not found at ${probe}`)
  process.exit(1)
}

const env = {
  ...process.env,
  DESKTOP_WEBGIS_LIVE_KEYCHAIN: '1',
  DESKTOP_WEBGIS_KEYCHAIN_PROBE: probe
}

console.log('[live-keychain] cargo test (live round-trip, gated) ...')
const cargoTest = spawnSync(
  'cargo',
  ['test', '--manifest-path', join(tauriDir, 'Cargo.toml'), 'live_os_keychain_round_trip', '--', '--nocapture'],
  { cwd: repoRoot, stdio: 'inherit', shell: isWin, env }
)
if (cargoTest.status !== 0) {
  console.error('[live-keychain] cargo live test failed')
  process.exit(cargoTest.status ?? 1)
}

const vitestBin = isWin
  ? join(repoRoot, 'node_modules', '.bin', 'vitest.CMD')
  : join(repoRoot, 'node_modules', '.bin', 'vitest')

console.log('[live-keychain] vitest live re-verify ...')
const vitest = spawnSync(
  vitestBin,
  ['run', 'src/__tests__/credentials-live-keychain.test.ts'],
  { cwd: desktopRoot, stdio: 'inherit', shell: true, env }
)
process.exit(vitest.status ?? 1)
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(desktopRoot, '..', '..')
const tauriDir = join(desktopRoot, 'src-tauri')
const isWin = process.platform === 'win32'

console.log('[ui-restart] building secure-credential-probe ...')
const build = spawnSync(
  'cargo',
  ['build', '--bin', 'secure-credential-probe', '--manifest-path', join(tauriDir, 'Cargo.toml')],
  { cwd: repoRoot, stdio: 'inherit', shell: isWin, env: process.env }
)
if (build.status !== 0) {
  console.error('[ui-restart] cargo build failed')
  process.exit(build.status ?? 1)
}

const probe = join(
  tauriDir,
  'target',
  'debug',
  isWin ? 'secure-credential-probe.exe' : 'secure-credential-probe'
)
if (!existsSync(probe)) {
  console.error(`[ui-restart] probe not found at ${probe}`)
  process.exit(1)
}

const env = {
  ...process.env,
  DESKTOP_WEBGIS_LIVE_KEYCHAIN: '1',
  DESKTOP_WEBGIS_KEYCHAIN_PROBE: probe
}
// Ensure orchestrator mode (not hydrate child).
delete env.DESKTOP_WEBGIS_UI_RESTART_PHASE
delete env.DESKTOP_WEBGIS_UI_RESTART_KEY

const vitestBin = isWin
  ? join(repoRoot, 'node_modules', '.bin', 'vitest.CMD')
  : join(repoRoot, 'node_modules', '.bin', 'vitest')

console.log('[ui-restart] vitest true process-restart re-verify ...')
console.log('[ui-restart] NOTE: this is OS process boundary + credentials hydrate; NOT full Tauri GUI quit/relaunch.')
const vitest = spawnSync(
  vitestBin,
  ['run', 'src/__tests__/credentials-ui-restart-process.test.ts'],
  { cwd: desktopRoot, stdio: 'inherit', shell: true, env }
)
process.exit(vitest.status ?? 1)
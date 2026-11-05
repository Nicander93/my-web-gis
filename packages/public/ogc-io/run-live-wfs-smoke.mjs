import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = dirname(fileURLToPath(import.meta.url))
const env = { ...process.env, DESKTOP_WEBGIS_LIVE_WFS: '1' }
const bin =
  process.platform === 'win32'
    ? join(cwd, 'node_modules', '.bin', 'vitest.CMD')
    : join(cwd, 'node_modules', '.bin', 'vitest')

const result = spawnSync(bin, ['run', 'src/wfs-live-smoke.test.ts'], {
  cwd,
  env,
  stdio: 'inherit',
  shell: true
})

process.exit(result.status ?? 1)
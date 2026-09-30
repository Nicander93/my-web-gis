/**
 * Phase-1 writer child for Scene I true process restart.
 * Persists payload via secure-credential-probe (same CM service as Tauri),
 * writes a handshake JSON (no secret value), then exits.
 *
 * Usage: node ui-restart-writer-child.mjs <probeExe> <key> <payloadJson> <handshakePath>
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [, , probe, key, payload, handshakePath] = process.argv

if (!probe || !key || !payload || !handshakePath) {
  console.error(
    'usage: node ui-restart-writer-child.mjs <probeExe> <key> <payloadJson> <handshakePath>'
  )
  process.exit(1)
}

let parsed
try {
  parsed = JSON.parse(payload)
} catch {
  console.error('payload must be JSON')
  process.exit(1)
}

if (typeof parsed?.value !== 'string' || !parsed.value) {
  console.error('payload.value required')
  process.exit(1)
}

const set = spawnSync(probe, ['set', key, payload], { encoding: 'utf8' })
if (set.status !== 0) {
  console.error(`probe set failed status=${set.status}: ${set.stderr || set.stdout || ''}`)
  process.exit(set.status ?? 1)
}

// Confirm readable from this same short-lived process before exit (still not wipeSessionMemoryOnly).
const get = spawnSync(probe, ['get', key], { encoding: 'utf8' })
if (get.status !== 0) {
  console.error(`probe get-after-set failed status=${get.status}`)
  process.exit(get.status ?? 1)
}

const handshake = {
  writerPid: process.pid,
  key,
  kind: parsed.kind ?? null,
  valueLen: parsed.value.length,
  probeSetStatus: set.status,
  note: 'writer exiting; OS Credential Manager retains payload; no secret in this file'
}

writeFileSync(handshakePath, JSON.stringify(handshake), 'utf8')
process.exit(0)
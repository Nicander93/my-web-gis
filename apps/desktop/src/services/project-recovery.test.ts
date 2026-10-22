import { expect, it } from 'vitest'
import { createProject, createDefaultLayerStyle, reconcileProjectCartography, type ProjectSnapshot } from '@desktop-webgis/gis-core'
import { createCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { ProjectRecovery, parseRecoveryEntry, recoveryKey } from './project-recovery'
import { RECOVERY_RETENTION_MS, type RecoveryCache } from './recovery-cache'

class Cache implements RecoveryCache {
  entries = new Map<string, string>()
  fail = false
  async list() { return [...this.entries].map(([key, text]) => ({ key, text })) }
  async write(key: string, text: string, expected: string | null) {
    if (this.fail) throw new Error('disk full')
    if ((this.entries.get(key) ?? null) !== expected) throw new Error('changed')
    this.entries.set(key, text)
  }
  async remove(key: string, expected: string | null) {
    if (this.entries.get(key) !== expected) return false
    this.entries.delete(key); return true
  }
}
function snapshot(id = 'p'): ProjectSnapshot {
  const project = createProject('Recovery'); project.id = id
  project.datasets = [{ id: 'd', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  project.layers = [{ id: 'l', datasetId: 'd', name: 'Data', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
  return { project: reconcileProjectCartography(project), featuresByDataset: { d: [{ id: 'f', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { code: '001', value: 2 } }] } }
}

it('persists detached 2D/3D snapshots by collision-free IDs without UI bookkeeping', async () => {
  const cache = new Cache(), recovery = new ProjectRecovery(cache), source = snapshot('../二维:project')
  const first = await recovery.write(source, 'D:/a.webgis.json', 'session:1')
  source.featuresByDataset.d[0].properties.value = 99
  const city = snapshot('city'); city.project.city = createCesiumScene()
  await recovery.write(city, null, 'session:2')
  expect((await recovery.list())).toHaveLength(2)
  const saved = parseRecoveryEntry({ key: first.key, text: cache.entries.get(first.key)! }).draft!
  expect(saved.snapshot.featuresByDataset.d[0]).toEqual({ id: 'f', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { code: '001', value: 2 } })
  expect(saved.sourcePath).toBe('D:/a.webgis.json')
  expect(first.text).not.toContain('projectEpoch')
  expect(first.key).toMatch(/^[a-f0-9]+$/)
  expect(() => recoveryKey('')).toThrow()
  expect(() => recoveryKey('x'.repeat(129))).toThrow()
})

it('failed writes preserve the old revision; stale discard and save cleanup preserve newer owners', async () => {
  const cache = new Cache(), recovery = new ProjectRecovery(cache), source = snapshot()
  const first = await recovery.write(source, null, 'a')
  cache.fail = true; source.featuresByDataset.d[0].properties.value = 3
  await expect(recovery.write(source, null, 'a')).rejects.toThrow('disk full')
  expect(cache.entries.get(first.key)).toBe(first.text)
  cache.fail = false
  const next = await recovery.write(source, null, 'a')
  expect(await recovery.discard(first)).toBe(false)
  await expect(recovery.write(source, null, 'b')).rejects.toThrow('已有未处理')
  const claimed = await recovery.write(source, null, 'b', next)
  await recovery.clearSaved(source, 'a')
  expect(cache.entries.get(first.key)).toBe(claimed.text)
  // A current fully acknowledged save also clears older draft contents of that owner.
  source.featuresByDataset.d[0].properties.value = 77
  await recovery.clearSaved(source, 'b')
  expect(cache.entries.size).toBe(0)
})

it('expires only validated old drafts and retains corrupt or unknown formats for explicit discard', async () => {
  const cache = new Cache(), recovery = new ProjectRecovery(cache)
  const old = await recovery.write(snapshot('old'), null, 'a')
  const raw = JSON.parse(old.text!); raw.updatedAt = Date.now() - RECOVERY_RETENTION_MS - 1000
  cache.entries.set(old.key, JSON.stringify(raw))
  const unknown = await recovery.write(snapshot('unknown'), null, 'a')
  const other = JSON.parse(unknown.text!); other.version = 900
  cache.entries.set(unknown.key, JSON.stringify(other))
  const corruptKey = recoveryKey('corrupt'); cache.entries.set(corruptKey, '{')
  const entries = await recovery.list()
  expect(cache.entries.has(old.key)).toBe(false)
  expect(entries).toHaveLength(2)
  expect(entries.every((entry) => entry.error && !entry.draft)).toBe(true)
  expect(await recovery.discard(entries.find((entry) => entry.key === corruptKey)!)).toBe(true)
})

it('rejects invalid identity, future timestamps, broken geometry and secrets without installing a draft', async () => {
  const cache = new Cache(), recovery = new ProjectRecovery(cache)
  const first = await recovery.write(snapshot(), null, 'a')
  for (const mutate of [
    (raw: any) => { raw.projectId = 'different' },
    (raw: any) => { raw.updatedAt = Date.now() + 10 * 60_000 },
    (raw: any) => { raw.snapshot.featuresByDataset.d[0].geometry.coordinates = ['wrong', 39] },
    (raw: any) => { raw.snapshot.featuresByDataset.d[0].properties = null },
    (raw: any) => { raw.snapshot.project.datasets = null }
  ]) {
    const raw = JSON.parse(first.text!); mutate(raw)
    expect(parseRecoveryEntry({ key: first.key, text: JSON.stringify(raw) }).draft).toBeUndefined()
  }
  const secret = snapshot(); (secret.project.datasets[0].source as any).token = 'credential-value'
  await expect(recovery.write(secret, null, 'a')).rejects.toThrow()
  expect(cache.entries.get(first.key)).toBe(first.text)
})

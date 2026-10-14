import { assertNoSecretValues, parseProjectSnapshot, type ProjectSnapshot } from '@desktop-webgis/gis-core'
import { RECOVERY_ENTRY_BYTES, RECOVERY_RETENTION_MS, recoveryCache, type RecoveryCache, type RecoveryCacheEntry } from './recovery-cache'

export interface RecoveryDraft {
  version: 1
  revision: string
  owner: string
  projectId: string
  updatedAt: number
  sourcePath: string | null
  snapshot: ProjectSnapshot
}
export interface RecoveryCandidate extends RecoveryCacheEntry { draft?: RecoveryDraft; expired?: boolean }

const sessionId = crypto.randomUUID()
export function recoveryOwner(epoch: number): string { return `${sessionId}:${epoch}` }

/** UTF-8 hex is reversible and collision-free; IDs never become filesystem paths. */
export function recoveryKey(projectId: string): string {
  const bytes = new TextEncoder().encode(projectId)
  if (!bytes.length || bytes.length > 128) throw new Error('项目 ID 超出恢复缓存限制')
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

export function parseRecoveryEntry(entry: RecoveryCacheEntry, now = Date.now()): RecoveryCandidate {
  try {
    if (!entry.text) throw new Error(entry.error ?? '无法读取草稿')
    if (new TextEncoder().encode(entry.text).length > RECOVERY_ENTRY_BYTES) throw new Error('草稿超出 32 MiB 限制')
    const raw = JSON.parse(entry.text)
    if (raw.version !== 1) throw new Error('草稿格式版本不受支持，缓存已保留')
    if (typeof raw.projectId !== 'string' || recoveryKey(raw.projectId) !== entry.key ||
      typeof raw.revision !== 'string' || !raw.revision || typeof raw.owner !== 'string' || !raw.owner || !Number.isFinite(raw.updatedAt) || raw.updatedAt < 0 ||
      raw.updatedAt > now + 5 * 60_000 || !(raw.sourcePath === null || typeof raw.sourcePath === 'string')) throw new Error('草稿元数据无效')
    assertNoSecretValues(raw.snapshot)
    const snapshot = parseProjectSnapshot(JSON.stringify(raw.snapshot))
    if (snapshot.project.id !== raw.projectId || typeof snapshot.project.name !== 'string' || !Array.isArray(snapshot.project.datasets) ||
      snapshot.project.datasets.some((dataset) => !dataset || typeof dataset.id !== 'string' || !dataset.source ||
        !['vector', 'wms', 'wmts', 'wfs'].includes(dataset.kind)) ||
      !snapshot.featuresByDataset || Array.isArray(snapshot.featuresByDataset) ||
      Object.values(snapshot.featuresByDataset).some((features) => !Array.isArray(features))) throw new Error('草稿项目内容无效')
    const depths: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }
    const validCoordinates = (value: unknown, depth: number): boolean => Array.isArray(value) && (depth === 0
      ? value.length >= 2 && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
      : value.every((child) => validCoordinates(child, depth - 1)))
    for (const features of Object.values(snapshot.featuresByDataset)) {
      const ids = new Set<string>()
      for (const feature of features) {
        const depth = feature?.geometry && depths[feature.geometry.type]
        if (!feature || typeof feature.id !== 'string' || ids.has(feature.id) || !feature.properties || Array.isArray(feature.properties) ||
          typeof feature.properties !== 'object' || typeof depth !== 'number' || !validCoordinates(feature.geometry.coordinates, depth)) throw new Error('草稿要素或几何无效')
        ids.add(feature.id)
      }
    }
    return { ...entry, draft: { ...raw, snapshot }, expired: now - raw.updatedAt > RECOVERY_RETENTION_MS }
  } catch (error) { return { ...entry, error: error instanceof Error ? error.message : String(error) } }
}

/** All writes/removals share a queue; compare-and-remove cannot erase a newer revision. */
export class ProjectRecovery {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private cache: RecoveryCache = recoveryCache) {}
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => undefined)
    return result
  }
  list(): Promise<RecoveryCandidate[]> {
    return this.enqueue(async () => {
      const entries = (await this.cache.list()).map((entry) => parseRecoveryEntry(entry))
      const remaining: RecoveryCandidate[] = []
      for (const entry of entries) {
        if (entry.expired && await this.cache.remove(entry.key, entry.text, entry.stamp)) continue
        remaining.push(entry)
      }
      return remaining.sort((a, b) => (b.draft?.updatedAt ?? 0) - (a.draft?.updatedAt ?? 0))
    })
  }
  async write(snapshot: ProjectSnapshot, sourcePath: string | null, owner: string, claimed?: RecoveryCandidate): Promise<RecoveryCandidate> {
    assertNoSecretValues(snapshot)
    const draft: RecoveryDraft = { version: 1, revision: crypto.randomUUID(), owner, projectId: snapshot.project.id,
      updatedAt: Date.now(), sourcePath, snapshot }
    const entry = { key: recoveryKey(draft.projectId), text: JSON.stringify(draft) }
    const parsed = parseRecoveryEntry(entry)
    if (!parsed.draft) return Promise.reject(new Error(parsed.error))
    return this.enqueue(async () => {
      const existing = (await this.cache.list()).find((item) => item.key === entry.key)
      if (existing) {
        const previous = parseRecoveryEntry(existing)
        if (claimed ? claimed.key !== entry.key || claimed.text !== existing.text : previous.draft?.owner !== owner) {
          throw new Error('已有未处理或其他会话的恢复草稿，请先恢复或舍弃；旧草稿已保留')
        }
        if (existing.text === null) throw new Error('草稿无法读取，请先明确舍弃损坏缓存')
      } else if (claimed) throw new Error('恢复草稿已被其他操作处理，请重新检查')
      await this.cache.write(entry.key, entry.text, existing?.text ?? null)
      return parsed
    })
  }
  discard(entry: RecoveryCandidate): Promise<boolean> {
    return this.enqueue(() => this.cache.remove(entry.key, entry.text, entry.stamp))
  }
  clearSaved(snapshot: ProjectSnapshot, owner: string): Promise<void> {
    const key = recoveryKey(snapshot.project.id)
    return this.enqueue(async () => {
      const entry = (await this.cache.list()).find((item) => item.key === key)
      if (!entry) return
      const candidate = parseRecoveryEntry(entry)
      if (candidate.draft?.owner === owner) await this.cache.remove(key, entry.text, entry.stamp)
    })
  }
}

export const projectRecovery = new ProjectRecovery()

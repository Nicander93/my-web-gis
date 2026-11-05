import { assertNoSecretValues, parseProjectSnapshot, serializeProjectFile, type FeatureEditBatch, type GisFeature, type DatasetField, type ProjectSnapshot } from '@desktop-webgis/project'
import { RECOVERY_ENTRY_BYTES, RECOVERY_RETENTION_MS, recoveryCache, type RecoveryCache, type RecoveryCacheEntry } from './recovery-cache'
import type { DatasetRecoverySession } from '@/project/datasets/feature-data-runtime'

export interface RecoveryDraft {
  version: 1 | 2
  revision: string
  owner: string
  projectId: string
  updatedAt: number
  sourcePath: string | null
  snapshot: ProjectSnapshot
  /** v2 草稿里会有：Provider 基线加上可选的 Buffer 增量。v1 只保存有效行的草稿里没有这一项。 */
  dataSessions?: Record<string, DatasetRecoverySession>
}
export interface RecoveryCandidate extends RecoveryCacheEntry { draft?: RecoveryDraft; expired?: boolean }

const sessionId = crypto.randomUUID()
export function recoveryOwner(epoch: number): string { return `${sessionId}:${epoch}` }

/** UTF-8 十六进制可逆且不会冲突；ID 不会变成文件系统路径。 */
export function recoveryKey(projectId: string): string {
  const bytes = new TextEncoder().encode(projectId)
  if (!bytes.length || bytes.length > 128) throw new Error('项目 ID 超出恢复缓存限制')
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function validCoordinates(value: unknown, depth: number): boolean {
  return Array.isArray(value) && (depth === 0
    ? value.length >= 2 && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    : value.every((child) => validCoordinates(child, depth - 1)))
}

function assertFeatures(features: GisFeature[], label: string): void {
  const depths: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }
  const ids = new Set<string>()
  for (const feature of features) {
    const depth = feature?.geometry && depths[feature.geometry.type]
    if (!feature || typeof feature.id !== 'string' || ids.has(feature.id) || !feature.properties || Array.isArray(feature.properties) ||
      typeof feature.properties !== 'object' || typeof depth !== 'number' || !validCoordinates(feature.geometry.coordinates, depth)) {
      throw new Error(`${label}要素或几何无效`)
    }
    ids.add(feature.id)
  }
}

function assertFields(fields: DatasetField[] | undefined): void {
  if (fields === undefined) return
  if (!Array.isArray(fields) || fields.some(field => !field || typeof field.name !== 'string' || !field.name)) throw new Error('草稿字段定义无效')
}

function assertPending(batch: FeatureEditBatch): void {
  if (!batch || !Array.isArray(batch.inserts) || !Array.isArray(batch.updates) || !Array.isArray(batch.deletes)) throw new Error('草稿待提交批次无效')
  assertFeatures(batch.inserts, '草稿待提交新增')
  assertFeatures(batch.updates, '草稿待提交更新')
  if (batch.deletes.some(id => typeof id !== 'string' || !id)) throw new Error('草稿待提交删除无效')
  if (batch.schema) assertFields(batch.schema.fields)
  if (batch.fieldIdentities) {
    if (!batch.fieldIdentities || Array.isArray(batch.fieldIdentities) || typeof batch.fieldIdentities !== 'object') throw new Error('草稿字段身份无效')
    for (const [name, identity] of Object.entries(batch.fieldIdentities)) {
      if (typeof name !== 'string' || !name || typeof identity !== 'string' || !identity) throw new Error('草稿字段身份无效')
    }
  }
}

function parseDataSessions(raw: unknown, snapshot: ProjectSnapshot): Record<string, DatasetRecoverySession> | undefined {
  if (raw === undefined) return undefined
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('草稿数据会话无效')
  const known = new Set(snapshot.project.content.kind === 'map2d' ? snapshot.project.content.datasets.map(dataset => dataset.id) : [])
  const sessions: Record<string, DatasetRecoverySession> = {}
  for (const [datasetId, value] of Object.entries(raw)) {
    if (!known.has(datasetId)) throw new Error('草稿数据会话引用了不存在的数据集')
    if (!value || Array.isArray(value) || typeof value !== 'object' || !Array.isArray(value.source)) throw new Error('草稿原始源无效')
    assertFeatures(value.source, '草稿原始源')
    assertFields(value.fields)
    if (value.pending !== undefined) assertPending(value.pending)
    sessions[datasetId] = {
      source: value.source,
      ...(value.fields !== undefined ? { fields: value.fields } : {}),
      ...(value.pending !== undefined ? { pending: value.pending } : {}),
    }
  }
  return sessions
}

export function parseRecoveryEntry(entry: RecoveryCacheEntry, now = Date.now()): RecoveryCandidate {
  try {
    if (!entry.text) throw new Error(entry.error ?? '无法读取草稿')
    if (new TextEncoder().encode(entry.text).length > RECOVERY_ENTRY_BYTES) throw new Error('草稿超出 32 MiB 限制')
    const raw = JSON.parse(entry.text)
    if (raw.version !== 1 && raw.version !== 2) throw new Error('草稿格式版本不受支持，缓存已保留')
    if (typeof raw.projectId !== 'string' || recoveryKey(raw.projectId) !== entry.key ||
      typeof raw.revision !== 'string' || !raw.revision || typeof raw.owner !== 'string' || !raw.owner || !Number.isFinite(raw.updatedAt) || raw.updatedAt < 0 ||
      raw.updatedAt > now + 5 * 60_000 || !(raw.sourcePath === null || typeof raw.sourcePath === 'string')) throw new Error('草稿元数据无效')
    assertNoSecretValues(raw.snapshot)
    const snapshot = parseProjectSnapshot(JSON.stringify(raw.snapshot))
    const datasets = snapshot.project.content.kind === 'map2d' ? snapshot.project.content.datasets : []
    if (snapshot.project.metadata.id !== raw.projectId || typeof snapshot.project.metadata.name !== 'string' || !Array.isArray(datasets) ||
      datasets.some((dataset) => !dataset || typeof dataset.id !== 'string' || !dataset.source ||
        !['vector', 'wms', 'wmts', 'wfs'].includes(dataset.kind)) ||
      !snapshot.featuresByDataset || Array.isArray(snapshot.featuresByDataset) ||
      Object.values(snapshot.featuresByDataset).some((features) => !Array.isArray(features))) throw new Error('草稿项目内容无效')
    for (const features of Object.values(snapshot.featuresByDataset)) assertFeatures(features, '草稿')
    const dataSessions = raw.version === 2 ? parseDataSessions(raw.dataSessions, snapshot) : undefined
    if (raw.version === 2 && raw.dataSessions === undefined) throw new Error('草稿缺少数据会话')
    if (raw.version === 1 && raw.dataSessions !== undefined) throw new Error('旧草稿不能携带数据会话')
    return { ...entry, draft: { version: raw.version, revision: raw.revision, owner: raw.owner, projectId: raw.projectId,
      updatedAt: raw.updatedAt, sourcePath: raw.sourcePath, snapshot, ...(dataSessions ? { dataSessions } : {}) },
      expired: now - raw.updatedAt > RECOVERY_RETENTION_MS }
  } catch (error) { return { ...entry, error: error instanceof Error ? error.message : String(error) } }
}

/** 所有写入和删除共用一条队列；比较并删除不会误删更新的版本。 */
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
  async write(snapshot: ProjectSnapshot, sourcePath: string | null, owner: string, claimed?: RecoveryCandidate, dataSessions?: Record<string, DatasetRecoverySession>): Promise<RecoveryCandidate> {
    assertNoSecretValues(snapshot)
    const sessions = dataSessions ?? claimed?.draft?.dataSessions ?? {}
    const rows: Record<string, GisFeature[]> = { ...snapshot.featuresByDataset }
    for (const [id, session] of Object.entries(sessions)) {
      rows[id] = [...session.source, ...(session.pending?.inserts ?? []), ...(session.pending?.updates ?? [])]
    }
    assertNoSecretValues({ project: snapshot.project, featuresByDataset: rows })
    const draft: RecoveryDraft = { version: 2, revision: crypto.randomUUID(), owner, projectId: snapshot.project.metadata.id,
      updatedAt: Date.now(), sourcePath, snapshot, dataSessions: sessions }
    const entry = { key: recoveryKey(draft.projectId), text: JSON.stringify({ ...draft, snapshot: JSON.parse(serializeProjectFile(snapshot)) }) }
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
    const key = recoveryKey(snapshot.project.metadata.id)
    return this.enqueue(async () => {
      const entry = (await this.cache.list()).find((item) => item.key === key)
      if (!entry) return
      const candidate = parseRecoveryEntry(entry)
      if (candidate.draft?.owner === owner) await this.cache.remove(key, entry.text, entry.stamp)
    })
  }
}

export const projectRecovery = new ProjectRecovery()

/**
 * Helpers for project persistence and shareable Scene compile.
 * Layout and credential *values* must never enter project files or Scene.
 */
import { cloneValue } from './clone'
import type { Dataset, Project, ProjectSnapshot, ServiceSource } from './types'

const SECRET_KEY_PATTERN = /(password|secret|token|authorization|api[_-]?key)/i

/** Deep-scan JSON-compatible value for secret-looking keys with non-empty string values. */
export function findSecretLeaks(value: unknown, path = '$'): string[] {
  const leaks: string[] = []
  if (Array.isArray(value)) {
    value.forEach((entry, index) => leaks.push(...findSecretLeaks(entry, `${path}[${index}]`)))
    return leaks
  }
  if (!value || typeof value !== 'object') return leaks
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    if (SECRET_KEY_PATTERN.test(key) && typeof entry === 'string' && entry.length > 0) {
      // Non-secret metadata field names that happen to match the pattern.
      if (
        key === 'tokenParam' ||
        key === 'credentialRef' ||
        childPath.endsWith('.credentialRef.key') ||
        (key === 'key' && path.endsWith('.credentialRef'))
      ) {
        continue
      }
      leaks.push(childPath)
    }
    leaks.push(...findSecretLeaks(entry, childPath))
  }
  return leaks
}

/** Strip runtime-only fields that must not be shared (none currently on Project). */
export function sanitizeProjectForPersistence(project: Project): Project {
  return cloneValue(project)
}

/**
 * Build a ProjectSnapshot suitable for .webgis.json files.
 * Does not include layout, selection, or credential values.
 */
export function buildPersistedSnapshot(
  project: Project,
  featuresByDataset: Record<string, import('./types').GisFeature[]>
): ProjectSnapshot {
  return {
    project: sanitizeProjectForPersistence(project),
    featuresByDataset: cloneValue(featuresByDataset)
  }
}

export function assertNoSecretValues(snapshot: ProjectSnapshot): void {
  const leaks = findSecretLeaks(snapshot)
  // credentialRef.key is allowed; filter false positives on key-only refs.
  const real = leaks.filter((path) => !path.includes('credentialRef'))
  if (real.length > 0) {
    throw new Error(`项目快照含疑似密钥字段，拒绝写入：${real.slice(0, 5).join(', ')}`)
  }
}

/** Drop credentialRef from service sources for Scene publish (no dynamic secrets by default). */
export function stripCredentialRefsFromDataset(dataset: Dataset): Dataset {
  if (dataset.kind === 'vector') return cloneValue(dataset)
  const source = cloneValue(dataset.source) as ServiceSource
  if ('credentialRef' in source) delete source.credentialRef
  return { ...cloneValue(dataset), source } as Dataset
}

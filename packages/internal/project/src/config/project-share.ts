/**
 * 用于项目持久化和可分享场景编译的辅助函数。
 * 布局和凭据的**值**绝对不能进入项目文件或场景。
 */
import { cloneValue } from '../clone'
import type { Dataset, Project, ProjectSnapshot, ServiceSource } from './types'
import { prepareProjectContent } from './project'

const SECRET_KEY_PATTERN = /(password|secret|token|authorization|api[_-]?key)/i

/** 深度扫描 JSON 兼容的值，找出名字像密钥、值又是非空字符串的字段。 */
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
      // 名字刚好匹配这个模式、但并不含密钥的元数据字段名。
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

/** 去掉不能共享的运行时字段（目前 Project 上没有这类字段）。 */
export function sanitizeProjectForPersistence(project: Project): Project {
  return prepareProjectContent(project)
}

/**
 * 构造一个适合写进 .webgis.json 文件的 ProjectSnapshot。
 * 不包含布局、选择集和凭据的值。
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
  // 允许出现 credentialRef.key；要过滤掉只有 key 的引用造成的误判。
  const real = leaks.filter((path) => !path.includes('credentialRef'))
  if (real.length > 0) {
    throw new Error(`项目快照含疑似密钥字段，拒绝写入：${real.slice(0, 5).join(', ')}`)
  }
}

/** 发布场景时从服务数据源里去掉 credentialRef，默认不携带动态密钥。 */
export function stripCredentialRefsFromDataset(dataset: Dataset): Dataset {
  if (dataset.kind === 'vector') return cloneValue(dataset)
  const source = cloneValue(dataset.source) as ServiceSource
  if ('credentialRef' in source) delete source.credentialRef
  return { ...cloneValue(dataset), source } as Dataset
}

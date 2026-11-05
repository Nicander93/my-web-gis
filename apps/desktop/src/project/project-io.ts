/**
 * Project file IO — save/load ProjectSnapshot without layout or credential values.
 */
import {
  assertNoSecretValues,
  buildPersistedSnapshot,
  parseProjectFileSnapshot,
  serializeProjectFile,
  type GisFeature,
  type Project,
  type ProjectSnapshot,
  type ProjectFormatMigration
} from '@desktop-webgis/project'
import { pickFile, pickSaveFile, readTextFile, writeTextFile } from '@/platform/files'
import { useProjectStore } from '@/project/project.store'
import { isTauri } from '@tauri-apps/api/core'
import { downloadProject, pickBrowserProject } from '@/platform/browser-project-files'
import { prepareProjectResourceReferences, resolveProjectResourceReferences } from './project-resource-references'
import { verifyStyleAssets } from '@desktop-webgis/ol-style/style-assets'
import { hasUnloadedDatasetReferences, loadDatasetReferences } from '@/project/datasets/dataset-reference-load'

export const PROJECT_FILE_FILTER = {
  name: 'Web GIS 项目',
  extensions: ['webgis.json', 'json']
}

let currentProjectPath: string | null = null
let pathEpoch: number | null = null
let resourceBase: { epoch: number; path: string } | null = null

/** 恢复出来的未保存副本，仍然可以从它原来的项目目录解析资源。 */
export function setProjectResourceBasePath(path: string | null): void {
  resourceBase = path ? { epoch: useProjectStore.getState().projectEpoch, path } : null
}

export function getProjectResourceBasePath(): string | null {
  return getCurrentProjectPath() ?? (resourceBase?.epoch === useProjectStore.getState().projectEpoch ? resourceBase.path : null)
}

export function getCurrentProjectPath(): string | null {
  return pathEpoch === useProjectStore.getState().projectEpoch ? currentProjectPath : null
}

export function setCurrentProjectPath(path: string | null): void {
  currentProjectPath = path
  pathEpoch = useProjectStore.getState().projectEpoch
}

export function createSnapshotFromState(
  project: Project,
  featuresByDataset: Record<string, GisFeature[]>
): ProjectSnapshot {
  const snapshot = buildPersistedSnapshot(project, featuresByDataset)
  assertNoSecretValues(snapshot)
  return snapshot
}

/**
 * 保存配置：已绑定的矢量数据源只保留 storage 引用，未绑定的数据源则嵌入
 * Provider 中的原始数据。待提交的 Buffer 修改永远不会写在这里。省略某个数据集的键并不表示
 * empty array — open paths load missing keys from storage.
 */
export function createConfigurationSnapshot(project: Project, sessions: Record<string, { source: GisFeature[] }>): ProjectSnapshot {
  const featuresByDataset: Record<string, GisFeature[]> = {}
  if (project.content.kind === 'map2d') {
    for (const dataset of project.content.datasets) {
      if (dataset.kind !== 'vector') continue
      if (dataset.storage) continue
      featuresByDataset[dataset.id] = sessions[dataset.id]?.source ?? []
    }
  }
  return createSnapshotFromState(project, featuresByDataset)
}

export async function saveSnapshotToPath(path: string, snapshot: ProjectSnapshot, sourcePath: string | null = getCurrentProjectPath()): Promise<void> {
  assertNoSecretValues(snapshot)
  await writeTextFile(path, serializeProjectFile(prepareProjectResourceReferences(snapshot, sourcePath, path)))
}

export async function pickAndSaveSnapshot(snapshot: ProjectSnapshot, suggestedName?: string): Promise<string | null> {
  const sourcePath = getCurrentProjectPath()
  if (!isTauri()) {
    assertNoSecretValues(snapshot)
    const name = suggestedName ?? 'project.webgis.json'
    downloadProject(serializeProjectFile(snapshot), name)
    return name
  }
  const path = await pickSaveFile({
    title: '保存项目',
    defaultPath: suggestedName ?? 'project.webgis.json',
    filters: [PROJECT_FILE_FILTER]
  })
  if (!path) return null
  await saveSnapshotToPath(path, snapshot, sourcePath)
  return path
}

export async function openSnapshotFromDisk(): Promise<{ path: string; snapshot: ProjectSnapshot; migration?: ProjectFormatMigration } | null> {
  let migration: ProjectFormatMigration | undefined
  const options = { onMigration: (value: ProjectFormatMigration) => { migration = value } }
  if (!isTauri()) {
    const file = await pickBrowserProject()
    if (!file) return null
    const snapshot = parseProjectFileSnapshot(await file.text(), options)
    if (hasUnloadedDatasetReferences(snapshot)) throw new Error('此工程引用本地数据文件，请使用桌面环境打开')
    await verifyStyleAssets(snapshot.project.content.kind === 'map2d' ? snapshot.project.content.cartography?.assets ?? [] : [])
    assertNoSecretValues(snapshot)
    return { path: file.name, snapshot, migration }
  }
  const path = await pickFile([PROJECT_FILE_FILTER])
  if (!path) return null
  return readSnapshotFromPath(path)
}

/** 已知路径的原生打开，和通过文件选择器打开一样，都走同一套脱离式校验和引用补全。 */
export async function readSnapshotFromPath(path: string): Promise<{ path: string; snapshot: ProjectSnapshot; migration?: ProjectFormatMigration }> {
  let migration: ProjectFormatMigration | undefined
  const options = { onMigration: (value: ProjectFormatMigration) => { migration = value } }
  const text = await readTextFile(path)
  const snapshot = parseProjectFileSnapshot(text, options)
  await verifyStyleAssets(snapshot.project.content.kind === 'map2d' ? snapshot.project.content.cartography?.assets ?? [] : [])
  assertNoSecretValues(snapshot)
  return { path, snapshot: await loadDatasetReferences(resolveProjectResourceReferences(snapshot, path)), migration }
}

/**
 * Project file IO — save/load ProjectSnapshot without layout or credential values.
 */
import {
  assertNoSecretValues,
  buildPersistedSnapshot,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  type GisFeature,
  type Project,
  type ProjectSnapshot
} from '@desktop-webgis/gis-core'
import { pickFile, pickSaveFile, readTextFile, writeTextFile } from '@/services/files'
import { getLiveMapState } from '@/features/map/map-runtime-host'
import { getLiveCityCamera } from '@/features/city/city-runtime-host'
import { useProjectStore } from '@/stores/project.store'
import { isTauri } from '@tauri-apps/api/core'
import { downloadProject, pickBrowserProject } from './browser-project-files'
import { prepareProjectResourceReferences, resolveProjectResourceReferences } from './project-resource-references'

export const PROJECT_FILE_FILTER = {
  name: 'Web GIS 项目',
  extensions: ['webgis.json', 'json']
}

let currentProjectPath: string | null = null
let pathEpoch: number | null = null

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
  const liveMapState = getLiveMapState()
  const projectWithView = liveMapState
    ? { ...project, mapState: liveMapState }
    : project
  const camera = getLiveCityCamera()
  const snapshot = buildPersistedSnapshot(projectWithView.city && camera
    ? { ...projectWithView, city: { ...projectWithView.city, camera } } : projectWithView, featuresByDataset)
  assertNoSecretValues(snapshot)
  return snapshot
}

export async function saveSnapshotToPath(path: string, snapshot: ProjectSnapshot, sourcePath: string | null = getCurrentProjectPath()): Promise<void> {
  assertNoSecretValues(snapshot)
  await writeTextFile(path, serializeProjectSnapshot(prepareProjectResourceReferences(snapshot, sourcePath, path)))
}

export async function pickAndSaveSnapshot(snapshot: ProjectSnapshot, suggestedName?: string): Promise<string | null> {
  const sourcePath = getCurrentProjectPath()
  if (!isTauri()) {
    assertNoSecretValues(snapshot)
    const name = suggestedName ?? 'project.webgis.json'
    downloadProject(serializeProjectSnapshot(snapshot), name)
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

export async function openSnapshotFromDisk(): Promise<{ path: string; snapshot: ProjectSnapshot } | null> {
  if (!isTauri()) {
    const file = await pickBrowserProject()
    if (!file) return null
    const snapshot = parseProjectSnapshot(await file.text())
    assertNoSecretValues(snapshot)
    return { path: file.name, snapshot }
  }
  const path = await pickFile([PROJECT_FILE_FILTER])
  if (!path) return null
  const text = await readTextFile(path)
  const snapshot = parseProjectSnapshot(text)
  assertNoSecretValues(snapshot)
  return { path, snapshot: resolveProjectResourceReferences(snapshot, path) }
}

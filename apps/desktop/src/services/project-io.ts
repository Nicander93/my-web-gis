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
import { isTauri } from '@tauri-apps/api/core'
import { downloadProject, pickBrowserProject } from './browser-project-files'

export const PROJECT_FILE_FILTER = {
  name: 'Web GIS 项目',
  extensions: ['webgis.json', 'json']
}

let currentProjectPath: string | null = null

export function getCurrentProjectPath(): string | null {
  return currentProjectPath
}

export function setCurrentProjectPath(path: string | null): void {
  currentProjectPath = path
}

export function createSnapshotFromState(
  project: Project,
  featuresByDataset: Record<string, GisFeature[]>
): ProjectSnapshot {
  const liveMapState = getLiveMapState()
  const projectWithView = liveMapState
    ? { ...project, mapState: liveMapState }
    : project
  const snapshot = buildPersistedSnapshot(projectWithView, featuresByDataset)
  assertNoSecretValues(snapshot)
  return snapshot
}

export async function saveSnapshotToPath(path: string, snapshot: ProjectSnapshot): Promise<void> {
  assertNoSecretValues(snapshot)
  await writeTextFile(path, serializeProjectSnapshot(snapshot))
  currentProjectPath = path
}

export async function pickAndSaveSnapshot(snapshot: ProjectSnapshot, suggestedName?: string): Promise<string | null> {
  if (!isTauri()) {
    assertNoSecretValues(snapshot)
    const name = suggestedName ?? 'project.webgis.json'
    downloadProject(serializeProjectSnapshot(snapshot), name)
    currentProjectPath = null
    return name
  }
  const path = await pickSaveFile({
    title: '保存项目',
    defaultPath: suggestedName ?? 'project.webgis.json',
    filters: [PROJECT_FILE_FILTER]
  })
  if (!path) return null
  await saveSnapshotToPath(path, snapshot)
  return path
}

export async function openSnapshotFromDisk(): Promise<{ path: string; snapshot: ProjectSnapshot } | null> {
  if (!isTauri()) {
    const file = await pickBrowserProject()
    if (!file) return null
    const snapshot = parseProjectSnapshot(await file.text())
    assertNoSecretValues(snapshot)
    currentProjectPath = null
    return { path: file.name, snapshot }
  }
  const path = await pickFile([PROJECT_FILE_FILTER])
  if (!path) return null
  const text = await readTextFile(path)
  const snapshot = parseProjectSnapshot(text)
  assertNoSecretValues(snapshot)
  currentProjectPath = path
  return { path, snapshot }
}

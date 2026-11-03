import { ApplyProjectSnapshotEditCommand, ReplaceProjectSnapshotCommand, assertProjectSnapshotWorkspace,
  cloneValue, createId, prepareProjectContent, reconcileProjectCartography, type ProjectSnapshot } from '@desktop-webgis/project'
import { loadProjectConfiguration, useProjectStore } from '@/session/project.store'
import { notifyProjectReplaced } from '@/session/session-events'
import { featureData } from '@/data/feature-data'
import { datasetSchemas, type DatasetRecoverySession } from '@/data/feature-data-runtime'
import { projectEdits } from './project-edits'

function assertFeatureIds(features: Record<string, { id: string }[]>): void {
  for (const rows of Object.values(features)) {
    if (rows.some(row => !row.id) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('工程数据存在空或重复要素 ID')
  }
}

/** Application lifecycle combines the sole configuration, data and session owners. */
export const projectSession = {
  getSnapshot(): ProjectSnapshot {
    return { project: cloneValue(useProjectStore.getState().project), featuresByDataset: featureData.snapshot() }
  },
  loadSnapshot(snapshot: ProjectSnapshot, sessions?: Record<string, DatasetRecoverySession>): void {
    featureData.assertIdle()
    const project = prepareProjectContent(snapshot.project)
    const features = cloneValue(snapshot.featuresByDataset ?? {})
    if (project.content.kind === 'map2d') for (const dataset of project.content.datasets) {
      if (dataset.kind === 'vector' && !Object.hasOwn(features, dataset.id)) features[dataset.id] = []
    }
    assertProjectSnapshotWorkspace({ project, featuresByDataset: features })
    assertFeatureIds(features)
    if (sessions) {
      if (project.content.kind !== 'map2d') throw new Error('恢复会话只能用于二维工程')
      const known = new Set(project.content.datasets.map(dataset => dataset.id))
      for (const [id, session] of Object.entries(sessions)) {
        if (!known.has(id)) throw new Error('恢复会话引用了不存在的数据集')
        assertFeatureIds({ [id]: session.source })
        if (session.pending) {
          assertFeatureIds({ [id]: [...session.pending.inserts, ...session.pending.updates] })
          for (const row of [...session.pending.inserts, ...session.pending.updates]) {
            if (session.pending.deletes.includes(row.id)) throw new Error('恢复会话的待提交批次无效')
          }
        }
      }
    }
    const schemas = datasetSchemas(project)
    notifyProjectReplaced()
    projectEdits.clear()
    if (sessions) {
      const complete = { ...sessions }
      if (project.content.kind === 'map2d') for (const dataset of project.content.datasets) {
        if (dataset.kind === 'vector' && !Object.hasOwn(complete, dataset.id)) complete[dataset.id] = { source: [], fields: schemas[dataset.id] }
      }
      featureData.transaction(() => { featureData.installActiveSessions(complete); loadProjectConfiguration(project) })
    } else featureData.transaction(() => { featureData.replaceAll(features, schemas); loadProjectConfiguration(project) })
  },
  applySnapshotAsEdit(snapshot: ProjectSnapshot, label: string): boolean {
    const before = projectSession.getSnapshot()
    const after = { ...snapshot, project: reconcileProjectCartography(snapshot.project, before.project) }
    if (JSON.stringify(before) === JSON.stringify(after)) return false
    return projectEdits.execute(new ApplyProjectSnapshotEditCommand(createId('cmd'), label, before, after))
  },
  replaceSnapshotAsEdit(snapshot: ProjectSnapshot, label: string): boolean {
    const before = projectSession.getSnapshot()
    if (JSON.stringify(before) === JSON.stringify(snapshot)) return false
    return projectEdits.execute(new ReplaceProjectSnapshotCommand(createId('cmd'), label, before, snapshot))
  }
}

import { useProjectStore } from '@/stores/project.store'
import { createProjectFromSceneDocument } from './project-scene-document'

/** Call after resource preparation and draft guards; validation completes before any Store write. */
export function replaceSceneDocumentAsEdit(input: unknown, label = '导入完整场景'): boolean {
  const snapshot = createProjectFromSceneDocument(input)
  return useProjectStore.getState().replaceSnapshotAsEdit(snapshot, label)
}

import { projectSession } from '@/session/project-session'
import { useProjectStore } from '@/session/project.store'
import { createProjectFromSceneDocument } from '@/exchange/project-scene-document'

/** Call after resource preparation and draft guards; validation completes before any Store write. */
export function replaceSceneDocumentAsEdit(input: unknown, label = '导入完整场景'): boolean {
  const snapshot = createProjectFromSceneDocument(input)
  return projectSession.replaceSnapshotAsEdit(snapshot, label)
}

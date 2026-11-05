import { projectSession } from '@/project/project-session'
import { useProjectStore } from '@/project/project.store'
import { createProjectFromSceneDocument } from '@/io/project-scene-document'

/** 在资源准备和草稿守卫之后调用；全部校验通过才写入 Store。 */
export function replaceSceneDocumentAsEdit(input: unknown, label = '导入完整场景'): boolean {
  const snapshot = createProjectFromSceneDocument(input)
  return projectSession.replaceSnapshotAsEdit(snapshot, label)
}

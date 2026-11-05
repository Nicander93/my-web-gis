import { create } from 'zustand'
import { assertProjectSnapshotWorkspace, createProject, reconcileProjectCartography, type Project } from '@desktop-webgis/project'

interface ProjectState {
  /** 工程代次：每次新建/打开/恢复工程时递增，用于失效旧工程的异步回调与预览会话。 */
  projectEpoch: number
  /** 当前工程内的配置修订号：仅在工程配置变更时递增，纯要素编辑不会推进该版本号。 */
  configRevision: number
  project: Project
  /** 工程配置是否有未保存修改（对应标题栏“未保存”提示，不含未提交的要素增量）。 */
  dirty: boolean
  setDirty(dirty: boolean): void
}

function configurationUpdate(state: ProjectState, next: Partial<ProjectState>): Partial<ProjectState> {
  const project = next.project
  if (project) assertProjectSnapshotWorkspace({ project, featuresByDataset: {} })
  const changed = project && project !== state.project
  const newEpoch = next.projectEpoch !== undefined && next.projectEpoch !== state.projectEpoch
  if (!changed && !newEpoch) return next
  return { ...next, ...(changed ? { project: reconcileProjectCartography(project, newEpoch ? undefined : state.project) } : {}), configRevision: newEpoch ? 0 : state.configRevision + 1 }
}

export const useProjectStore = create<ProjectState>(set => ({
  projectEpoch: 0,
  configRevision: 0,
  project: createProject(),
  dirty: false,
  setDirty: dirty => set({ dirty })
}))

let contentVersion = 0
useProjectStore.subscribe((state, previous) => {
  if (state.project !== previous.project) contentVersion++
})

/** 仅反映工程配置对象是否变化；要素 Buffer 的未提交修改由 FeatureEditState.unsavedCount 追踪。 */
export function getProjectContentVersion(): number { return contentVersion }

/** 在命令执行成功后发布新的工程配置，并将配置标记为 dirty。 */
export function commitProjectConfiguration(project: Project): void {
  const state = useProjectStore.getState()
  if (project === state.project) return
  useProjectStore.setState(configurationUpdate(state, { project, dirty: true }))
}

/** 仅在切换或新建工程时调用：推进 projectEpoch 并重置配置 dirty 状态。 */
export function loadProjectConfiguration(project: Project): void {
  useProjectStore.setState(state => configurationUpdate(state, { project, projectEpoch: state.projectEpoch + 1, dirty: false }))
}

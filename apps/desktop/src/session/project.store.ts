import { create } from 'zustand'
import { assertProjectSnapshotWorkspace, createProject, reconcileProjectCartography, type Project } from '@desktop-webgis/project'

interface ProjectState {
  projectEpoch: number
  /** Configuration revision within this project epoch; feature and session changes do not advance it. */
  configRevision: number
  project: Project
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

/** Configuration identity only. Feature Buffer edits are tracked by FeatureEditState.unsavedCount. */
export function getProjectContentVersion(): number { return contentVersion }

/** Application edit boundary publishes validated configuration once after command success. */
export function commitProjectConfiguration(project: Project): void {
  const state = useProjectStore.getState()
  if (project === state.project) return
  useProjectStore.setState(configurationUpdate(state, { project, dirty: true }))
}

/** Only the Application lifecycle opens a new configuration epoch. */
export function loadProjectConfiguration(project: Project): void {
  useProjectStore.setState(state => configurationUpdate(state, { project, projectEpoch: state.projectEpoch + 1, dirty: false }))
}

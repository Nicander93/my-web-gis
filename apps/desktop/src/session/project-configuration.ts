import { ApplyProjectConfigurationCommand, cloneValue, createId,
  reconcileProjectCartography, type EditTargets, type Project } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { projectEdits } from './project-edits'

/** Detached configuration drafts contain no feature data and always commit through the single history. */
export const projectConfiguration = {
  getSnapshot(): Project { return cloneValue(useProjectStore.getState().project) },
  apply(after: Project, label: string, targets?: EditTargets): boolean {
    const before = useProjectStore.getState().project
    if (JSON.stringify(before) === JSON.stringify(after)) return false
    return projectEdits.execute(new ApplyProjectConfigurationCommand(createId('cmd'), label, before, reconcileProjectCartography(after, before), targets))
  }
}

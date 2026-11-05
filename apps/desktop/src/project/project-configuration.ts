import { ApplyProjectConfigurationCommand, cloneValue, createId,
  reconcileProjectCartography, type EditTargets, type Project } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { projectEdits } from './project-edits'

/** 脱离的配置草稿不含要素数据，始终通过同一条历史提交。 */
export const projectConfiguration = {
  getSnapshot(): Project { return cloneValue(useProjectStore.getState().project) },
  apply(after: Project, label: string, targets?: EditTargets): boolean {
    const before = useProjectStore.getState().project
    if (JSON.stringify(before) === JSON.stringify(after)) return false
    return projectEdits.execute(new ApplyProjectConfigurationCommand(createId('cmd'), label, before, reconcileProjectCartography(after, before), targets))
  }
}

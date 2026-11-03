import type { CesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { createCesiumScene, parseCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { requireSceneContent } from '../config/project-content'
import type { EditCommand, EditContext, EditTargets } from './editHistory'
import { getSceneEditTargets, mergeEditTargets } from './edit-targets'
import type { ProjectEditContext } from './configCommands'

/** 三维场景配置与拖动提交共用工程编辑历史。 */
export class SetCesiumSceneCommand implements EditCommand {
  readonly targets: EditTargets
  readonly scope = 'configuration' as const
  private readonly before?: CesiumScene
  private readonly after?: CesiumScene
  constructor(readonly id: string, readonly label: string, before: CesiumScene | undefined, after: CesiumScene | undefined, targets?: EditTargets) {
    this.before = before === undefined ? undefined : parseCesiumScene(before)
    this.after = after === undefined ? undefined : parseCesiumScene(after)
    this.targets = mergeEditTargets(getSceneEditTargets(this.before, this.after), targets)
  }
  execute(context: EditContext): void { this.replace(context, this.after) }
  undo(context: EditContext): void { this.replace(context, this.before) }
  private replace(context: EditContext, scene: CesiumScene | undefined): void {
    const projectContext = context as Partial<ProjectEditContext>
    if (!projectContext.getProject || !projectContext.replaceProject) throw new Error('三维编辑需要 ProjectEditContext')
    const current = projectContext.getProject()
    const next = { ...current, content: { ...requireSceneContent(current), scene: structuredClone(scene ?? createCesiumScene()) } }
    projectContext.replaceProject(next)
  }
}

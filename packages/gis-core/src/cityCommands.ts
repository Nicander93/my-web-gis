import type { CityScene } from '@desktop-webgis/cesium-scene-schema'
import { parseCityScene } from '@desktop-webgis/cesium-scene-schema'
import type { EditCommand, EditContext } from './editHistory'
import type { ProjectEditContext } from './configCommands'

/** City configuration and drag commits share the existing project edit history. */
export class SetCitySceneCommand implements EditCommand {
  private readonly before?: CityScene
  private readonly after?: CityScene
  constructor(readonly id: string, readonly label: string, before: CityScene | undefined, after: CityScene | undefined) {
    this.before = before === undefined ? undefined : parseCityScene(before)
    this.after = after === undefined ? undefined : parseCityScene(after)
  }
  execute(context: EditContext): void { this.replace(context, this.after) }
  undo(context: EditContext): void { this.replace(context, this.before) }
  private replace(context: EditContext, city: CityScene | undefined): void {
    const projectContext = context as Partial<ProjectEditContext>
    if (!projectContext.getProject || !projectContext.replaceProject) throw new Error('三维编辑需要 ProjectEditContext')
    const next = { ...projectContext.getProject() }
    if (city === undefined) delete next.city
    else next.city = structuredClone(city)
    projectContext.replaceProject(next)
  }
}

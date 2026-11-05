import { createId } from '@desktop-webgis/project'

interface StyleInteraction { layerId: string; property: string; id: string }
let interaction: StyleInteraction | undefined

/** 只有手势的身份是临时的；每个值本身已经属于 Project 和历史。 */
export function beginStyleInteraction(layerId: string, property: string): string {
  if (interaction?.layerId !== layerId || interaction.property !== property) interaction = { layerId, property, id: createId('style-gesture') }
  return interaction.id
}

/** 在保存、切换目标、撤销或关闭编辑器之前结束合并。 */
export function finishStyleInteraction(layerId?: string): void {
  if (layerId === undefined || interaction?.layerId === layerId) interaction = undefined
}

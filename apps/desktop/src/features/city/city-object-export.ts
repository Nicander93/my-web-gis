import type { ProjectSnapshot } from '@desktop-webgis/gis-core'
import { compileProjectToScene } from '@desktop-webgis/scene-core'

/** Export selected objects as a reopenable scene, retaining referenced groups/assets. */
export function compileCityObjectExport(snapshot: ProjectSnapshot, ids: readonly string[]) {
  const scene = compileProjectToScene(snapshot).scene
  if (!scene.city) throw new Error('当前项目没有三维场景')
  scene.city.nodes = scene.city.nodes.filter(node => ids.includes(node.id))
  if (!scene.city.nodes.length) throw new Error('请选择要导出的对象')
  const groups = new Set(scene.city.nodes.map(node => node.groupId))
  scene.city.groups = scene.city.groups?.filter(group => groups.has(group.id))
  const assets = new Set(scene.city.nodes.flatMap(node => node.type === 'water' || node.type === 'graphic' ? [] : [node.asset]))
  scene.city.assets = Object.fromEntries(Object.entries(scene.city.assets).filter(([id]) => assets.has(id)))
  return scene
}

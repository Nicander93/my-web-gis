import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import packageInfo from '@/../package.json'
import { isTauri } from '@tauri-apps/api/core'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { getProjectType } from '@/project/project-type'
import { getCurrentProjectPath } from '@/project/project-io'
import { getMapRuntime } from '@/engine-host/map-runtime-host'
import { getLiveSceneDiagnostics } from '@/engine-host/scene3d-runtime-host'
import { redactTaskText } from '@/stores/task-log.store'

export type ResourceStates = Record<string, { state: 'loading' | 'ready' | 'error'; error?: string }>
export interface DiagnosticResource { id: string; name: string; source: string; state: string; error?: string }

/** 读取二维（OpenLayers）或三维（Cesium）运行时的公开诊断状态，不创建额外渲染上下文。 */
export function collectDiagnostics(states: ResourceStates = {}) {
  const store = useProjectStore.getState(), storeFeatureData = featureData.readSnapshot(), project = store.project
  const is3D = getProjectType(project) === '3d'
  const resources: DiagnosticResource[] = is3D ? (project.content.scene?.nodes ?? []).filter(node => 'asset' in node).map(node => {
    const asset = 'asset' in node ? project.content.scene?.assets[node.asset] : undefined
    const source = asset?.reference ? asset.reference.kind === 'url' ? asset.reference.url : asset.reference.path : asset?.url ?? '未设置'
    return { id: node.id, name: node.name, source: redactTaskText(source), state: states[node.id]?.state ?? 'unknown', error: states[node.id]?.error && redactTaskText(states[node.id].error!) }
  }) : requireMapContent(project).layers.map(layer => {
    const dataset = requireMapContent(project).datasets.find(item => item.id === layer.datasetId)
    const loading = useLayerViewStore.getState().sessions[layer.id]?.loading
    const source = dataset?.source
    const address = !source ? '数据集缺失' : 'url' in source ? source.url : 'path' in source ? source.path : source.label
    return { id: layer.id, name: layer.name, source: redactTaskText(address), state: !dataset ? 'error' : loading ? 'loading' : dataset.kind === 'vector' && getMapRuntime()?.registry.get(layer.id) ? 'ready' : 'unknown', ...(!dataset ? { error: '关联数据集不存在' } : {}) }
  })
  let renderer = '当前视图未提供 WebGL 信息'
  if (is3D && typeof document !== 'undefined') {
    const canvas = document.querySelector<HTMLCanvasElement>('.scene3d-canvas__viewport canvas')
    try {
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
      if (gl) renderer = `${gl.getParameter(gl.VERSION)} · ${gl.getParameter(gl.RENDERER)}`
    } catch { renderer = '无法读取渲染信息' }
  }
  return {
    collectedAt: new Date().toISOString(),
    project: { name: project.metadata.name, path: getCurrentProjectPath() ?? '尚无本地保存路径', saveState: store.dirty ? '有未保存修改' : '无未保存修改',
      layers: is3D ? project.content.scene?.nodes.length ?? 0 : requireMapContent(project).layers.length, features: Object.values(storeFeatureData).reduce((sum, rows) => sum + rows.length, 0) },
    resources,
    environment: { version: packageInfo.version, host: isTauri() ? 'Windows 桌面应用' : '浏览器', engine: is3D ? 'Cesium' : 'OpenLayers',
      running: is3D ? !!getLiveSceneDiagnostics() : !!getMapRuntime(), renderer, runtime: is3D ? getLiveSceneDiagnostics() : null }
  }
}

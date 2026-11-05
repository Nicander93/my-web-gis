import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/project/project-session'
import { beforeEach, expect, it, vi } from 'vitest'
import { createProject } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { layerCommands } from './layer.commands'
import { openActivityPanel, useActivityPanelStore } from '@/stores/activity-panel.store'

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  projectSession.loadSnapshot({ project:createProject(), featuresByDataset:{} })
  useWorkspaceStore.getState().resetLayout()
})
function add(name:string): string {
  layerContentCommands.addLayer(name, name, [{ id:name, geometry:{ type:'Point', coordinates:[0,0] }, properties:{} }], 'point')
  return useLayerViewStore.getState().selectedLayerId!
}
it('browsing another layer keeps the editing target and closed inspector; explicit properties opens it', () => {
  const first = add('编辑图层'), second = add('查看图层')
  useProjectStore.getState().setDirty(false)
  const before = projectSession.getSnapshot()
  layerCommands.setEditingTarget(first)
  useLayerViewStore.getState().setSelectedLayer(second)
  expect(useWorkbenchStore.getState().editLayerId).toBe(first)
  expect(useWorkspaceStore.getState().right.open).toBe(false)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(projectSession.getSnapshot()).toEqual(before)
  layerCommands.editStyle(first)
  layerCommands.openProperties(second)
  expect(useWorkspaceStore.getState().right.open).toBe(true)
  expect(useLayerViewStore.getState().inspectorTab).toBe('layer')
  expect(useWorkbenchStore.getState().editLayerId).toBe(first)
  layerContentCommands.removeLayer(first)
  expect(useWorkbenchStore.getState().editLayerId).toBeNull()
})
it('does not accept a tile service as an editing target and clears the target when opening a project', () => {
  const id = add('本地图层')
  layerCommands.setEditingTarget(id)
  const service = layerContentCommands.addServiceLayer({ name:'影像', kind:'wms', source:{ type:'wms', url:'https://example.com/wms', version:'1.3.0', layerNames:['a'], styleNames:[], format:'image/png', transparent:true, authMode:'none' } })!
  layerCommands.setEditingTarget(service.layerId)
  expect(useWorkbenchStore.getState().editLayerId).toBe(id)
  projectSession.loadSnapshot(projectSession.getSnapshot())
  expect(useWorkbenchStore.getState().editLayerId).toBeNull()
})

it('table and map filtering have separate windows without changing data on open', () => {
  const id = add('本地图层'), before = projectSession.getSnapshot()
  openActivityPanel('diagnostics')
  layerCommands.openAttributeTable(id)
  expect(useActivityPanelStore.getState().tab).toBe('attributes')
  expect(useWorkbenchStore.getState().tableLayerId).toBe(id)
  openActivityPanel('tasks')
  const listener = vi.fn()
  window.addEventListener('desktop-webgis:layer-filter', listener)
  layerCommands.openFilter(id)
  window.removeEventListener('desktop-webgis:layer-filter', listener)
  expect(listener).toHaveBeenCalledOnce()
  expect(useActivityPanelStore.getState().tasksOpen).toBe(true)
  expect(useLayerViewStore.getState().getLayerSession(id).attributeTable?.filterOpen ?? false).toBe(false)
  expect(projectSession.getSnapshot()).toEqual(before)
})

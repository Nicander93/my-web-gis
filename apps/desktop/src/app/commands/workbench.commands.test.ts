import { beforeEach, expect, it, vi } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useSessionStore } from '@/stores/session.store'
import { layerCommands } from './layer.commands'

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  useProjectStore.getState().loadSnapshot({ project:createProject(), featuresByDataset:{} })
  useWorkspaceStore.getState().resetLayout()
})
function add(name:string): string {
  useProjectStore.getState().addLayer(name, name, [{ id:name, geometry:{ type:'Point', coordinates:[0,0] }, properties:{} }], 'point')
  return useProjectStore.getState().selectedLayerId!
}
it('browsing another layer keeps the editing target and closed inspector; explicit properties opens it', () => {
  const first = add('编辑图层'), second = add('查看图层')
  useProjectStore.getState().setDirty(false)
  const before = useProjectStore.getState().getSnapshot()
  layerCommands.setEditingTarget(first)
  useProjectStore.getState().setSelectedLayer(second)
  expect(useWorkbenchStore.getState().editLayerId).toBe(first)
  expect(useWorkspaceStore.getState().right.open).toBe(false)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  layerCommands.editStyle(first)
  layerCommands.openProperties(second)
  expect(useWorkspaceStore.getState().right.open).toBe(true)
  expect(useSessionStore.getState().inspectorTab).toBe('layer')
  expect(useWorkbenchStore.getState().editLayerId).toBe(first)
  useProjectStore.getState().removeLayer(first)
  expect(useWorkbenchStore.getState().editLayerId).toBeNull()
})
it('does not accept a tile service as an editing target and clears the target when opening a project', () => {
  const id = add('本地图层')
  layerCommands.setEditingTarget(id)
  const service = useProjectStore.getState().addServiceLayer({ name:'影像', kind:'wms', source:{ type:'wms', url:'https://example.com/wms', version:'1.3.0', layerNames:['a'], styleNames:[], format:'image/png', transparent:true, authMode:'none' } })!
  layerCommands.setEditingTarget(service.layerId)
  expect(useWorkbenchStore.getState().editLayerId).toBe(id)
  useProjectStore.getState().loadSnapshot(useProjectStore.getState().getSnapshot())
  expect(useWorkbenchStore.getState().editLayerId).toBeNull()
})

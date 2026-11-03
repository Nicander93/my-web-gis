import { beforeEach, describe, expect, it, vi } from 'vitest'
import View from 'ol/View'
import { transform } from 'ol/proj'
import { createDefaultLayerStyle, createProject, requireMapContent } from '@desktop-webgis/project'
import { registerMapProjections } from '@/runtime/map-projections'
import { featureData } from '@/data/feature-data'
import { projectEdits } from '@/session/project-edits'
import { projectSession } from '@/session/project-session'
import { useProjectStore } from '@/session/project.store'
import { useWorkbenchStore } from '@/view-state/workbench.store'
import { viewCommands } from './view.commands'

const probe = vi.hoisted(() => ({ runtime: vi.fn(), status: vi.fn() }))
vi.mock('@/runtime/map-runtime-host', () => ({ getMapRuntime: probe.runtime }))
vi.mock('@/platform/command-status', () => ({ emitCommandStatus: probe.status }))
registerMapProjections()

let view: View
beforeEach(() => {
  const project = createProject('Projection'), content = requireMapContent(project)
  content.datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  content.layers = [{ id: 'layer', datasetId: 'data', name: 'Layer', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
  projectSession.loadSnapshot({ project, featuresByDataset: { data: [{ id: 'row', properties: {}, geometry: { type: 'Point', coordinates: [116.4, 39.9] } }] } })
  view = new View({ center: transform([116.4, 39.9], 'EPSG:4490', 'EPSG:3857'), zoom: 10, rotation: .3 })
  probe.runtime.mockReturnValue({ getMap: () => ({ getView: () => view }) }); probe.status.mockClear()
})

describe('Application map projection configuration', () => {
  it('preserves the geographic center with one configuration undo and no feature reads or replacement', () => {
    const before = useProjectStore.getState(), rows = featureData.readSnapshot(), revision = featureData.revision
    const read = vi.spyOn(featureData, 'readSnapshot').mockImplementation(() => { throw new Error('feature read forbidden') })
    const snapshot = vi.spyOn(featureData, 'snapshot').mockImplementation(() => { throw new Error('feature snapshot forbidden') })
    try {
      viewCommands.setMapProjection('EPSG:4326')
      const map = requireMapContent(useProjectStore.getState().project)
      expect(map.crs).toBe('EPSG:4326')
      expect(map.initialView.center[0]).toBeCloseTo(116.4, 6); expect(map.initialView.center[1]).toBeCloseTo(39.9, 6)
      expect(map.initialView.rotation).toBe(.3)
      expect(projectEdits.undo()).toBe(true)
      expect(requireMapContent(useProjectStore.getState().project).crs).toBe(requireMapContent(before.project).crs)
      expect(projectEdits.canUndo()).toBe(false); expect(projectEdits.redo()).toBe(true)
      expect(read).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled()
    } finally { read.mockRestore(); snapshot.mockRestore() }
    expect(featureData.readSnapshot()).toBe(rows); expect(featureData.revision).toBe(revision)
  })

  it('rejects unsupported projections and active editing without changing the document, history or navigation', () => {
    const state = useProjectStore.getState(), history = projectEdits.getState(), center = view.getCenter(), zoom = view.getZoom()
    const cancel = vi.spyOn(view, 'cancelAnimations')
    viewCommands.setMapProjection('EPSG:unknown')
    expect(probe.status).toHaveBeenCalledWith('不支持此地图投影')
    useWorkbenchStore.getState().setEditLayer('layer')
    viewCommands.setMapProjection('EPSG:4326')
    expect(probe.status).toHaveBeenLastCalledWith('请先结束图层编辑再切换投影')
    expect(useProjectStore.getState()).toBe(state); expect(projectEdits.getState()).toBe(history)
    expect(view.getCenter()).toEqual(center); expect(view.getZoom()).toBe(zoom); expect(cancel).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLayerStyle, createProject, readManagedDatasetFile, requireMapContent, type ProjectSnapshot } from '@desktop-webgis/project'
import { featureCommands } from '@/commands/feature.commands'
import { useProjectStore } from '@/session/project.store'
import { projectSession } from './project-session'
import { featureData } from '@/data/feature-data'
import { projectEdits } from './project-edits'
import { requestDatasetSave } from './unsaved-work'
import { pickSaveFile } from '@/platform/files'

const io = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), write: vi.fn(), pick: vi.fn(), status: vi.fn(), disk: new Map<string, string>(), native: true }))
vi.mock('@/platform/files', () => ({ pickSaveFile: io.pick, createTextFile: io.create, readTextFile: io.read, writeTextFile: io.write }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => io.native }))
vi.mock('@/platform/command-status', () => ({ emitCommandStatus: io.status }))

const path = 'D:/project/data/managed.geojson'
function fixture(): ProjectSnapshot {
  const project = createProject('Save'), content = requireMapContent(project)
  content.datasets = [{ id: 'data', name: 'Data', kind: 'vector', fields: [{ name: 'value', type: 'number', nullable: false }], source: { type: 'memory', label: 'Data' } }]
  content.layers = [{ id: 'layer', datasetId: 'data', name: 'Data', visible: true, editable: true, opacity: 1, style: createDefaultLayerStyle('point') }]
  return { project, featuresByDataset: { data: [{ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }] } }
}

beforeEach(() => {
  io.disk.clear(); io.native = true
  io.create.mockReset(); io.read.mockReset(); io.write.mockReset(); io.pick.mockReset(); io.status.mockReset()
  io.create.mockImplementation(async (name: string, content: string) => { if (io.disk.has(name)) throw new Error('already exists'); io.disk.set(name, content) })
  io.read.mockImplementation(async (name: string) => { if (!io.disk.has(name)) throw new Error('file missing'); return io.disk.get(name)! })
  io.write.mockImplementation(async (name: string, content: string) => { io.disk.set(name, content) })
  io.pick.mockResolvedValue(path)
  projectSession.loadSnapshot(fixture())
})

describe('requestDatasetSave', () => {
  it('creates a managed file for an unbound source then commits pending rows', async () => {
    featureCommands.updateProperties('layer', 'row', { value: 9 })
    expect(await requestDatasetSave('data')).toBe(true)
    expect(pickSaveFile).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'Data.geojson' }))
    expect(featureData.pendingCount()).toBe(0)
    expect(readManagedDatasetFile(io.disk.get(path)!).features[0].properties.value).toBe(9)
    expect(requireMapContent(useProjectStore.getState().project).datasets[0]).toMatchObject({
      storage: { type: 'managed-geojson', reference: { kind: 'absolute', path } }
    })
    expect(projectEdits.canUndo()).toBe(true)
  })

  it('does not create a file when the save picker is cancelled', async () => {
    featureCommands.updateProperties('layer', 'row', { value: 9 })
    io.pick.mockResolvedValue(null)
    expect(await requestDatasetSave('data')).toBe(false)
    expect(featureData.pendingCount()).toBe(1)
    expect(io.disk.size).toBe(0)
  })

  it('refuses browser sidecar writes without dropping pending', async () => {
    io.native = false
    featureCommands.updateProperties('layer', 'row', { value: 9 })
    expect(await requestDatasetSave('data')).toBe(false)
    expect(io.status).toHaveBeenCalledWith(expect.stringContaining('浏览器不能写入'))
    expect(featureData.pendingCount()).toBe(1)
    expect(io.pick).not.toHaveBeenCalled()
  })
})

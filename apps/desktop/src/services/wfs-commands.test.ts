import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createProject } from '@desktop-webgis/gis-core'
import { parseCapabilitiesXml, resolveWfsLoadOptions } from '@desktop-webgis/ogc-io'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { createProjectSceneController } from '@/features/scene/project-scene-controller'
import { startWfsBoundedLoad, type StartWfsLoadInput } from './wfs-commands'
import { loadWfsBoundedSnapshot, type WfsLoadResult } from './wfs-load'

vi.mock('./wfs-load', () => ({ loadWfsBoundedSnapshot: vi.fn() }))
vi.mock('@/app/commands/status', () => ({ emitCommandStatus: vi.fn() }))
beforeEach(() => {
  vi.mocked(loadWfsBoundedSnapshot).mockReset()
  useProjectStore.getState().loadSnapshot({ project: createProject('WFS'), featuresByDataset: {} })
})
afterEach(() => useSessionStore.getState().abortAllWfsLoads())

function setup(): { input: StartWfsLoadInput; result: WfsLoadResult } {
  const description = parseCapabilitiesXml(readFileSync(new URL('../../../../packages/ogc-io/fixtures/wfs-2.0.0-capabilities.xml', import.meta.url), 'utf8'), {
    shareableUrl: 'https://example.com/geoserver/wfs', hint: 'WFS'
  })
  const added = useProjectStore.getState().addServiceLayer({ name: 'Parks', kind: 'wfs', source: {
    type: 'wfs', url: 'https://example.com/geoserver/wfs', version: '2.0.0', typeName: 'playground:parks', authMode: 'none', maxFeatures: 100, extentMode: 'view'
  } })!
  const input: StartWfsLoadInput = { ...added, description, authMode: 'none', selection: {
    typeName: 'playground:parks', maxFeatures: 100, extentMode: 'view', viewExtentWgs84: [116.3, 39.8, 116.5, 40]
  } }
  const resolved = resolveWfsLoadOptions(description, input.selection)
  if (!resolved.ok) throw new Error(resolved.reason)
  return { input, result: { ok: true, loadToken: 'late', features: [{ id: 'late', geometry: { type: 'Point', coordinates: [116.4, 39.9] }, properties: {} }],
    resolved: resolved.options, loadedCount: 1, complete: true, truncatedByLimit: false, duplicateIdCount: 0, paginationUsed: false, warnings: [], lastLoadedAt: '2026-10-09T00:00:00Z' } }
}

describe('WFS request identity during content edits', () => {
  it('rejects late success after a same-ID resource API edit cancels the old load', async () => {
    const s = setup()
    let complete!: (result: WfsLoadResult) => void
    vi.mocked(loadWfsBoundedSnapshot).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const pending = startWfsBoundedLoad(s.input), abort = useSessionStore.getState().wfsAbortByLayer[s.input.layerId]
    const controller = createProjectSceneController(), resource = controller.getDocument().resources[s.input.datasetId]
    if (resource.type !== 'wfs') throw new Error('Expected WFS')
    controller.replaceResource(s.input.datasetId, { ...resource, url: 'https://example.com/new/wfs' })
    expect(abort.signal.aborted).toBe(true)
    complete(s.result); await pending
    expect(useProjectStore.getState().featuresByDataset[s.input.datasetId]).toEqual([])
    expect(useSessionStore.getState().sessions[s.input.layerId]?.loading).not.toBe(true)
    controller.dispose()
  })
  it('leaves a newer request registered and loading when an obsolete request finishes', async () => {
    const s = setup(), completions: Array<(result: WfsLoadResult) => void> = []
    vi.mocked(loadWfsBoundedSnapshot).mockImplementation(() => new Promise(resolve => { completions.push(resolve) }))
    const obsolete = startWfsBoundedLoad(s.input)
    const newer = startWfsBoundedLoad(s.input), active = useSessionStore.getState().wfsAbortByLayer[s.input.layerId]
    completions[0](s.result); await obsolete
    expect(useSessionStore.getState().wfsAbortByLayer[s.input.layerId]).toBe(active)
    expect(useSessionStore.getState().sessions[s.input.layerId]?.loading).toBe(true)
    expect(useProjectStore.getState().featuresByDataset[s.input.datasetId] ?? []).toEqual([])
    completions[1](s.result); await newer
    expect(useProjectStore.getState().featuresByDataset[s.input.datasetId][0].id).toBe('late')
    expect(useSessionStore.getState().wfsAbortByLayer[s.input.layerId]).toBeUndefined()
  })
})

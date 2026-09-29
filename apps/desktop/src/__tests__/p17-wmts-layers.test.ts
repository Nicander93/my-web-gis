import { beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  capabilitiesForDataset
} from '@desktop-webgis/gis-core'
import {
  listSelectableLayers,
  parseCapabilitiesXml,
  resolveWmtsLayerOptions
} from '@desktop-webgis/ogc-io'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { getLayerCapabilities, layerCommands } from '@/app/commands/layer.commands'
import { _resetCredentialsForTests } from '@/services/credentials'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/ogc-io/fixtures'
)

function resetStores(): void {
  useProjectStore.getState()._resetAttributeHistoryForTests()
  layerCommands._resetStyleHistoryForTests()
  useSessionStore.setState({ sessions: {} })
  _resetCredentialsForTests()
  useProjectStore.setState({
    project: createProject('P17 test'),
    featuresByDataset: {},
    dirty: false,
    selectedLayerId: null,
    selection: { layerId: null, featureIds: [] },
    lastSelectionCountAfterFilter: null
  })
}

describe('P17 WMTS layers', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: { dispatchEvent: (event?: unknown) => boolean } }).window = {
      dispatchEvent: () => true
    }
    resetStores()
  })

  it('adds WMTS layer with matrix persistence and reopens', () => {
    const xml = readFileSync(join(fixturesDir, 'wmts-1.0.0-capabilities.xml'), 'utf8')
    const desc = parseCapabilitiesXml(xml, {
      shareableUrl: 'https://example.com/wmts',
      hint: 'WMTS'
    })
    const ortho = listSelectableLayers(desc).find((l) => l.name === 'ortho')!
    const resolved = resolveWmtsLayerOptions(desc, {
      layer: ortho.name,
      tileMatrixSet: 'CustomNonNumeric512',
      style: 'outline',
      format: 'image/png'
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    const added = useProjectStore.getState().addServiceLayer({
      name: ortho.title || ortho.name,
      kind: 'wmts',
      source: {
        type: 'wmts',
        url: resolved.options.urls[0]!,
        version: desc.version,
        layer: resolved.options.layer,
        style: resolved.options.style,
        format: resolved.options.format,
        tileMatrixSet: resolved.options.tileMatrixSet,
        requestEncoding: resolved.options.requestEncoding,
        urls: resolved.options.urls,
        projection: resolved.options.projection,
        supportedCrs: resolved.options.supportedCrs,
        bboxWgs84: resolved.options.bboxWgs84,
        tileMatrices: resolved.options.tileMatrices,
        authMode: 'none'
      }
    })!
    expect(added).toBeTruthy()

    const layer = useProjectStore.getState().project.layers.find((l) => l.id === added.layerId)!
    expect(layer.editable).toBe(false)
    useProjectStore.getState().setLayerOpacity(added.layerId, 0.55)

    const snap = {
      project: useProjectStore.getState().project,
      featuresByDataset: useProjectStore.getState().featuresByDataset
    }
    const restored = parseProjectSnapshot(serializeProjectSnapshot(snap))
    const ds = restored.project.datasets.find((d) => d.kind === 'wmts')
    expect(ds?.kind).toBe('wmts')
    if (ds?.kind === 'wmts') {
      expect(ds.source.tileMatrixSet).toBe('CustomNonNumeric512')
      expect(ds.source.requestEncoding).toBe('KVP')
      expect(ds.source.tileMatrices[0]?.identifier).toBe('EPSG:3857:0')
      expect(ds.source.tileMatrices[0]?.tileWidth).toBe(512)
      expect(ds.source.bboxWgs84?.[0]).toBe(-180)
      expect(JSON.stringify(ds.source)).not.toMatch(/token|secret|bearer/i)
    }
    expect(restored.project.layers[0]?.opacity).toBe(0.55)
  })

  it('does not expose attribute table / style for WMTS', () => {
    const xml = readFileSync(join(fixturesDir, 'wmts-1.0.0-rest-capabilities.xml'), 'utf8')
    const desc = parseCapabilitiesXml(xml, {
      shareableUrl: 'https://tiles.example.com/wmts',
      hint: 'WMTS'
    })
    const resolved = resolveWmtsLayerOptions(desc, { layer: 'coast' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    const added = useProjectStore.getState().addServiceLayer({
      name: 'Coast',
      kind: 'wmts',
      source: {
        type: 'wmts',
        url: resolved.options.urls[0]!,
        version: '1.0.0',
        layer: 'coast',
        style: 'default',
        format: 'image/png',
        tileMatrixSet: resolved.options.tileMatrixSet,
        requestEncoding: 'REST',
        urls: resolved.options.urls,
        projection: resolved.options.projection,
        tileMatrices: resolved.options.tileMatrices,
        authMode: 'none'
      }
    })!
    const caps = getLayerCapabilities(added.layerId)
    expect(caps.canAttributeTable).toBe(false)
    expect(caps.canStyle).toBe(false)
    expect(caps.canRetry).toBe(true)
    const dataset = useProjectStore
      .getState()
      .project.datasets.find((d) => d.id === added.datasetId)
    expect(capabilitiesForDataset(dataset).queryAttributes).toBe(false)
  })

  it('rejects incompatible matrix selection without falling back', () => {
    const xml = readFileSync(join(fixturesDir, 'wmts-1.0.0-capabilities.xml'), 'utf8')
    const desc = parseCapabilitiesXml(xml, {
      shareableUrl: 'https://example.com/wmts',
      hint: 'WMTS'
    })
    const bad = resolveWmtsLayerOptions(desc, {
      layer: 'ortho',
      tileMatrixSet: 'MissingSet'
    })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.reason).toMatch(/不会改用其他矩阵|未链接/)
  })
})

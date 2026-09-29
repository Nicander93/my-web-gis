import { describe, expect, it } from 'vitest'
import {
  createDefaultLayerStyle,
  createProject,
  type ProjectSnapshot
} from '@desktop-webgis/gis-core'
import { compileProjectToScene, CompileProjectError } from './compile-project.js'

function mixedSnapshot(): ProjectSnapshot {
  const project = createProject('Mixed')
  project.datasets.push(
    {
      id: 'ds-vec',
      name: 'Cities',
      kind: 'vector',
      source: { type: 'memory', label: 'Cities' }
    },
    {
      id: 'ds-wms',
      name: 'Rain',
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms',
        version: '1.3.0',
        layerNames: ['rain'],
        authMode: 'none',
        crs: 'EPSG:3857',
        bboxWgs84: [100, 20, 120, 40]
      }
    },
    {
      id: 'ds-wfs',
      name: 'Parcels',
      kind: 'wfs',
      source: {
        type: 'wfs',
        url: 'https://example.com/wfs',
        version: '2.0.0',
        typeName: 'demo:parcels',
        authMode: 'bearer',
        credentialRef: { key: 'secret-ref' },
        loadedCount: 2,
        complete: true
      }
    }
  )
  project.layers.push(
    {
      id: 'l-vec',
      datasetId: 'ds-vec',
      name: 'Cities',
      visible: true,
      opacity: 1,
      editable: true,
      style: createDefaultLayerStyle('point'),
      filter: [{ field: 'name', op: 'eq', value: 'A' }]
    },
    {
      id: 'l-wms',
      datasetId: 'ds-wms',
      name: 'Rain',
      visible: true,
      opacity: 0.5,
      editable: false,
      style: createDefaultLayerStyle('polygon'),
      filter: []
    },
    {
      id: 'l-wfs',
      datasetId: 'ds-wfs',
      name: 'Parcels',
      visible: true,
      opacity: 1,
      editable: false,
      style: createDefaultLayerStyle('polygon'),
      filter: []
    }
  )
  project.groups = [
    { id: 'g1', name: 'Vectors', visible: true, layerIds: ['l-vec', 'l-wfs'] }
  ]
  project.rootOrder = [
    { type: 'group', id: 'g1' },
    { type: 'layer', id: 'l-wms' }
  ]

  return {
    project,
    featuresByDataset: {
      'ds-vec': [
        {
          id: 'f1',
          geometry: { type: 'Point', coordinates: [1, 2] },
          properties: { name: 'A' },
          metadata: { sourceCrs: 'EPSG:4547' }
        },
        {
          id: 'f2',
          geometry: { type: 'Point', coordinates: [3, 4] },
          properties: { name: 'B' }
        }
      ],
      'ds-wfs': [
        {
          id: 'p1',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          properties: { id: 1 }
        },
        {
          id: 'p2',
          geometry: { type: 'Polygon', coordinates: [[[2, 2], [3, 2], [3, 3], [2, 2]]] },
          properties: { id: 2 }
        }
      ]
    }
  }
}

describe('compileProjectToScene (P19)', () => {
  it('compiles mixed project with filter, WMS, WFS snapshot, groups metadata', () => {
    const { scene, notes } = compileProjectToScene(mixedSnapshot())
    expect(scene.version).toBe(2)
    expect(scene.layers).toHaveLength(3)
    // bottom → top: wms, then group children wfs then vec? flatten top-first: g1(vec,wfs), wms → reverse: wms, wfs, vec? 
    // flatten: g1 children in order l-vec, l-wfs, then l-wms → [l-vec, l-wfs, l-wms]
    // reverse for scene bottom-up: [l-wms, l-wfs, l-vec]
    expect(scene.layers.map((l) => l.id)).toEqual(['l-wms', 'l-wfs', 'l-vec'])

    const wmsSource = scene.sources['src-ds-wms']
    expect(wmsSource?.type).toBe('wms')
    if (wmsSource?.type === 'wms') {
      expect(wmsSource.layerNames).toEqual(['rain'])
      expect(wmsSource.authMode).toBe('none')
    }

    const wfsSource = scene.sources['src-ds-wfs']
    expect(wfsSource?.type).toBe('geojson')
    if (wfsSource?.type === 'geojson' && wfsSource.data) {
      expect(wfsSource.data.features).toHaveLength(2)
    }

    const vecSource = scene.sources['src-ds-vec']
    expect(vecSource?.type).toBe('geojson')
    if (vecSource?.type === 'geojson' && vecSource.data) {
      // filter name=A → only f1
      expect(vecSource.data.features).toHaveLength(1)
      expect(vecSource.data.features[0]?.id).toBe('f1')
    }

    const meta = scene.metadata as Record<string, unknown>
    expect(meta.layerGroups).toEqual([
      { id: 'g1', name: 'Vectors', visible: true, layerIds: ['l-vec', 'l-wfs'] }
    ])
    const layerMeta = meta.layerMeta as Record<string, Record<string, unknown>>
    expect(layerMeta['l-wfs']?.wfsSnapshot).toBe(true)
    expect(layerMeta['l-vec']?.sourceCrs).toBe('EPSG:4547')
    expect(layerMeta['l-vec']?.vectorFilter).toEqual([{ field: 'name', op: 'eq', value: 'A' }])

    const json = JSON.stringify(scene)
    expect(json).not.toContain('secret-ref')
    expect(json).not.toContain('credentialRef')
    expect(notes.some((n) => n.includes('WFS 快照'))).toBe(true)
  })

  it('blocks tianditu basemap with embedded credential instead of silent omit', () => {
    const snap = mixedSnapshot()
    snap.project.basemap = {
      type: 'tianditu',
      mapType: 'vector',
      credential: 'REAL_TOKEN'
    }
    expect(() => compileProjectToScene(snap)).toThrow(CompileProjectError)
    try {
      compileProjectToScene(snap)
    } catch (error) {
      expect(error).toBeInstanceOf(CompileProjectError)
      expect((error as CompileProjectError).blockers[0]).toContain('tianditu')
      expect((error as CompileProjectError).blockers[0]).not.toContain('REAL_TOKEN')
    }
  })
})

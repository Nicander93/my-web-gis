import { describe, expect, it } from 'vitest'
import {
  capabilitiesForDataset,
  capabilitiesForKind,
  isServiceDatasetKind,
  isTileServiceKind
} from './capabilities'
import type { Dataset } from './types'

describe('layer capability flags', () => {
  it('vector snapshot can edit/export/style', () => {
    const caps = capabilitiesForKind('vector')
    expect(caps.editGeometry).toBe(true)
    expect(caps.exportVector).toBe(true)
    expect(caps.style).toBe(true)
    expect(caps.queryAttributes).toBe(true)
  })

  it('WMS/WMTS cannot enter geom edit or vector export', () => {
    for (const kind of ['wms', 'wmts'] as const) {
      const caps = capabilitiesForKind(kind)
      expect(caps.editGeometry).toBe(false)
      expect(caps.exportVector).toBe(false)
      expect(caps.copyToLocal).toBe(false)
      expect(caps.queryAttributes).toBe(false)
      expect(isTileServiceKind(kind)).toBe(true)
      expect(isServiceDatasetKind(kind)).toBe(true)
    }
  })

  it('WFS service is not geom-editable', () => {
    const caps = capabilitiesForKind('wfs')
    expect(caps.editGeometry).toBe(false)
    expect(caps.exportVector).toBe(true)
    expect(isServiceDatasetKind('wfs')).toBe(true)
  })

  it('capabilitiesForDataset reads kind', () => {
    const ds: Dataset = {
      id: 'd1',
      name: 'svc',
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms',
        version: '1.3.0',
        layerNames: ['L1'],
        authMode: 'none'
      }
    }
    expect(capabilitiesForDataset(ds).editGeometry).toBe(false)
  })
})
import { describe, expect, it } from 'vitest'
import {
  createProject,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  serializeProject,
  parseProject
} from './project'
import type { Project } from './types'

describe('project service datasets (P15)', () => {
  it('round-trips WMS dataset without secrets', () => {
    const project = createProject('svc')
    project.datasets.push({
      id: 'ds-wms',
      name: 'Cities',
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms?map=/x',
        version: '1.3.0',
        layerNames: ['cities'],
        authMode: 'bearer',
        credentialRef: { key: 'svc-ref-1' }
      }
    })
    project.layers.push({
      id: 'layer-wms',
      datasetId: 'ds-wms',
      name: 'Cities',
      visible: true,
      opacity: 1,
      editable: false,
      style: { kind: 'mixed', stroke: '#000', fill: '#fff', width: 1, pointRadius: 4 } as never,
      filter: []
    })
    project.rootOrder = [{ type: 'layer', id: 'layer-wms' }]

    const json = serializeProject(project)
    expect(json).not.toContain('SECRET')
    expect(json).not.toMatch(/password\s*[:=]/i)
    expect(json).toContain('"authMode": "bearer"')
    expect(json).toContain('svc-ref-1')

    const parsed = parseProject(json)
    expect(parsed.datasets[0]?.kind).toBe('wms')
    expect(parsed.layers[0]?.editable).toBe(false)
  })

  it('legacy vector-only JSON still parses', () => {
    const legacy: Project = {
      ...createProject('legacy'),
      datasets: [
        {
          id: 'd1',
          name: 'pts',
          kind: 'vector',
          source: { type: 'memory', label: 'pts' }
        }
      ],
      layers: [
        {
          id: 'l1',
          datasetId: 'd1',
          name: 'pts',
          visible: true,
          opacity: 1,
          editable: false,
          style: {
            mode: 'single',
            symbol: { type: 'circle', radius: 4, fill: { r: 0, g: 0, b: 0, a: 1 } }
          },
          filter: []
        }
      ],
      rootOrder: [{ type: 'layer', id: 'l1' }]
    }
    const snap = parseProjectSnapshot(serializeProjectSnapshot({ project: legacy, featuresByDataset: {} }))
    expect(snap.project.datasets[0]?.kind).toBe('vector')
  })
})
import { describe, it, expect } from 'vitest'
import {
  createDefaultLayerStyle,
  migrateLegacyStyle,
  isLegacyStyle,
  parseProjectSnapshot
} from './project'
import type { LegacyLayerStyle } from './types'

describe('样式迁移', () => {
  it('应该识别旧样式', () => {
    const legacy: LegacyLayerStyle = {
      kind: 'point',
      stroke: '#000000',
      fill: '#ff0000',
      width: 1.5,
      pointRadius: 5
    }

    expect(isLegacyStyle(legacy)).toBe(true)
  })

  it('应该识别新样式', () => {
    const newStyle = createDefaultLayerStyle('point')
    expect(isLegacyStyle(newStyle)).toBe(false)
    expect(newStyle.mode).toBe('single')
  })

  it('应该迁移点样式', () => {
    const legacy: LegacyLayerStyle = {
      kind: 'point',
      stroke: '#4f6f58',
      fill: '#dbe8da',
      width: 1.5,
      pointRadius: 5
    }

    const migrated = migrateLegacyStyle(legacy)
    expect(migrated.mode).toBe('single')
    expect(migrated.symbol.type).toBe('circle')
    if (migrated.symbol.type === 'circle') {
      expect(migrated.symbol.radius).toBe(5)
    }
  })

  it('应该迁移线样式', () => {
    const legacy: LegacyLayerStyle = {
      kind: 'line',
      stroke: '#5c7185',
      fill: '#5c718522',
      width: 2,
      pointRadius: 4
    }

    const migrated = migrateLegacyStyle(legacy)
    expect(migrated.mode).toBe('single')
    expect(migrated.symbol.type).toBe('solid')
    if (migrated.symbol.type === 'solid' && 'width' in migrated.symbol) {
      expect(migrated.symbol.width).toBe(2)
    }
  })

  it('应该迁移面样式', () => {
    const legacy: LegacyLayerStyle = {
      kind: 'polygon',
      stroke: '#76604f',
      fill: '#76604f24',
      width: 1.5,
      pointRadius: 4
    }

    const migrated = migrateLegacyStyle(legacy)
    expect(migrated.mode).toBe('single')
    expect(migrated.symbol.type).toBe('solid')
  })

  it('应该迁移混合几何样式', () => {
    const legacy: LegacyLayerStyle = {
      kind: 'mixed',
      stroke: '#586b5d',
      fill: '#586b5d20',
      width: 1.5,
      pointRadius: 4
    }

    const migrated = migrateLegacyStyle(legacy)
    expect(migrated.mode).toBe('single')
    expect(migrated.symbol.type).toBe('mixed')
    if (migrated.symbol.type === 'mixed') {
      expect(migrated.symbol.point).toBeDefined()
      expect(migrated.symbol.line).toBeDefined()
      expect(migrated.symbol.polygon).toBeDefined()
    }
  })

  it('应该在解析项目时自动迁移旧样式', () => {
    const oldProject = {
      id: 'test-project',
      version: 1,
      name: 'Test Project',
      crs: 'EPSG:3857',
      datasets: [],
      layers: [
        {
          id: 'layer-1',
          datasetId: 'dataset-1',
          name: 'Test Layer',
          visible: true,
          opacity: 1,
          editable: false,
          style: {
            kind: 'point',
            stroke: '#000000',
            fill: '#ff0000',
            width: 1.5,
            pointRadius: 5
          }
        }
      ],
      mapState: {
        center: [0, 0],
        zoom: 2,
        rotation: 0
      },
      basemap: { type: 'osm' },
      settings: {}
    }

    const snapshot = parseProjectSnapshot(JSON.stringify(oldProject))
    const layer = snapshot.project.layers[0]
    expect(isLegacyStyle(layer.style)).toBe(false)
    if (!isLegacyStyle(layer.style)) {
      expect(layer.style.mode).toBe('single')
    }
  })

  it('应该正确解析 CSS 颜色', () => {
    const legacy: LegacyLayerStyle = {
      kind: 'point',
      stroke: '#ff0000',
      fill: 'rgba(255, 0, 0, 0.5)',
      width: 1,
      pointRadius: 5
    }

    const migrated = migrateLegacyStyle(legacy)
    expect(migrated.mode).toBe('single')
    if (migrated.symbol.type === 'circle') {
      expect(migrated.symbol.fill).toBeDefined()
      if (migrated.symbol.fill) {
        expect(migrated.symbol.fill.a).toBeCloseTo(0.5)
      }
    }
  })
})

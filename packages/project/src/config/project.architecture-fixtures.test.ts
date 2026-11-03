import { requireMapContent } from './project-content'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertNoSecretValues, parseProjectSnapshot, serializeProjectSnapshot } from '../index'

describe('architecture migration fixtures', () => {
  it.each(['map', 'scene'])('retains legacy %s data through migration and a second open', kind => {
    const text = readFileSync(new URL(`../../test-fixtures/legacy-${kind}-v1.webgis.json`, import.meta.url), 'utf8')
    const original = JSON.parse(text)
    const migrated = parseProjectSnapshot(text)
    const reopened = parseProjectSnapshot(serializeProjectSnapshot(migrated))
    expect(reopened).toEqual(migrated)
    expect(reopened.featuresByDataset).toEqual(original.featuresByDataset)
    expect(reopened.project.content.scene).toEqual(original.project.city)
    expect(reopened.project.content.display).toEqual(original.project.sceneDisplay)
    if (kind === 'map') {
      expect(requireMapContent(reopened.project).datasets).toEqual(original.project.datasets)
      expect(requireMapContent(reopened.project).groups).toEqual(original.project.groups)
      expect(requireMapContent(reopened.project).rootOrder).toEqual(original.project.rootOrder)
      expect(requireMapContent(reopened.project).initialView).toEqual(original.project.mapState)
      expect(requireMapContent(reopened.project).layers[0].filter).toEqual(original.project.layers[0].filter)
      expect(requireMapContent(reopened.project).cartography?.styleLayers.length).toBeGreaterThan(0)
    }
    expect(() => assertNoSecretValues(reopened)).not.toThrow()
    expect(readFileSync(new URL(`../../test-fixtures/legacy-${kind}-v1.webgis.json`, import.meta.url), 'utf8')).toBe(text)
  })
})

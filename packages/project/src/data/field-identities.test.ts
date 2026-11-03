import { describe, expect, it, vi } from 'vitest'
import { FeatureEditBuffer, MemoryFeatureProvider } from './feature-provider'
import type { DatasetField, GisFeature } from './types'

const fields: DatasetField[] = [{ name: 'value', type: 'number', nullable: true }]
const row: GisFeature = { id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }

describe('column identity transaction and publication', () => {
  it('rolls back failed command frames before a retry can enter history', () => {
    const buffer = new FeatureEditBuffer(new MemoryFeatureProvider('data', [row], undefined, fields))
    const key = {}, original = buffer.getLoadedFieldIdentities().get('value')
    expect(() => buffer.transaction(() => {
      buffer.setLoadedFields([{ ...fields[0], name: 'renamed' }], { key, forward: true, before: 'value', after: 'renamed' })
      buffer.finishSchemaIdentity({ key, forward: true })
      throw new Error('abort')
    })).toThrow('abort')
    expect(buffer.getLoadedFieldIdentities().get('value')).toBe(original)
    expect(buffer.pendingCount).toBe(0)
    expect(() => buffer.setLoadedFields(fields, { key, forward: false })).toThrow('has not been executed')
    buffer.setLoadedFields([{ ...fields[0], name: 'retry' }], { key, forward: true, before: 'value', after: 'retry' })
    expect(buffer.getLoadedFieldIdentities().get('retry')).toBe(original)
    expect(buffer.getLoadedFieldIdentities().has('renamed')).toBe(false)
  })

  it('keeps same-name replacement pending and publishes its new identity only after acknowledgement', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue(undefined)
    const provider = new MemoryFeatureProvider('data', [row], persist, fields), buffer = new FeatureEditBuffer(provider)
    const original = provider.getLoadedFieldIdentities().get('value')
    buffer.setLoadedFields([], { key: {}, forward: true, before: 'value' })
    buffer.setLoadedFields(fields, { key: {}, forward: true, after: 'value' })
    const replacement = buffer.getLoadedFieldIdentities().get('value')
    expect(replacement).not.toBe(original)
    expect(buffer.pendingCount).toBe(1)
    await expect(buffer.save()).rejects.toThrow('disk unavailable')
    expect(provider.getLoadedFieldIdentities().get('value')).toBe(original)
    expect(buffer.getLoadedFieldIdentities().get('value')).toBe(replacement)
    expect(buffer.pendingCount).toBe(1)
    await buffer.save()
    expect(provider.getLoadedFieldIdentities().get('value')).toBe(replacement)
    expect(buffer.pendingCount).toBe(0)
    expect(provider.getLoadedRows()).toEqual([row])
    expect(await provider.getFields()).toEqual(fields)
  })
})

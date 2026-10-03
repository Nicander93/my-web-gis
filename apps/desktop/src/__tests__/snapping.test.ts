import { describe, expect, it } from 'vitest'
import { useSnappingStore } from '@/stores/snapping.store'
import { useProjectStore } from '@/stores/project.store'

describe('snapping preferences', () => {
  it('validates tolerance and disables empty modes without changing project data', () => {
    const before = useProjectStore.getState().getSnapshot()
    const dirty = useProjectStore.getState().dirty
    const state = useSnappingStore.getState()
    state.update({ enabled: true, vertex: true, edge: true, pixelTolerance: 100 })
    expect(useSnappingStore.getState().options.pixelTolerance).toBe(30)
    state.update({ pixelTolerance: Number.NaN })
    expect(useSnappingStore.getState().options.pixelTolerance).toBe(30)
    state.update({ vertex: false, edge: false })
    expect(useSnappingStore.getState().options.enabled).toBe(false)
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().dirty).toBe(dirty)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { isWebGLAvailable } from './webgl-layer.js'

afterEach(() => vi.unstubAllGlobals())
describe('GPU capability gate', () => {
  it('rejects missing instancing even if a context can be created and releases the probe', () => {
    const loseContext = vi.fn()
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ getExtension: (name: string) => name === 'WEBGL_lose_context' ? { loseContext } : name === 'OES_element_index_uint' ? {} : null }) }) })
    expect(isWebGLAvailable()).toBe(false)
    expect(loseContext).toHaveBeenCalledOnce()
  })
  it('falls back when context creation is denied', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => { throw new Error('blocked') } }) })
    expect(isWebGLAvailable()).toBe(false)
  })
})

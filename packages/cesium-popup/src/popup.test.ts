import { afterEach, describe, expect, it, vi } from 'vitest'
import { Cartesian3 } from 'cesium'
import type { Viewer } from 'cesium'
import { Popup } from './index'

vi.mock('cesium', async original => ({ ...await original<typeof import('cesium')>(), SceneTransforms: { worldToWindowCoordinates: () => ({ x: 30, y: 40 }) } }))
// Minimal DOM harness: innerHTML is deliberately unavailable to catch HTML injection.
class Element {
  style: Record<string, unknown> = {}
  children: Element[] = []
  textContent = ''
  removed = false
  setAttribute(): void {}
  addEventListener(): void {}
  append(...elements: Element[]): void { this.children.push(...elements) }
  replaceChildren(): void { this.children = []; this.textContent = '' }
  remove(): void { this.removed = true }
}
afterEach(() => vi.unstubAllGlobals())
function setup() {
  vi.stubGlobal('HTMLElement', Element)
  vi.stubGlobal('document', { createElement: () => new Element() })
  const container = new Element(), remove = vi.fn()
  const viewer = { container, canvas: { clientWidth: 100, clientHeight: 100 }, camera: { positionWC: Cartesian3.ZERO, directionWC: Cartesian3.UNIT_X }, scene: { postRender: { addEventListener: () => remove }, requestRender: vi.fn() } } as unknown as Viewer
  const popup = new Popup(viewer), element = container.children[0]
  return { popup, element, body: element.children[1], remove, context: { position: new Cartesian3(1,0,0), properties: { name: '<img src=x onerror=alert(1)>' } } }
}
describe('popup content and asynchronous lifecycle', () => {
  it('treats field values as text and removes the DOM and render listener', async () => {
    const s = setup()
    await s.popup.open(s.context, { fields: [{ field: 'name' }] })
    expect(s.body.children[1].children[1].textContent).toBe(s.context.properties.name)
    expect(s.element.style.display).toBe('block')
    s.popup.destroy(); s.popup.destroy()
    expect(s.remove).toHaveBeenCalledOnce(); expect(s.element.removed).toBe(true)
  })
  it('does not reopen after closing an unresolved callback', async () => {
    const s = setup(); let resolve!: (text: string) => void
    const pending = s.popup.open(s.context, () => new Promise<string>(done => { resolve = done }))
    s.popup.close(); resolve('late'); await pending
    expect(s.element.style.display).toBe('none'); expect(s.body.textContent).toBe('')
  })
  it('discards stale content when another object is opened', async () => {
    const s = setup(); let resolve!: (text: string) => void
    const pending = s.popup.open(s.context, () => new Promise<string>(done => { resolve = done }))
    await s.popup.open(s.context, 'current'); resolve('old'); await pending
    expect(s.body.textContent).toBe('current'); s.popup.destroy()
  })
})

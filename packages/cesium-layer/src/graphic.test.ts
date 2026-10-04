import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Cartesian3, CustomDataSource, EntityCollection, JulianDate, ScreenSpaceEventType } from 'cesium'
import type { Viewer } from 'cesium'
import { DrawSession, Graphic, GraphicLayer } from './index'
import type { GraphicNode } from '@desktop-webgis/cesium-scene-schema'

const handlers = vi.hoisted(() => [] as Array<{ actions: Map<number, (event: unknown) => void>; destroy: ReturnType<typeof vi.fn> }>)
vi.mock('cesium', async original => ({ ...await original<typeof import('cesium')>(), ScreenSpaceEventHandler: class {
  actions = new Map<number, (event: unknown) => void>(); destroy = vi.fn()
  constructor() { handlers.push(this) }
  setInputAction(action: (event: unknown) => void, type: number): void { this.actions.set(type, action) }
} }))
beforeEach(() => { handlers.length = 0 })
afterEach(() => vi.unstubAllGlobals())
function graphic(): GraphicNode { return { id: 'p', name: 'Point', type: 'graphic', visible: true, geometry: { type: 'point', positions: [[116,39,0]], heightMode: 'ground' }, style: { color: '#336699', width: 3, pointSize: 10 }, properties: { name: 'Point' } } }
function viewer() {
  const keyTarget = new EventTarget(), sources: unknown[] = []
  const host = {
    canvas: { ownerDocument: { defaultView: keyTarget } }, isDestroyed: () => false,
    entities: new EntityCollection(), camera: { getPickRay: () => ({}), pickEllipsoid: () => undefined },
    scene: { requestRender: vi.fn(), globe: { pick: vi.fn(() => Cartesian3.fromDegrees(116,39,0)) } },
    dataSources: { add: vi.fn(async (source: unknown) => { sources.push(source); return source }), remove: vi.fn() }
  }
  return { host, value: host as unknown as Viewer, keyTarget, sources }
}
function click(): void { handlers.at(-1)?.actions.get(ScreenSpaceEventType.LEFT_CLICK)?.({ position: {} }) }

describe('draw session lifecycle', () => {
  it('removes the preview when Backspace removes the final vertex', async () => {
    vi.stubGlobal('Element', class {})
    const v = viewer(), session = new DrawSession(v.value, { type: 'polygon' })
    click(); expect(v.host.entities.values).toHaveLength(1)
    const key = new Event('keydown'); Object.defineProperty(key, 'key', { value: 'Backspace' })
    v.keyTarget.dispatchEvent(key)
    expect(session.count).toBe(0); expect(v.host.entities.values).toHaveLength(0)
    session.cancel(); await session.result
  })
  it('finishes one point, releases temporary entities and does not add persisted geometry', async () => {
    const v = viewer(), session = new DrawSession(v.value, { type: 'point', properties: { count: 1 } })
    click()
    const result = await session.result
    expect(result.status).toBe('completed')
    if (result.status === 'completed') expect(result.graphic.geometry.positions[0][0]).toBeCloseTo(116)
    expect(v.host.entities.values).toHaveLength(0)
    expect(handlers[0].destroy).toHaveBeenCalledOnce()
    session.destroy(); expect(handlers[0].destroy).toHaveBeenCalledOnce()
  })
  it('rejects premature finish and duplicate positions; a new gesture cancels the previous one', async () => {
    const v = viewer(), first = new DrawSession(v.value, { type: 'polygon' })
    click(); click(); expect(first.count).toBe(1); expect(first.finish()).toBe(false)
    expect(v.host.entities.values).toHaveLength(1)
    const second = new DrawSession(v.value, { type: 'polyline' })
    await expect(first.result).resolves.toEqual({ status: 'cancelled' })
    expect(v.host.entities.values).toHaveLength(0)
    v.keyTarget.dispatchEvent(new Event('blur'))
    await expect(second.result).resolves.toEqual({ status: 'cancelled' })
    expect(handlers.every(handler => handler.destroy.mock.calls.length === 1)).toBe(true)
  })
  it('validates options before creating handlers or cancelling the active gesture', async () => {
    const v = viewer(), active = new DrawSession(v.value, { type: 'polygon' })
    expect(() => new DrawSession(v.value, { type: 'point', style: { color: 'invalid' } })).toThrow('参数')
    expect(active.isActive).toBe(true); expect(handlers).toHaveLength(1)
    active.cancel(); await active.result
  })
})

describe('independent GraphicLayer', () => {
  it('owns one native data source, updates style without remount and cleans gestures on hiding/removal', async () => {
    const v = viewer(), layer = new GraphicLayer({ id: 'drawings', graphics: [graphic()] })
    await layer.mount(v.value)
    const item = layer.getGraphic('p')!
    item.setOptions({ name: 'Layer name', properties: { name: 'Attribute name' } })
    const source = v.sources[0] as CustomDataSource
    expect(source.entities.getById('p')?.properties?.getValue(JulianDate.now()).name).toBe('Attribute name')
    item.setOptions({ style: { ...item.toJSON().style, color: '#ff0000' } })
    expect(v.host.dataSources.add).toHaveBeenCalledOnce()
    expect(layer.toJSON()[0].style.color).toBe('#ff0000')
    const session = layer.startDraw({ type: 'polygon' }); click(); layer.show = false
    await expect(session.result).resolves.toEqual({ status: 'cancelled' })
    expect(v.host.entities.values).toHaveLength(0)
    layer.destroy(); layer.destroy(); expect(v.host.dataSources.remove).toHaveBeenCalledOnce()
  })
  it('detaches serialized values and validates changes atomically', () => {
    const layer = new GraphicLayer({ id: 'graphics' }), original = graphic(), item = layer.addGraphic(original)
    original.geometry.positions[0][0] = 0
    expect(item.toJSON().geometry.positions[0][0]).toBe(116)
    expect(() => layer.addGraphic(graphic())).toThrow('重复')
    expect(() => item.bindPopup({ fields: 'invalid' } as never)).toThrow()
    expect(item.toJSON().popup).toBeUndefined()
    const detached = new Graphic(item.toJSON()); detached.bindPopup({ fields: [{ field: 'name' }] })
    expect(detached.toJSON().popup?.fields[0].field).toBe('name')
    layer.removeGraphic('p'); expect(layer.toJSON()).toEqual([])
  })
})

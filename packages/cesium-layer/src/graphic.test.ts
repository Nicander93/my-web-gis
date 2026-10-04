import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Cartesian3, CustomDataSource, EntityCollection, JulianDate, ScreenSpaceEventType } from 'cesium'
import type { Viewer } from 'cesium'
import { DrawSession, EditSession, Graphic, GraphicLayer, resolveGraphicLabel } from './index'
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
    scene: { requestRender: vi.fn(), pick: vi.fn(), screenSpaceCameraController: { enableInputs: true }, globe: { pick: vi.fn(() => Cartesian3.fromDegrees(116,39,0)) } },
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

function polygon(): GraphicNode { return { ...graphic(), geometry: { type: 'polygon', heightMode: 'ground', positions: [[116,39,0],[116.01,39,0],[116.01,39.01,0],[116,39.01,0]] } } }
function action(type: number, event: unknown = {}): void { handlers.at(-1)?.actions.get(type)?.(event) }

describe('graphic editing transaction', () => {
  it('previews multiple vertex operations and finishes with one detached before/after result', async () => {
    const v = viewer(), item = new Graphic(polygon()), original = item.toJSON(), session = new EditSession(v.value, item)
    session.setVertexPosition(0, [115.99,39,0]); session.insertVertex(1); session.removeVertex(3)
    expect(item.toJSON().geometry.positions).toHaveLength(4)
    expect(session.finish()).toBe(true); expect(session.finish()).toBe(false)
    const result = await session.result
    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.before).toEqual(original.geometry); expect(result.after).toEqual(item.toJSON().geometry); expect(result.changed).toBe(true)
      result.after.positions[0][0] = 0; expect(item.toJSON().geometry.positions[0][0]).toBe(115.99)
    }
    expect(v.host.entities.values).toHaveLength(0); expect(handlers[0].destroy).toHaveBeenCalledOnce()
  })
  it('drags handles, preserves elevation, restores camera and geometry on cancellation during a drag', async () => {
    const v = viewer(), item = new Graphic({ ...polygon(), geometry: { ...polygon().geometry, heightMode: 'absolute', positions: polygon().geometry.positions.map(p => [p[0],p[1],40]) } })
    const original = item.toJSON().geometry, session = new EditSession(v.value, item)
    v.host.scene.pick.mockReturnValue({ id: v.host.entities.values[0] })
    action(ScreenSpaceEventType.LEFT_DOWN, { position: {} })
    expect(v.host.scene.screenSpaceCameraController.enableInputs).toBe(false)
    v.host.scene.globe.pick.mockReturnValue(Cartesian3.fromDegrees(115.98,39,0))
    action(ScreenSpaceEventType.MOUSE_MOVE, { endPosition: {} })
    expect(item.toJSON().geometry.positions[0][0]).toBeCloseTo(115.98); expect(item.toJSON().geometry.positions[0][2]).toBe(40)
    session.cancel(); await expect(session.result).resolves.toEqual({ status: 'cancelled' })
    expect(item.toJSON().geometry).toEqual(original); expect(v.host.scene.screenSpaceCameraController.enableInputs).toBe(true)
    expect(v.host.entities.values).toHaveLength(0)
  })
  it('inserts through midpoint handles, prevents deleting below minimum and rejects invalid geometry atomically', async () => {
    const v = viewer(), item = new Graphic(polygon()), session = new EditSession(v.value, item)
    v.host.scene.pick.mockReturnValue({ id: v.host.entities.values[1] }); action(ScreenSpaceEventType.LEFT_DOWN, { position: {} }); action(ScreenSpaceEventType.LEFT_UP)
    expect(session.state.selectedIndex).toBe(1); expect(session.state.geometry.positions).toHaveLength(5)
    expect(session.removeVertex(1)).toBe(true); expect(session.removeVertex(1)).toBe(true); expect(session.removeVertex(1)).toBe(false)
    const valid = session.state
    expect(() => session.setVertexPosition(0, [181,39,0])).toThrow(); expect(session.state).toEqual(valid)
    expect(() => session.insertVertex(0, valid.geometry.positions[1])).toThrow('重复'); expect(session.state).toEqual(valid)
    const detached = session.state; detached.geometry.positions[0][0] = 0; expect(session.state).toEqual(valid)
    session.cancel(); await session.result
  })
  it('shares one input owner with drawing; hiding a layer restores its serialized geometry', async () => {
    const v = viewer(), layer = new GraphicLayer({ id: 'layer', graphics: [polygon()] }); await layer.mount(v.value)
    const first = layer.startEditing('p'); first.setVertexPosition(0, [115.99,39,0])
    const second = layer.startEditing('p'); await expect(first.result).resolves.toEqual({ status: 'cancelled' })
    expect(second.state.geometry).toEqual(polygon().geometry)
    const drawing = new DrawSession(v.value, { type: 'polygon' }); await expect(second.result).resolves.toEqual({ status: 'cancelled' })
    const editing = layer.startEditing('p'); await expect(drawing.result).resolves.toEqual({ status: 'cancelled' })
    editing.setVertexPosition(0, [115.98,39,0]); layer.show = false
    await expect(editing.result).resolves.toEqual({ status: 'cancelled' }); expect(layer.toJSON()[0].geometry).toEqual(polygon().geometry)
    layer.destroy(); expect(v.host.entities.values).toHaveLength(0)
  })
  it('consumes Delete for vertices and leaves the original camera input state intact', async () => {
    vi.stubGlobal('Element', class {})
    const v = viewer(), session = new EditSession(v.value, new Graphic(polygon()))
    const key = new Event('keydown', { cancelable: true }); Object.defineProperty(key, 'key', { value: 'Delete' }); v.keyTarget.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true); expect(session.state.geometry.positions).toHaveLength(3)
    v.host.scene.screenSpaceCameraController.enableInputs = false
    v.host.scene.pick.mockReturnValue({ id: v.host.entities.values[0] }); action(ScreenSpaceEventType.LEFT_DOWN, { position: {} }); action(ScreenSpaceEventType.LEFT_UP)
    expect(v.host.scene.screenSpaceCameraController.enableInputs).toBe(false)
    v.keyTarget.dispatchEvent(new Event('blur')); await expect(session.result).resolves.toEqual({ status: 'cancelled' })
  })
  it('does not serialize selection styling and rejects locked edits without cancelling drawing', async () => {
    const v = viewer(), layer = new GraphicLayer({ id: 'layer', graphics: [{ ...polygon(), locked: true }] }); await layer.mount(v.value)
    const before = layer.toJSON(); layer.setSelected(['p']); expect(layer.toJSON()).toEqual(before)
    const drawing = new DrawSession(v.value, { type: 'polygon' })
    expect(() => layer.startEditing('p')).toThrow('锁定'); expect(drawing.isActive).toBe(true)
    drawing.cancel(); layer.destroy()
  })
})

describe('attribute-driven labels', () => {
  it('preserves zero/false and uses fixed text for missing or structured attributes', () => {
    const node = graphic(); node.style = { ...node.style, label: 'Fallback', labelField: 'value' }
    for (const [value, expected] of [[0,'0'],[false,'false'],['',''],[null,'Fallback'],[{},'Fallback']]) {
      node.properties.value = value; expect(resolveGraphicLabel(node)).toBe(expected)
    }
    delete node.properties.value; expect(resolveGraphicLabel(node)).toBe('Fallback')
    node.style.labelField = 'name'; expect(resolveGraphicLabel(node)).toBe('Point')
    node.properties.name = 'Actual attribute'; expect(resolveGraphicLabel(node)).toBe('Actual attribute')
    expect(() => new Graphic({ ...node, style: { ...node.style, labelField: '  ' } })).toThrow()
  })
  it('updates a field label when properties change without remounting the layer', async () => {
    const v = viewer(), node = graphic(); node.style.labelField = 'count'; node.properties.count = 0
    const layer = new GraphicLayer({ id: 'labels', graphics: [node] }); await layer.mount(v.value)
    const source = v.sources[0] as CustomDataSource
    expect(source.entities.getById('p')?.label?.text?.getValue(JulianDate.now())).toBe('0')
    layer.getGraphic('p')!.setOptions({ properties: { count: 12 } })
    expect(source.entities.getById('p')?.label?.text?.getValue(JulianDate.now())).toBe('12')
    expect(v.host.dataSources.add).toHaveBeenCalledOnce(); layer.destroy()
  })
})

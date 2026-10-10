import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoundingSphere, Cartesian2, Cartesian3, Entity, JulianDate, PolylineArrowMaterialProperty, Ray, ScreenSpaceEventType } from 'cesium'
import type { Viewer } from 'cesium'
import { createTransform } from '@desktop-webgis/cesium-scene-schema'
import type { Transform } from '@desktop-webgis/cesium-scene-schema'
import { TilesetEditor } from './index'

const handlers = vi.hoisted(() => new Map<number,(event?: unknown) => void>())
vi.mock('cesium', async importOriginal => {
  const actual = await importOriginal<typeof import('cesium')>()
  return { ...actual,ScreenSpaceEventHandler:class {
    setInputAction(action:(event?:unknown) => void,type:number): void { handlers.set(type,action) }
    destroy(): void { handlers.clear() }
  } }
})
afterEach(() => vi.unstubAllGlobals())

function setup() {
  vi.stubGlobal('window',new EventTarget())
  const pivot = Cartesian3.fromDegrees(0,0,0), entities:Entity[] = []
  let transform = createTransform()
  const viewer = {
    canvas:{},isDestroyed:() => false,
    entities:{ add:(options:ConstructorParameters<typeof Entity>[0]) => { const entity = new Entity(options); entities.push(entity); return entity },remove:(entity:Entity) => { const i=entities.indexOf(entity);if(i>=0)entities.splice(i,1) } },
    scene:{requestRender:vi.fn(),screenSpaceCameraController:{enableInputs:false},pick:() => ({id:entities[entities.length-1]})},
    camera:{directionWC:Cartesian3.normalize(new Cartesian3(-1,0,-1),new Cartesian3()),getPickRay:(pixel:Cartesian2) => new Ray(new Cartesian3(pivot.x+100,pixel.x,pixel.y),new Cartesian3(-1,0,0))}
  } as unknown as Viewer
  const layer = { id:'city',pivot,boundingSphere:new BoundingSphere(pivot,30),getTransform:() => structuredClone(transform),setTransform:(value:Transform) => { transform = structuredClone(value) } }
  const onCommit = vi.fn(),onCancel = vi.fn(),onPreview = vi.fn()
  const editor = new TilesetEditor(viewer,{onCommit,onCancel,onPreview})
  editor.startEditing(layer)
  const begin = () => handlers.get(ScreenSpaceEventType.LEFT_DOWN)?.({position:new Cartesian2(0,0)})
  const move = () => handlers.get(ScreenSpaceEventType.MOUSE_MOVE)?.({endPosition:new Cartesian2(25,15)})
  return {viewer,layer,editor,onCommit,onCancel,onPreview,begin,move,entities}
}

describe('transform gesture transactions',() => {
  it('uses arrows and keeps the same handles attached during drag, cancel and external transforms', () => {
    const s = setup(), time = JulianDate.now(), handle = s.entities[0]
    expect(handle.polyline?.material).toBeInstanceOf(PolylineArrowMaterialProperty)
    const before = handle.polyline!.positions!.getValue(time)[0]
    s.begin(); s.move()
    expect(s.entities[0]).toBe(handle)
    const moved = handle.polyline!.positions!.getValue(time)[0]
    expect(Cartesian3.distance(before, moved)).toBeCloseTo(Math.hypot(25,15))
    s.editor.cancel()
    const restored = s.entities[0].polyline!.positions!.getValue(time)[0]
    expect(Cartesian3.distance(before, restored)).toBeCloseTo(0)
    s.layer.setTransform({ ...createTransform(), translation: [60,0,0] })
    expect(Cartesian3.distance(before, s.entities[0].polyline!.positions!.getValue(time)[0])).toBeCloseTo(60)
    s.editor.destroy()
  })
  it('keeps a consistent screen length while zooming and follows local rotation', () => {
    const s = setup(), time = JulianDate.now()
    Object.assign(s.viewer.canvas, { clientWidth: 800, clientHeight: 600 })
    const getPixelSize = vi.fn(() => 2)
    Object.assign(s.viewer.camera, { getPixelSize })
    const points = () => s.entities[0].polyline!.positions!.getValue(time) as Cartesian3[]
    expect(Cartesian3.distance(...points() as [Cartesian3,Cartesian3])).toBeCloseTo(200)
    getPixelSize.mockReturnValue(4)
    expect(Cartesian3.distance(...points() as [Cartesian3,Cartesian3])).toBeCloseTo(400)
    s.editor.setMode('rotate')
    const before = Cartesian3.clone(points()[0])
    s.layer.setTransform({ ...createTransform(), rotation: [45,30,20] })
    expect(Cartesian3.distance(before, points()[0])).toBeGreaterThan(1)
    s.editor.destroy()
  })
  it('rotates about ENU up using Cesium heading sign', () => {
    const s = setup(); s.editor.setMode('rotate')
    handlers.get(ScreenSpaceEventType.LEFT_DOWN)?.({ position: new Cartesian2(20,0) })
    handlers.get(ScreenSpaceEventType.MOUSE_MOVE)?.({ endPosition: new Cartesian2(0,20) })
    const rotation = s.layer.getTransform().rotation
    expect(rotation[0]).toBeCloseTo(-90)
    expect(rotation[1]).toBeCloseTo(0)
    expect(rotation[2]).toBeCloseTo(0)
    s.editor.commit(); expect(s.onCommit).toHaveBeenCalledOnce(); s.editor.destroy()
  })
  it('scales uniformly and keeps all axes within the positive scale bound', () => {
    const s = setup(); s.editor.setMode('scale'); s.begin()
    handlers.get(ScreenSpaceEventType.MOUSE_MOVE)?.({ endPosition: new Cartesian2(150,0) })
    expect(s.layer.getTransform().scale).toBeCloseTo(Math.E)
    handlers.get(ScreenSpaceEventType.MOUSE_MOVE)?.({ endPosition: new Cartesian2(-10000,0) })
    expect(s.layer.getTransform().scale).toBe(.001)
    s.editor.destroy()
  })
  it('previews an ENU translation and commits once even with two release events',() => {
    const s=setup();s.begin();s.move();s.move()
    expect(s.layer.getTransform().translation).toEqual([25,15,0])
    expect(s.onCommit).not.toHaveBeenCalled()
    handlers.get(ScreenSpaceEventType.LEFT_UP)?.()
    window.dispatchEvent(new Event('pointerup'))
    expect(s.onCommit).toHaveBeenCalledOnce()
    expect(s.viewer.scene.screenSpaceCameraController.enableInputs).toBe(false)
    s.editor.destroy()
  })
  it('Escape restores the original transform and host camera setting',() => {
    const s=setup();s.begin();s.move()
    const event=Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape'})
    window.dispatchEvent(event)
    expect(s.layer.getTransform()).toEqual(createTransform())
    expect(s.onCommit).not.toHaveBeenCalled()
    expect(s.onCancel).toHaveBeenCalledOnce()
    expect(s.viewer.scene.screenSpaceCameraController.enableInputs).toBe(false)
    s.editor.destroy();expect(s.entities).toHaveLength(0)
  })
  it('switching tools cancels a drag and never creates a history entry',() => {
    const s=setup();s.begin();s.move();s.editor.setMode('rotate')
    expect(s.layer.getTransform()).toEqual(createTransform())
    expect(s.onCommit).not.toHaveBeenCalled()
    s.editor.destroy()
  })
})

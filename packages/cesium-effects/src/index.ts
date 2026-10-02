import { Cartesian3, Color, GeometryInstance, Material, MaterialAppearance, PolygonGeometry, PolygonHierarchy, Primitive, buildModuleUrl } from 'cesium'
import type { Viewer } from 'cesium'
import { BaseLayer } from '@desktop-webgis/cesium-layer'
import type { LayerOptions } from '@desktop-webgis/cesium-layer'
import type { GeoPosition } from '@desktop-webgis/cesium-scene-schema'

export interface WaterLayerOptions extends LayerOptions {
  boundary: GeoPosition[]
  height: number
  color?: string
  amplitude?: number
  frequency?: number
  speed?: number
}

/** Polygon water built solely with Cesium's public geometry and material APIs. */
export class WaterLayer extends BaseLayer {
  primitive?: Primitive
  private material?: Material
  private removeTick?: () => void
  constructor(private readonly options: WaterLayerOptions) { super(options) }
  contains(picked: unknown): boolean { return Boolean(picked && typeof picked === 'object' && 'primitive' in picked && picked.primitive === this.primitive) }
  async flyTo(): Promise<void> { if (this.viewer) this.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(this.options.boundary[0][0], this.options.boundary[0][1], this.options.height + 600) }) }
  protected setNativeVisible(value: boolean): void {
    if (this.primitive) this.primitive.show = value
    this.removeTick?.(); this.removeTick = undefined
    if (value && this.viewer && (this.options.speed ?? .02) > 0) this.removeTick = this.viewer.clock.onTick.addEventListener(() => this.viewer?.scene.requestRender())
  }
  protected async createNative(viewer: Viewer): Promise<() => void> {
    const material = Material.fromType('Water', {
      baseWaterColor: Color.fromCssColorString(this.options.color ?? '#238bafcc'),
      normalMap: buildModuleUrl('Assets/Textures/waterNormals.jpg'),
      frequency: this.options.frequency ?? 1000,
      animationSpeed: this.options.speed ?? .02,
      amplitude: this.options.amplitude ?? 4,
      specularIntensity: .5
    })
    const primitive = new Primitive({
      geometryInstances: new GeometryInstance({ id: this.id, geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(this.options.boundary.map(p => Cartesian3.fromDegrees(p[0], p[1], this.options.height))), height: this.options.height, vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }) }),
      appearance: new MaterialAppearance({ material, faceForward: true, translucent: true }),
      asynchronous: false
    })
    this.material = material; this.primitive = primitive
    viewer.scene.primitives.add(primitive)
    return () => {
      this.removeTick?.(); this.removeTick = undefined
      if (!viewer.isDestroyed() && !primitive.isDestroyed()) viewer.scene.primitives.remove(primitive)
      if (!material.isDestroyed()) material.destroy()
      this.primitive = undefined; this.material = undefined
    }
  }
}

/** Restore host settings on disposal instead of overwriting another application's defaults. */
export class CityEffects {
  private readonly original: { density: number; enabled: boolean; bloom: boolean }
  private destroyed = false
  constructor(private readonly viewer: Viewer) {
    this.original = { density: viewer.scene.fog.density, enabled: viewer.scene.fog.enabled, bloom: viewer.scene.postProcessStages.bloom.enabled }
  }
  update(effects: { fog: number; bloom: boolean }): void {
    if (this.destroyed) throw new Error('CityEffects 已销毁')
    this.viewer.scene.fog.enabled = effects.fog > 0
    this.viewer.scene.fog.density = effects.fog * .002
    this.viewer.scene.postProcessStages.bloom.enabled = effects.bloom
    this.viewer.scene.requestRender()
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.viewer.isDestroyed()) return
    this.viewer.scene.fog.enabled = this.original.enabled
    this.viewer.scene.fog.density = this.original.density
    this.viewer.scene.postProcessStages.bloom.enabled = this.original.bloom
  }
}

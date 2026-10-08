import type Map from 'ol/Map.js'
import Feature from 'ol/Feature.js'
import type { FeatureLike } from 'ol/Feature.js'
import type Geometry from 'ol/geom/Geometry.js'
import type VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import HighlightLayer from 'ol/layer/Vector.js'
import DragBox from 'ol/interaction/DragBox.js'
import type { StyleLike } from 'ol/style/Style.js'
import Style from 'ol/style/Style.js'
import Stroke from 'ol/style/Stroke.js'
import Fill from 'ol/style/Fill.js'
import Circle from 'ol/style/Circle.js'
import { unByKey } from 'ol/Observable.js'
import type { EventsKey } from 'ol/events.js'
import { applySelection, selectionOperation, uniqueSelection } from './selection.js'
import type { FeatureRef, SelectionOperation } from './selection.js'
import { getBoxCandidates, intersectsSelectionBox } from './hit-test.js'
export * from './selection.js'
export { intersectsSelectionBox } from './hit-test.js'

export interface SelectionTarget { layerKey: string; layer: VectorLayer<VectorSource<FeatureLike>> }
export interface SelectionRequest {
  selection: FeatureRef[]
  added: FeatureRef[]
  removed: FeatureRef[]
  source: 'click' | 'box'
  operation: SelectionOperation
  targetRevision: number
}
export interface SelectionOptions {
  map: Map
  targets: readonly SelectionTarget[]
  getFeatureId?: (feature: Feature<Geometry>, target: SelectionTarget) => string | number | undefined
  /** Optional lookup for accepted selection outside the currently interactive targets. */
  resolveSelectedFeature?: (ref: FeatureRef) => Feature<Geometry> | undefined
  style?: StyleLike
  hitTolerance?: number
  /** The host accepts/rejects the request and feeds the accepted state back via setSelection. */
  onSelectionRequest: (request: SelectionRequest) => void
}
export interface SelectionController {
  setActive(active: boolean): void
  setTargets(targets: readonly SelectionTarget[]): void
  setSelection(selection: readonly FeatureRef[]): void
  cancelGesture(): boolean
  dispose(): void
}

/** A controlled interaction; owns its overlay and listeners, never the map or input layers. */
export function createSelectionController(options: SelectionOptions): SelectionController {
  const validateTargets = (values: readonly SelectionTarget[]): void => {
    if (new Set(values.map(target => target.layerKey)).size !== values.length) throw new Error('Selection target layer keys must be unique')
  }
  validateTargets(options.targets)
  const { map } = options
  let targets = [...options.targets]
  let selection: FeatureRef[] = []
  let revision = 0, active = false, disposed = false
  let gesture: { baseline: FeatureRef[]; operation: SelectionOperation; revision: number } | null = null
  let suppressClick = false
  const source = new VectorSource<Feature<Geometry>>({ wrapX: true })
  const overlay = new HighlightLayer({ source, style: options.style ?? new Style({
    stroke: new Stroke({ color: '#f2b600', width: 3 }), fill: new Fill({ color: 'rgba(242,182,0,.15)' }),
    image: new Circle({ radius: 6, stroke: new Stroke({ color: '#f2b600', width: 2 }), fill: new Fill({ color: 'rgba(242,182,0,.3)' }) })
  }) })
  overlay.setMap(map)
  const box = new DragBox({ condition: event => active && 'button' in event.originalEvent && event.originalEvent.button === 0, minArea: 9 })
  box.setActive(false)
  // Last installed interaction handles primary drag before DragPan.
  map.addInteraction(box)
  let sourceKeys: EventsKey[] = []
  let layerKeys: EventsKey[] = []
  const idOf = (feature: Feature<Geometry>, target: SelectionTarget) => options.getFeatureId ? options.getFeatureId(feature, target) : feature.getId()
  const highlight = (feature: Feature<Geometry>): void => {
    if (!feature.getGeometry()) return
    const copy = feature.clone()
    copy.setStyle(undefined)
    source.addFeature(copy)
  }
  const refresh = (): void => {
    source.clear()
    if (disposed) return
    if (options.resolveSelectedFeature) {
      for (const ref of selection) {
        const feature = options.resolveSelectedFeature(ref)
        if (feature) highlight(feature)
      }
      return
    }
    for (const target of targets) {
      if (!target.layer.isVisible(map.getView())) continue
      const ids = new Set(selection.filter(ref => ref.layerKey === target.layerKey).map(ref => ref.featureId))
      target.layer.getSource()?.forEachFeature(feature => {
        if (!(feature instanceof Feature)) return
        const id = idOf(feature, target)
        if (id === undefined || !ids.has(id)) return
        highlight(feature)
      })
    }
  }
  const bindSources = (): void => {
    unByKey(sourceKeys); sourceKeys = []
    for (const target of targets) {
      const input = target.layer.getSource()
      if (input) sourceKeys.push(...input.on(['addfeature', 'removefeature', 'changefeature', 'clear'], () => { cancelGesture(); refresh() }))
    }
    refresh()
  }
  const bindTargets = (): void => {
    unByKey(layerKeys); layerKeys = []
    for (const target of targets) {
      layerKeys.push(target.layer.on('change:source', () => { cancelGesture(); bindSources() }), target.layer.on('change:visible', () => { cancelGesture(); refresh() }))
    }
    bindSources()
  }
  const request = (hits: FeatureRef[], operation: SelectionOperation, origin: 'click' | 'box', baseline = selection): void => {
    const next = applySelection(baseline, hits, operation)
    options.onSelectionRequest({ selection: next, source: origin, operation, targetRevision: revision,
      added: applySelection(next, baseline, 'remove'),
      removed: applySelection(baseline, next, 'remove') })
  }
  box.on('boxstart', event => {
    gesture = { baseline: uniqueSelection(selection), operation: selectionOperation(event.mapBrowserEvent.originalEvent), revision }
  })
  box.on('boxend', () => {
    const pending = gesture; gesture = null
    suppressClick = true
    if (!pending || pending.revision !== revision || !active) return
    const geometry = box.getGeometry().clone()
    const projection = map.getView().getProjection()
    const projectionExtent = projection.getExtent()
    const hits: FeatureRef[] = []
    for (const target of targets) {
      if (!target.layer.isVisible(map.getView())) continue
      const input = target.layer.getSource()
      const worldWidth = projection.canWrapX() && input?.getWrapX() && projectionExtent ? projectionExtent[2] - projectionExtent[0] : undefined
      const clipExtent = map.getLayerGroup().getLayerStatesArray().find(state => state.layer === target.layer)?.extent ?? target.layer.getExtent()
      const candidates = input ? getBoxCandidates(input, geometry, worldWidth) : []
      for (const feature of candidates ?? []) {
        if (!(feature instanceof Feature)) continue
        const shape = feature.getGeometry(), id = idOf(feature, target)
        if (shape && id !== undefined && intersectsSelectionBox(shape, geometry, worldWidth, clipExtent)) hits.push({ layerKey: target.layerKey, featureId: id })
      }
    }
    request(hits, pending.operation, 'box', pending.baseline)
  })
  box.on('boxcancel', () => { gesture = null })
  const clickKey = map.on('singleclick', event => {
    if (!active || disposed) return
    if (suppressClick) { suppressClick = false; return }
    const hits: FeatureRef[] = []
    map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
      const target = targets.find(value => value.layer === layer)
      if (!target || !(feature instanceof Feature)) return
      const id = idOf(feature, target)
      if (id !== undefined) hits.push({ layerKey: target.layerKey, featureId: id })
    }, { hitTolerance: options.hitTolerance ?? 6, layerFilter: layer => targets.some(target => target.layer === layer && layer.getVisible()) })
    request(hits, selectionOperation(event.originalEvent), 'click')
  })
  const cancelGesture = (): boolean => {
    if (!gesture) return false
    gesture = null; box.setActive(false); box.setActive(active)
    suppressClick = true
    return true
  }
  const viewport = map.getViewport()
  const onPointerDown = (): void => { suppressClick = false }
  viewport.addEventListener('pointerdown', onPointerDown, true)
  const moveKey = map.on('moveend', refresh)
  const moveStartKey = map.on('movestart', () => cancelGesture())
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && cancelGesture()) { event.preventDefault(); event.stopPropagation() } }
  const onBlur = (): void => { cancelGesture() }
  viewport.ownerDocument.addEventListener('keydown', onKey)
  viewport.ownerDocument.defaultView?.addEventListener('blur', onBlur)
  bindTargets()
  return {
    setActive(value) { if (disposed) return; cancelGesture(); active = value; box.setActive(value) },
    setTargets(value) { if (disposed) return; validateTargets(value); cancelGesture(); revision++; targets = [...value]; bindTargets() },
    setSelection(value) { if (disposed) return; cancelGesture(); selection = uniqueSelection(value); refresh() },
    cancelGesture,
    dispose() {
      if (disposed) return
      cancelGesture(); disposed = true; active = false
      unByKey([clickKey, moveKey, moveStartKey]); unByKey(sourceKeys); unByKey(layerKeys)
      viewport.removeEventListener('pointerdown', onPointerDown, true)
      viewport.ownerDocument.removeEventListener('keydown', onKey)
      viewport.ownerDocument.defaultView?.removeEventListener('blur', onBlur)
      map.removeInteraction(box); box.dispose(); overlay.setMap(null); overlay.dispose(); source.dispose()
    }
  }
}

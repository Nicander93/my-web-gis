// This fixture consumes only the package API and OL, never Desktop stores or runtimes.
import { createSelectionController } from '@desktop-webgis/ol-selection'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import LayerGroup from 'ol/layer/Group.js'

let clippedFixture: { map: Map; controller: ReturnType<typeof createSelectionController>; selected: string[]; element: HTMLElement } | undefined

/** A real OL map with a rotated view and a clipping parent group. */
export function createClippedFixture() {
  const element = document.createElement('div')
  element.id = 'clipped-selection-consumer'
  element.style.cssText = 'position:fixed;inset:180px auto auto 380px;width:400px;height:300px;z-index:9999;background:white'
  document.body.append(element)
  const features = [[0, 0], [2000000, 0]].map((coordinate, index) => {
    const feature = new Feature(new Point(coordinate)); feature.setId(`clip-${index}`); return feature
  })
  const layer = new VectorLayer({ source: new VectorSource({ features }) })
  const map = new Map({ target: element, layers: [new LayerGroup({ layers: [layer], extent: [-1000000, -1000000, 1000000, 1000000] })],
    view: new View({ center: [0, 0], zoom: 3, rotation: Math.PI / 4 }) })
  const selected: string[] = []
  const controller = createSelectionController({ map, targets: [{ layerKey: 'clipped', layer }], onSelectionRequest(request) {
    selected.splice(0, selected.length, ...request.selection.map(ref => String(ref.featureId)))
    controller.setSelection(request.selection)
  } })
  controller.setActive(true)
  clippedFixture = { map, element, selected, controller }
  map.renderSync()
}

export function readClippedSelection() { return clippedFixture?.selected }

export function disposeClippedFixture() {
  clippedFixture?.controller.dispose(); clippedFixture?.map.dispose(); clippedFixture?.element.remove(); clippedFixture = undefined
}

export function exerciseLifecycle() {
  const element = document.createElement('div')
  element.style.cssText = 'width:400px;height:300px'
  document.body.append(element)
  const feature = new Feature(new Point([0, 0])); feature.setId('one')
  const source = new VectorSource({ features: [feature] })
  const layer = new VectorLayer({ source })
  const map = new Map({ target: element, layers: [layer], view: new View({ center: [0, 0], zoom: 3 }) })
  const initialInteractions = map.getInteractions().getLength()
  const requests: unknown[] = []
  const controller = createSelectionController({ map, targets: [{ layerKey: 'one', layer }], onSelectionRequest: request => requests.push(request) })
  let unmanaged = 0
  map.on('postrender', event => { unmanaged = event.frameState?.layerStatesArray.filter(state => !state.managed).length ?? 0 })
  controller.setSelection([{ layerKey: 'one', featureId: 'one' }])
  controller.setActive(true)
  controller.setActive(false)
  map.renderSync()
  const retained = unmanaged
  const ownedInteraction = map.getInteractions().getLength() === initialInteractions + 1
  source.clear(); source.addFeature(feature)
  controller.dispose(); controller.dispose()
  map.renderSync()
  const result = { retained, ownedInteraction, silent: requests.length === 0,
    interactionsRestored: map.getInteractions().getLength() === initialInteractions,
    overlayReleased: unmanaged === 0,
    sourceIntact: source.getFeatures().length === 1, mapIntact: map.getTargetElement() === element }
  map.dispose(); element.remove()
  return result
}

// This fixture consumes only the package API and OL, never Desktop stores or runtimes.
import { createSelectionController } from '@desktop-webgis/ol-selection'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'

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

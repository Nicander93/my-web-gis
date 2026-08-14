import type { LayerStyle } from '@desktop-webgis/gis-core'
import type { FeatureLike } from 'ol/Feature'
import CircleStyle from 'ol/style/Circle'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import Style from 'ol/style/Style'

export function createLayerStyle(layerStyle: LayerStyle): (feature: FeatureLike) => Style {
  return () =>
    new Style({
      stroke: new Stroke({
        color: layerStyle.stroke,
        width: layerStyle.width
      }),
      fill: new Fill({
        color: layerStyle.fill
      }),
      image: new CircleStyle({
        radius: layerStyle.pointRadius,
        stroke: new Stroke({
          color: layerStyle.stroke,
          width: 1.5
        }),
        fill: new Fill({
          color: layerStyle.fill
        })
      })
    })
}

export function createSelectionStyle(): Style {
  return new Style({
    stroke: new Stroke({
      color: '#586b5d',
      width: 3
    }),
    fill: new Fill({
      color: '#586b5d26'
    }),
    image: new CircleStyle({
      radius: 6,
      stroke: new Stroke({
        color: '#252522',
        width: 1.5
      }),
      fill: new Fill({
        color: '#dfe8de'
      })
    })
  })
}

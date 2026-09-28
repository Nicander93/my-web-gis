import type { Layer } from '@desktop-webgis/gis-core'
import { isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'
import { compileStyle } from '@desktop-webgis/ol-style'
import type { FeatureLike } from 'ol/Feature'
import CircleStyle from 'ol/style/Circle'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import Style from 'ol/style/Style'

export function createLayerStyle(layer: Layer): (feature: FeatureLike) => Style {
  let style = layer.style
  
  if (isLegacyStyle(style)) {
    style = migrateLegacyStyle(style)
  }

  return compileStyle(style)
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

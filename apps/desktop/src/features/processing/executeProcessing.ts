import { processFeatures, type GisFeature, type ProcessingOptions, type ProcessingResult } from '@desktop-webgis/gis-core'
import { addGeometryMeasurements, calculateField, clipLines, joinAttributes, joinByLocation, summarizeByLocation } from '@desktop-webgis/spatial-analysis'

/** Route serializable UI requests to reusable package APIs, without project or runtime dependencies. */
export function executeProcessing(features: GisFeature[], options: ProcessingOptions, overlay: GisFeature[] = []): ProcessingResult {
  if (options.tool === 'calculate-field') return { inputCount: features.length, features: calculateField(features, options) }
  if (options.tool === 'measure-area') return { inputCount: features.length, features: addGeometryMeasurements(features, { measurement: 'area', unit: options.unit, field: options.field }) }
  if (options.tool === 'measure-length' || options.tool === 'measure-perimeter') return { inputCount: features.length, features: addGeometryMeasurements(features, { measurement: options.tool === 'measure-length' ? 'length' : 'perimeter', unit: options.unit, field: options.field }) }
  if (options.tool === 'clip-lines') return { inputCount: features.length, overlayCount: overlay.length, features: clipLines(features, overlay) }
  if (options.tool === 'summarize-location') {
    return { inputCount: features.length, overlayCount: overlay.length, features: summarizeByLocation(features, overlay, {
      predicate: options.predicate, countField: `${options.prefix}count`,
      summaries: options.field ? [
        { field: options.field, operation: 'sum', output: `${options.prefix}sum` },
        { field: options.field, operation: 'mean', output: `${options.prefix}mean` }
      ] : []
    }) }
  }
  if (options.tool === 'attribute-join') {
    return { inputCount: features.length, overlayCount: overlay.length, features: joinAttributes(features, overlay.map(feature => feature.properties), options) }
  }
  if (options.tool === 'spatial-join') {
    return { inputCount: features.length, overlayCount: overlay.length, features: joinByLocation(features, overlay, options) }
  }
  return processFeatures(features, options, overlay)
}

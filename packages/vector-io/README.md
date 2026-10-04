# @desktop-webgis/vector-io

Browser-friendly vector interchange utilities:

- import zipped Shapefiles through `importShapefile` (normalized to WGS84 GeoJSON);
- export GeoJSON as a zipped Shapefile through `exportShapefile`;
- import ASCII DXF through `importDxf`;
- approximate CIRCLE/ARC entities and report unsupported CAD entities without silently dropping them.

DWG and binary DXF are outside the V0.1 boundary. DXF has no universal CRS metadata, so callers may supply an explicit coordinate transform.

## Reprojection and point coordinate CSV

```ts
import { createCoordinateTransform, reprojectFeatures, pointsToCoordinateCsv } from '@desktop-webgis/vector-io'

const projected = reprojectFeatures(features, { code: 'EPSG:4326' }, { code: 'EPSG:3857' })
const csv = pointsToCoordinateCsv(features, { code: 'EPSG:4326' }, { code: 'EPSG:3857' })
const utm = createCoordinateTransform({ code: 'EPSG:4326' }, {
  proj4: '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs'
})
```

Transforms reuse the existing [Proj4js](https://proj4js.org/) dependency. Source and target accept registered codes or explicit PROJ/WKT definitions, with explicit definitions taking priority. Unknown identical CRS codes are rejected rather than treated as identity. No EPSG service lookup, automatic CRS inference or grid loading is provided. Axis order is always XY (longitude/latitude for geographic input), independent of a WKT axis declaration. XY is transformed; Z/M are preserved numerically, without vertical datum or unit conversion. Definition accuracy, area of use and required datum grids remain the caller's responsibility; no survey accuracy is promised.

Positions must contain at least two finite numbers; transformation errors and non-finite results fail the batch. Built-in WGS84 input/output is bounded to ±180° longitude and ±90° latitude. Built-in Web Mercator is limited to its world extent ±20037508.34278925 meters (WGS84 latitude ±85.0511287798066°). Custom definitions are checked for finite results but not their projection-specific area of use.

`reprojectFeatures` accepts ordinary objects with GeoJSON geometry or null, supports all nesting including GeometryCollection, returns independent clones, preserves IDs/properties/metadata and drops stale feature/geometry bbox. It does not validate or repair topology, densify edges, split antimeridian crossings or update caller-specific CRS metadata. Callers must keep target CRS alongside transformed coordinates. Projected results must not be serialized as RFC 7946 GeoJSON, which requires WGS84 longitude/latitude.

`pointsToCoordinateCsv` requires single Point geometries and an explicit target code. Output columns are id/x/y plus crs and original attributes. Existing id/x/y/crs attributes cause an error rather than duplicate headers or overwrite data. Z/M are omitted from CSV. Attributes retain spreadsheet formula protection; finite XY remain numeric, including negative values. Empty input returns null. `previewCsv` recognizes a uniform EPSG declaration in the crs column across all records; `importCsv` rejects declarations conflicting with the caller's chosen CRS, including conflicts after the preview sample. As before, `importCsv` returns source coordinates; call `reprojectFeatures` at your storage boundary.

Desktop stores WGS84 coordinates. GeoJSON import accepts legacy named EPSG declarations and an explicit source CRS; conflicts and unsupported definitions fail without guessing. Export supports WGS84 GeoJSON, attributes-only CSV, or projected point coordinate CSV. Map display CRS does not implicitly change exported geometry. Desktop presets are currently 4326 and 3857; developers can supply other registered codes or explicit definitions.

## Independent package verification

```sh
pnpm --filter @desktop-webgis/vector-io build
pnpm --filter @desktop-webgis/vector-io test
pnpm --filter @desktop-webgis/vector-io test:consumer
```

Consumer checks execute built public ESM exports in Node and compile a NodeNext TypeScript caller without source aliases. Clone operations require structuredClone (Node 20+ or modern browsers). This batch does not publish to npm; Proj4js uses MIT, whose notice must accompany distribution.

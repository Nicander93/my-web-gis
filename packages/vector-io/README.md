# @desktop-webgis/vector-io

Browser-friendly vector interchange utilities:

- import zipped Shapefiles through `importShapefile` (normalized to WGS84 GeoJSON);
- export GeoJSON as a zipped Shapefile through `exportShapefile`;
- import ASCII DXF through `importDxf`;
- approximate CIRCLE/ARC entities and report unsupported CAD entities without silently dropping them.

DWG and binary DXF are outside the V0.1 boundary. DXF has no universal CRS metadata, so callers may supply an explicit coordinate transform.

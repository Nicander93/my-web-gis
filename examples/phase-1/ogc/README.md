# OGC Capabilities fixtures (P15+)

Public-domain handmade Capabilities documents for WMS 1.3.0 / 1.1.1, WMTS 1.0.0, and WFS 2.0.0.

- **No credentials / tokens** in these files.
- Canonical copies also live under `packages/ogc-io/fixtures/` for package tests.
- Used by P15 connection/parser tests; P16–P18 may extend them.

| File | Purpose |
| --- | --- |
| `wms-1.3.0-capabilities.xml` | WMS 1.3.0 named layers, styles, CRS/extent inheritance |
| `wms-1.1.1-capabilities.xml` | WMS 1.1.1 LatLonBoundingBox / SRS inheritance |
| `wms-service-exception.xml` | ServiceExceptionReport sample (P16) |
| `wmts-1.0.0-capabilities.xml` | WMTS layer + TileMatrixSet |
| `wfs-2.0.0-capabilities.xml` | WFS feature types |

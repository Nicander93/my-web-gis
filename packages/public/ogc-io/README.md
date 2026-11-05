# @desktop-webgis/ogc-io

OGC service URL normalization, capabilities request helpers, and XML parsers for WMS / WMTS / WFS.

## 架构图

```mermaid
flowchart TB
  subgraph capabilities ["OGC Capabilities 解析与请求构建"]
    xml["xml.ts + parseCapabilitiesXml"]
    wms["WMS：图层树/CRS继承 · GetMap 请求参数"]
    wmts["WMTS：TileMatrixSet 匹配 · KVP / REST URL 构建"]
    wfs["WFS：FeatureType 解析 · 有界分页 GetFeature 构建"]
  end

  subgraph styleExport ["样式导出与 GeoServer 发布"]
    sld["sld-export.ts & sld-package.ts（SLD 1.1 XML 与资源包）"]
    mb["mbstyle-export.ts（MapBox Style 导出）"]
    gs["geoserver-client.ts（GeoServer REST 客户端）"]
  end

  xml --> wms
  xml --> wmts
  xml --> wfs
  sld --> gs
  mb --> gs
```

- Secrets (query tokens, Bearer values) are never written into fixtures, logs, or returned shareable URLs.
- `fetchCapabilitiesXml` is separate from `parseCapabilitiesXml`.
- Inject `fetch` (browser or Tauri native channel); this package does not open a public proxy or disable TLS.

P16: CRS/extent inheritance for WMS layers; ServiceExceptionReport mapping (`wms-service-exception.xml`).

P17: WMTS TileMatrix / style / format / KVP|REST resolve (`resolveWmtsLayerOptions`); fixtures cover non-numeric matrix IDs, 512px tiles, and REST templates.

P18: WFS 2.0/1.1 feature type + outputFormat + paging parse; `resolveWfsLoadOptions` / `buildGetFeatureRequestUrl` / bounded page plan; axis-order samples for BBOX; fixtures include 1.1.0 and GeoJSON GetFeature sample.

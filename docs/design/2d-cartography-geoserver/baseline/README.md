# OpenLayers 与 GeoServer WMS 配对基线

该验收按技术设计 7.3，为真实 GeoServer 2.28.2 与 OpenLayers Canvas 输出归档同数据、同范围、同 CRS、同 256 × 256 尺寸和像素比的图像。样式通过仓库当前 `createMapLibreCanvasBinding` 与 SLD exporter 分别渲染，覆盖道路描边、虚线、透明面填充、文字 halo，以及内置双层主干道 casing/surface 顺序。真实 WFS GeoJSON 响应在同一用例中供本地 OL 渲染使用；GeoServer WMS 则读取同一 FeatureType。

每个用例将导出的 SLD 临时上传为 GeoServer 样式资源，以该资源请求 WMS GetMap，完成后删除临时样式；不会修改 FeatureType 默认样式或发布记录。主干道用例还验证 SLD FeatureTypeStyle 顺序为 `casing` → `surface`。

运行命令：

```powershell
$env:CARTOGRAPHY_GEOSERVER_URL = 'http://127.0.0.1:18085/geoserver'
$env:CARTOGRAPHY_GEOSERVER_USER = 'admin'
$env:CARTOGRAPHY_GEOSERVER_PASSWORD = 'geoserver'
pnpm --filter @desktop-webgis/desktop exec playwright test --config playwright.cartography-visual-baseline.config.ts
```

浏览器证据会写入 `geoserver-2.28.2/`，包含 OL PNG、WMS PNG、差异热图、SLD 与 `run-metadata.json`。元数据记录服务版本、WFS FeatureCollection 哈希、范围、像素尺寸、样式及差异指标。

差异图和指标用于留存渲染器差异，不代表像素一致验收。文字栅格化、字体替换、线条栅格化与 SLD 子集语义可产生预期差异。证据来自 Chromium Canvas 与 GeoServer WMS，不是原生 Tauri 截图。

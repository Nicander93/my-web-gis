# @desktop-webgis/ol-runtime

服务于 Desktop 二维工作台的 OpenLayers 运行时封装（内部包），负责地图挂载、文档增量同步、WMS/WMTS 服务图层构建、选择高亮与几何绘制/节点编辑工具。

## 架构图

```mermaid
flowchart TB
  index["src/index.ts"]

  subgraph map ["src/map/ 地图运行时"]
    olMap["OlMapRuntime.ts<br/>挂载 ol/Map · syncDocument 原位更新 VectorSource · 视图缩放与预览"]
  end

  subgraph layer ["src/layer/ & src/wms/ & src/wmts/ 图层与服务"]
    registry["OlLayerRegistry.ts（按图层 ID 索引 VectorLayer / TileLayer）"]
    wms["wms/createWmsLayer.ts & getMapRequest.ts"]
    wmts["wmts/createWmtsLayer.ts & buildWmtsTileGrid.ts & tileUrl.ts"]
  end

  subgraph interaction ["src/selection/ & src/tools/ 交互与编辑"]
    sel["OlSelectionRuntime.ts<br/>封装 @desktop-webgis/ol-selection"]
    tools["OlToolRuntime.ts<br/>点/线/面绘制 · 多顶点 Modify · 吸附（Snapping）"]
  end

  subgraph adapters ["src/adapters/ 要素适配"]
    featAdapter["featureAdapter.ts（GisFeature ↔ ol/Feature 投影转换）"]
  end

  index --> olMap
  index --> sel
  index --> tools
  olMap --> registry
  olMap --> wms
  olMap --> wmts
  olMap --> featAdapter
  sel --> olMap
  tools --> olMap
  tools --> featAdapter
```

## 验证

```bash
pnpm --filter @desktop-webgis/ol-runtime build
pnpm --filter @desktop-webgis/ol-runtime test
```

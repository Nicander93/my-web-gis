# @desktop-webgis/cesium-measure

无 UI 框架依赖的 Cesium 三维场景量算工具包（可发布通用包），支持空间距离、贴地距离、水平面积与高度差计算。

## 架构图

```mermaid
flowchart LR
  input["WGS84 坐标序列<br/>GeoPosition[]（经度, 纬度, 椭球高度）"]
  entry["src/index.ts"]

  subgraph algorithms ["三维量算能力"]
    spatial["measureSpatialDistance<br/>三维笛卡尔空间折线总长"]
    ground["measureGroundDistance<br/>按地形/3D Tiles 表面采样贴地距离"]
    area["measureArea<br/>球面/局部切平面多边形面积"]
    height["measureHeightDifference<br/>首末点椭球高程差"]
  end

  output["SceneMeasurement<br/>{ kind, value, unit, label }"]

  input --> entry --> algorithms --> output
```

## 验证

```bash
pnpm --filter @desktop-webgis/cesium-measure build
pnpm --filter @desktop-webgis/cesium-measure test
```

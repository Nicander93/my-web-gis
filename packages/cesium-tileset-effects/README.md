# @desktop-webgis/cesium-tileset-effects

为单个 Cesium 3D Tileset 管理可恢复的多边形裁剪。包不依赖 React 或 Desktop Store；效果配置来自 `@desktop-webgis/cesium-scene-schema`。

`keep-inside` 映射到 Cesium `inverse: true`，保留任一范围内部；`keep-outside` 映射到 `inverse: false`，裁掉任一范围内部。混合模式会返回明确诊断，不会静默改变语义。

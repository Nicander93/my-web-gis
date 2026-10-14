# @desktop-webgis/cesium-tileset-effects

为单个 Cesium 3D Tileset 管理可恢复的多边形裁剪和局部压平。包不依赖 React 或 Desktop Store；效果配置来自 `@desktop-webgis/cesium-scene-schema`。

`keep-inside` 映射到 Cesium `inverse: true`，保留任一范围内部；`keep-outside` 映射到 `inverse: false`，裁掉任一范围内部。混合模式会返回明确诊断，不会静默改变语义。

局部压平以每个范围中心建立 ENU 坐标系，将 WGS84 椭球高转换为局部目标高度，并在 `CustomShader` 中同时处理 Tileset 的模型变换。多个范围可以设置不同高度，后配置的范围覆盖重叠区域。单个效果集限制在 5 km 跨度和 2048 像素遮罩边长内，同时受当前 GPU 最大纹理尺寸约束。

管理器按 Tileset 隔离原生集合、遮罩纹理和 Shader，并在更新、移除及销毁时恢复宿主状态和释放自有资源。若宿主已经安装调用方拥有的 `CustomShader`，压平会明确报错，避免覆盖未知 Shader。

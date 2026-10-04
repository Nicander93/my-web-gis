# @desktop-webgis/cesium-layer

无 UI 框架依赖的 Cesium 图层：`TilesetLayer`、`ModelLayer`、`GeoJsonLayer`、`GraphicLayer` 和 `LayerCollection`。Cesium 由宿主提供（peer dependency），不会创建第二份 Viewer。

```ts
import { LayerCollection, TilesetLayer } from '@desktop-webgis/cesium-layer'

const layers = new LayerCollection(viewer)
const city = new TilesetLayer({ id: 'city', url: '/models/tileset.json' })
city.bindPopup({ title: '建筑信息', fields: [{ field: 'name', label: '名称' }] })
const off = city.on('click', event => console.log(event.properties))
await city.addTo(layers)
await city.flyTo()
city.show = false
off()
layers.removeLayer('city')
layers.destroy() // 不销毁宿主 Viewer
```

`ModelLayer` 接收 `position: [经度, 纬度, 椭球高度]`。模型和 tileset 的 `getTransform/setTransform` 使用原始位置附近的 ENU 米制平移、航向/俯仰/翻滚角度及等比缩放，保留原始矩阵。直接图层 API 可用 Cesium `Resource` 注入鉴权。

`addLayer` 是异步操作，须等待或捕获异常。移除加载中的图层会取消挂载，迟到的资源会释放。`removeLayer` 允许重新挂载；`destroy` 为最终释放。`state` 描述挂载状态，流式瓦片失败通过 `error` 事件通知。`load` 表示 tileset 根配置或模型已就绪，不代表整个城市所有瓦片都已下载。

需要复制 Cesium 的 Workers、Assets、ThirdParty、Widgets，设置 `CESIUM_BASE_URL` 并引入 widgets.css。参见仓库 `examples/city-3d/consumer` 的独立 Vite 示例。

首版 0.1.0，MIT；尚未发布 npm。源码为独立实现，接口风格参考 Mars3D，交互参考 [cesium-demo](https://github.com/Nicander93/cesium-demo)。

## 图形和绘制

```ts
import { GraphicLayer } from '@desktop-webgis/cesium-layer'
const annotations = new GraphicLayer({ id: 'annotations', name: '标绘' })
await annotations.addTo(layers)
const draw = annotations.startDraw({
  type: 'polygon', // point | polyline | polygon
  heightMode: 'ground', // ground | absolute
  style: { color: '#3b796a', width: 3 },
  properties: { name: '规划区域' }
})
const result = await draw.result
if (result.status === 'completed') {
  const graphic = annotations.addGraphic(result.graphic)
  graphic.bindPopup({ fields: [{ field: 'name', label: '名称' }] })
  graphic.setOptions({ style: { ...graphic.toJSON().style, label: '规划区域' } })
}
const savedGraphics = annotations.toJSON()
```

单击采集，线至少 2 点、面至少 3 点；点单击后完成。Enter/右键或 `draw.finish()` 完成，Esc/失焦或 `draw.cancel()` 取消，Backspace 移除最后一点。一次 Viewer 只允许一个 DrawSession；隐藏或移除图形层会取消其会话。会话只拥有临时预览；完成返回纯配置，**不会自动入层**，历史和保存由宿主接入。使用 LayerCollection 时，宿主应在绘制期间关闭 `pickingEnabled`，结束后恢复；CitySceneRuntime 已协调此行为。

`ground` 拾取地形/椭球并贴地渲染；`absolute` 优先深度拾取模型表面，失败时拾取地表，并保留椭球高度。坐标统一为 WGS84 `[经度,纬度,高度]`。样式包括颜色、线宽、点大小和固定文本标签；暂不提供顶点拖拽、分类样式或吸附。

`getGraphic/addGraphic/removeGraphic` 管理稳定 ID；`Graphic.toJSON()` 返回独立克隆。属性只能包含 JSON 值；拒绝循环引用、回调、Cesium 实例和非有限数。更新图形或 GeoJSON 颜色不重新下载资源。`layers.popupsEnabled` 可关闭点击弹窗，同时保留选择事件。

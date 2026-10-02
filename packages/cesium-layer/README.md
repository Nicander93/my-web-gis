# @desktop-webgis/cesium-layer

无 UI 框架依赖的 Cesium 图层：`TilesetLayer`、`ModelLayer`、`GeoJsonLayer` 和 `LayerCollection`。Cesium 由宿主提供（peer dependency），不会创建第二份 Viewer。

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

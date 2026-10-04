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

单击采集，线至少 2 点、面至少 3 点；点单击后完成。Enter/右键或 `draw.finish()` 完成，Esc/失焦或 `draw.cancel()` 取消，Backspace 移除最后一点。同一 Viewer 的绘制和顶点编辑共用一个输入所有者，新会话取消旧会话；隐藏或移除图形层也会取消。绘制完成返回纯配置，**不会自动入层**，历史和保存由宿主接入。使用 LayerCollection 时，宿主应在会话期间关闭 `pickingEnabled`，结束后恢复；CitySceneRuntime 已协调此行为。

`ground` 拾取地形/椭球并贴地渲染；绘制时 `absolute` 优先深度拾取模型表面，失败时拾取地表，并保留椭球高度。坐标统一为 WGS84 `[经度,纬度,高度]`。样式包括颜色、线宽、点大小和标签；`style.labelField` 读取文本、数字、布尔属性，缺失、null 或结构化值使用 `style.label` 作为后备。`resolveGraphicLabel(node)` 可独立计算标签，数字 0 和布尔 false 不会被丢弃。分类样式和吸附仍待实现。

`getGraphic/addGraphic/removeGraphic` 管理稳定 ID；`Graphic.toJSON()` 返回独立克隆。属性只能包含 JSON 值；拒绝循环引用、回调、Cesium 实例和非有限数。更新图形或 GeoJSON 颜色不重新下载资源。`layers.popupsEnabled` 可关闭点击弹窗，同时保留选择事件。

## 顶点编辑

```ts
const edit = annotations.startEditing(graphic.id, {
  onChange: ({ geometry, selectedIndex }) => updateCoordinatePanel(geometry, selectedIndex)
})
const result = await edit.result
if (result.status === 'completed' && result.changed) {
  saveOneHistoryCommand(result.id, result.before, result.after)
}
```

`EditSession` 预览会直接更新层内 Graphic，宿主项目配置和历史在完成前保持原值。`finish()` / Enter 返回独立克隆的 before/after；`cancel()` / Esc / 失焦恢复原几何。删除图形、隐藏或卸载图层会取消并移除临时手柄。宿主应在调用 `toJSON()` 保存前完成或取消编辑，避免保存预览数据。

拖动实心顶点移动经纬度，点击白色中点插入顶点，Delete / Backspace 删除当前顶点；最少保留点 1、线 2、面 3 个顶点。拖动保留原高度，`setVertexPosition(index, [经度,纬度,高度])` 可精确修改。`selectVertex`、`insertVertex(afterIndex, position?)`、`removeVertex` 和独立克隆的 `state` 支持宿主坐标面板。取消或结束拖动恢复相机原输入状态；锁定和隐藏图形不能开始编辑。

`setSelected(ids)` 只改变绘制高亮，不修改可保存样式。运行时使用同一 GraphicLayer API，独立 consumer 也提供选中图形编辑、应用、取消与撤销示例。

# @desktop-webgis/cesium-scene-runtime

组合图层、Popup、编辑器和基础特效的场景运行时，无 React、Zustand、Tauri、OpenLayers 依赖。编辑器和静态 Viewer 共用。

```ts
import { createCityRuntime } from '@desktop-webgis/cesium-scene-runtime'
import 'cesium/Build/Cesium/Widgets/widgets.css'
const runtime = createCityRuntime({
  target: document.getElementById('map')!, scene: city,
  sceneUrl: new URL('./scene.json', location.href).href,
  cesiumBaseUrl: '/cesium/',
  onEdit: ({ id, after }) => saveTransform(id, after),
  onLayerState: (id, state, error) => console.log(id, state, error)
})
await runtime.updateScene(city)
runtime.startEditing('blocks', 'translate')
runtime.stopEditing()
runtime.destroy() // 也销毁由 createCityRuntime 创建的 Viewer
```

也可 `new CitySceneRuntime(viewer, options)` 使用已有 Viewer；同样由 runtime.destroy 销毁该 Viewer。若宿主需要保留 Viewer，请直接使用底层独立包。

`createCityRuntime` 同步创建 Viewer，资源挂载由 `updateScene` 驱动，须捕获异步错误。相同资源的显隐/变换/Popup 更新复用图层；资源变化、删除及销毁清理旧实例。`setCamera/getCamera/flyTo/getNativeViewer/layers` 提供常见能力及 Cesium 原生出口。没有自动二三维相机联动或二维样式转换。

`resolveResource(url)` 可返回宿主鉴权 Resource，场景中不保存令牌。没有 Cesium ion 默认网络资源，未配置底图时使用 Cesium 自带世界影像，未配置地形时使用椭球。部署须复制 Workers、Assets、ThirdParty、Widgets，并设置资源基址；见独立消费者示例。

Cesium 为 peer dependency。首版 0.1.0，MIT；尚未发布 npm。

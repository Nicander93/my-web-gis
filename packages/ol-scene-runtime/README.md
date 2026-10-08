# @desktop-webgis/ol-scene-runtime

An editor-independent OpenLayers runtime for `SceneManifest` JSON documents.

```ts
import { createSceneRuntime } from '@desktop-webgis/ol-scene-runtime'

const runtime = await createSceneRuntime({
  target: 'map',
  scene: '/scene.json'
})
```

The package exposes the native `ol/Map` only as an advanced escape hatch. Normal scene operations use stable layer IDs and runtime events.
# 图层生命周期句柄（实施中的 API）

`createOlLayerHandle(definition, sources, view, options)` 创建一个图层句柄；Promise 只表示原生对象已创建，远程数据和瓦片完成加载须另行监听数据源事件。`update` 更新显隐、透明度、缩放范围和样式，保持原图层及数据源；修改身份、类型或资源引用需要新建句柄。

`options.vectorSource` 可传入调用方维护的共享矢量源，句柄销毁不会释放它。默认创建的源与 Provider 子图层由句柄拥有。先从 Map 移除图层，再调用幂等 `dispose()`。`signal` 可取消创建及 Provider 会话请求；此接口不拥有 Map 或 View。

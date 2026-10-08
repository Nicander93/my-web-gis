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

Runtime 可通过 `map` 接入调用方现有的 OpenLayers Map，或通过 `target` 创建自己的 Map。外部 Map 的图层和控制器不会被清空，`destroy()` 不销毁外部 Map 或解除其 target；加载场景仍会应用场景 View，宿主负责决定何时调用加载。

`updateScene` 在资源、视图、控件配置以及图层身份／类型不变时原位更新显示、样式与顺序，保持图层和源实例。其余变化走准备成功后替换路径。`getScene()` 返回隔离的声明式副本；便捷显隐／透明度 API 同步此内容。直接改原生对象仍不会自动写回文档。

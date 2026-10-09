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

`createOlDocumentLayers(document, { viewId, fetch, credentials, signal })` 消费 v3 文档并返回 `view`、`rootLayers`、能力 `issues` 和幂等 `dispose`。宿主将根图层加入现有 Map，移除后释放。多个节点引用同一矢量资源时共享源；节点过滤只影响样式和 `getFilteredFeatures(id)`，不删除源数据或改写可导出的文档。该查询不代替宿主的显隐和可选策略。

工厂与 `OlDocumentRuntime` 均接受 `vectorSources`，按资源 ID 提供宿主持有的完整矢量源。源须已投影到所选 View，宿主负责使其内容与文档声明一致；运行时不会重新请求该资源、改写原要素 ID，或在失败、替换、销毁时释放该源。节点仍各自应用样式与过滤。此接口用于编辑器适配，默认独立消费者仍由工厂创建并释放源。

内嵌／URL GeoJSON 与 WFS 缓存均保持数字和字符串身份，使用 `getSceneFeatureId(feature)` 读取原身份。URL GeoJSON 准备完成并校验后才创建源；WFS 只显示缓存并返回提示，不自动刷新服务。三维对象返回能力问题并保留定义；未知必需扩展阻止创建。认证 WMS／WMTS 需要显式提供 `configureServiceLayer(layer, resource, resourceId)`，否则拒绝；此宿主回调安装原生请求处理，可返回清理函数，失败与销毁时调用。凭据值由宿主解析，不写入文档。创建成功只表示对象与矢量准备完成，不表示瓦片已经加载。

`updateScene` 在资源、视图、控件配置以及图层身份／类型不变时原位更新显示、样式与顺序，保持图层和源实例。其余变化走准备成功后替换路径。`getScene()` 返回隔离的声明式副本；便捷显隐／透明度 API 同步此内容。直接改原生对象仍不会自动写回文档。
# v3 document mounting

`OlDocumentRuntime` mounts the shared v3 document factory on an existing OL map:

```ts
import { OlDocumentRuntime } from '@desktop-webgis/ol-scene-runtime'

const runtime = new OlDocumentRuntime({ map })
await runtime.loadDocument(document, abortController.signal)
runtime.getLayer('roads')
runtime.getFilteredFeatures('roads')
runtime.getIssues()
runtime.destroy()
```

Loading prepares all document layers before replacing the previous content. Failed preparation preserves the previous document, layers and view. A newer load, `cancelPreparation()` or `destroy()` aborts pending work; a late response cannot replace current content even if the fetch implementation ignores its signal. Callers should handle rejected load promises, including `AbortError`.

An external map, its controls, interactions and unrelated layers remain caller-owned. Destruction removes only runtime layers and restores the original view if the host has not installed another view. A runtime-created map is disposed. `getDocument()` returns a detached copy of the loaded definition; live camera movement and direct native layer mutations are not written back. Unsupported objects remain in the document and appear in `getIssues()`.

`updateDocument(document, signal?)` reuses native layers, shared full sources and the current map view when only node presentation changes. Visibility, opacity, zoom limits, styles and node filters update in place; clearing a filter restores the unfiltered style. Every style is compiled before any presentation is applied. Resources, view definitions, node order, hierarchy or node identity changes use the prepared replacement path. `getDocument()` reflects successful updates. The factory also exposes `updatePresentation(document)`, returning `false` when replacement is needed without modifying current content.

Viewer uses controller binding with this document runtime. Desktop vector creation shares `createOlVectorLayer(definition, source)`, which wraps a caller-owned editable source without changing feature IDs or taking ownership of that source. Desktop still owns its map synchronization, service authentication and editing interactions; its full document-runtime migration remains unfinished.

Resource replacements preserve the current View object and navigation when the document identity and selected view declaration are unchanged, including navigation during preparation. A changed view declaration or document identity installs the declared view. Metadata, unused resources and unsupported 3D definitions update the retained document and capability issues without rebuilding native 2D content.

Runtime cancellation rejects promptly even when a fetch implementation ignores its signal. Direct factory cancellation immediately releases already prepared content, but its promise may still await that non-cooperative fetch; callers requiring prompt completion should use the runtime. Late results are disposed and cannot install content.

This entry does not add selection interactions or recreate host widgets. Exceptions thrown by host listeners during native presentation setters are outside the transaction guarantee; declarative validation and style compilation finish before those setters run.

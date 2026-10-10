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

也可 `new CitySceneRuntime(viewer, options)` 使用已有 Viewer；直接构造默认销毁该 Viewer，可设置 `ownsViewer: false` 保留宿主实例。工厂接收已有 Viewer 时默认由宿主持有，使用 target 创建时由运行时持有。

`createCityRuntime` 同步创建 Viewer，资源挂载由 `updateScene` 驱动，须捕获异步错误。相同资源的显隐/变换/Popup 更新复用图层；资源变化、删除及销毁清理旧实例。`setCamera/getCamera/flyTo/getNativeViewer/layers` 提供常见能力及 Cesium 原生出口。没有自动二三维相机联动或二维样式转换。

`resolveResource(url)` 可返回宿主鉴权 Resource，场景中不保存令牌。没有 Cesium ion 默认网络资源，未配置底图时使用 Cesium 自带世界影像，未配置地形时使用椭球。部署须复制 Workers、Assets、ThirdParty、Widgets，并设置资源基址；见独立消费者示例。

Cesium 为 peer dependency。首版 0.1.0，MIT；尚未发布 npm。
## 绘制与编辑模式

`runtime.startDraw({ type: 'point' | 'polyline' | 'polygon', heightMode: 'ground' | 'absolute' })` 返回核心 `DrawSession`。完成返回图形纯配置，由宿主更新 CityScene v2 并调用 `updateScene`；取消不修改配置。水面也可以由 polygon 结果生成。运行时协调绘制与模型编辑的切换、Popup 和拾取状态；`cancelDraw()` 取消当前绘制，权威场景更新及销毁也会取消会话。

`setPreview(true)` 停止编辑/绘制并允许点击弹窗，`setPreview(false)` 关闭弹窗、保留选择事件。它管理交互状态；面板布局由宿主 UI 管理。`onSelect(id, properties)` 的第二个参数为拾取构件的实际属性，可用于属性面板和 Popup 字段预览。锁定对象禁止模型编辑；重命名、锁定、颜色和图形样式修改复用已加载资源。

`startGraphicEditing(id, { onChange })` 返回 `EditSession`，提供点位置和线面顶点移动、增删及精确坐标输入。完成结果包含 `id/before/after/changed`，宿主确认后更新场景一次；取消恢复层内原几何。`cancelGraphicEditing()` 或 `stopEditing()` 清理会话。权威场景更新、绘制/模型工具切换、预览和销毁会取消未完成的顶点修改；迟到的取消结果不会恢复其他工具正在禁用的拾取。

`setSelected(ids)` 设置图形、GeoJSON、3D Tiles 和模型的临时高亮，不写入场景协议。取消选择恢复原样式；GeoJSON 更新场景颜色后取消选择恢复最新配置。`onSelect(id, properties, selection)` 透传 Ctrl/Shift 修饰信息，宿主自行决定多选语义。图形 `style.labelField` 和属性在编辑器、只读 Viewer 共用渲染逻辑，属性更新后标签同步更新且无需重新挂载资源。

运行时按 `groups` / `groupId` 计算成员的实际显隐和锁定；隐藏组不覆盖对象自身的 `visible`，锁定组会禁止成员几何与模型编辑。重命名、排序和分组移动复用原生资源；持久化、批量命令和历史由宿主负责。
# v3 文档适配（实施中的 API）

`projectCesiumDocument(document, viewId?)` 校验 v3 文档并生成现有 CitySceneRuntime 可消费的投影。它保留完整文档，二维 tile/vector 节点返回 `cesium.unsupported` 问题；嵌套三维分组的显隐和锁定仅在投影中派生，原始本地状态不改写。未知必需扩展阻止投影，无法准备的原生资源明确报错。

`createCesiumDocumentRuntime({ document, viewId, viewer?, target?, signal?, ...options })` 创建并等待原生图层与环境加载后返回 `{ runtime, issues, getDocument, updateDocument, destroy }`。`getDocument()` 是最近成功投影的完整文档隔离副本，`issues` 随成功更新变化。原生底层编辑仍需宿主更新文档，运行时不持有编辑历史。

`updateDocument(document, signal, { reload: true })` 强制准备新的图层后替换，可用于资源重试；失败保留已显示内容和最后成功文档。普通资源替换和强制重载都保留用户当前相机，只有文档初始相机变化或切换到不同文档 ID 才应用声明的相机。用户导航不自动写回文档；宿主完整保存可显式读取当前相机。

`updateDocument(document, signal?)` 校验后原位更新已就绪对象的显隐、变换、质量、Popup、图形和环境显示属性；相机声明不变时保留用户导航。资源或环境来源变化走 `replaceScene`：隐藏准备候选资源，成功后替换，准备失败保留上一投影。取消立即结束等待，即使加载器未响应取消；后续更新及销毁使旧准备失效并清理迟到资源。可作为 scene-core 的 `bindSceneRuntime` 目标，权威文档和历史由宿主持有。低层 `updateScene` 保留既有增量行为，不能替代这个支持取消的适配器。

准备阶段的保护不等于同步原生 setter 抛错或重入时的完整事务回滚。外部 Viewer 中的自定义图层由宿主拥有；文档内管理图层由运行时负责释放。三维共享二维节点仍返回能力问题，不静默改写文档。

`createCityRuntime` 支持已有 `viewer`，默认由调用方拥有，销毁时保留 Viewer 并移除自有图层、恢复原地形、光照和时间。自行通过 target 创建的 Viewer 随 Runtime 销毁。直接 `new CitySceneRuntime(viewer, options)` 延续旧的拥有 Viewer 行为，接入外部 Viewer 时显式传 `ownsViewer: false`。

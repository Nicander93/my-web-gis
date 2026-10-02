# @desktop-webgis/cesium-tileset-edit

3D Tiles / GLB 整体变换编辑器，无应用 store 或 UI 框架依赖。

```ts
import { TilesetEditor } from '@desktop-webgis/cesium-tileset-edit'
const editor = new TilesetEditor(viewer, {
  translationSnap: 1,
  rotationSnap: 5,
  onPreview: event => console.log(event.after),
  onCommit: event => history.push(event), // 一次拖动只提交一次
  onCancel: () => console.log('已取消')
})
editor.startEditing(cityLayer)
editor.setMode('rotate') // translate / rotate / scale
editor.stopEditing()
editor.destroy()
```

平移有东/北/高轴及 XY 平面，旋转有三个环，缩放为等比缩放。输入需实现 `TransformLayer`：`id/pivot/boundingSphere/getTransform/setTransform`，可使用 cesium-layer 的图层或宿主适配器。

拖动只预览运行时；松手触发 `onCommit({id,before,after})`，由宿主维护持久化和撤销。Esc、失焦、切换工具、销毁取消当前拖动并恢复相机原始 `enableInputs` 值。监听、手柄和资源全部随 destroy 清理。不是单建筑网格编辑器；不改写源 tileset 或 GLB 文件。

Cesium 为 peer dependency。首版 0.1.0，MIT；尚未发布 npm。交互参考 [cesium-demo](https://github.com/Nicander93/cesium-demo)，源码独立实现。

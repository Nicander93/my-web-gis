# @desktop-webgis/cesium-popup

跟随世界坐标的 DOM 属性弹窗，无 React、编辑器或图层包依赖。

```ts
import { Popup } from '@desktop-webgis/cesium-popup'
const popup = new Popup(viewer)
await popup.open({ position, properties: { name: '中心大厦' } }, {
  title: '建筑', fields: [{ field: 'name', label: '名称' }]
})
popup.close()
popup.destroy()
```

支持普通字符串、字段配置、宿主提供的 `HTMLElement` 或异步回调。字符串和属性用 `textContent` 渲染，不解析 HTML；自定义 HTMLElement 的安全性由宿主负责。关闭或销毁后，迟到的异步结果不会重新打开弹窗。背向相机或超出视口时隐藏，销毁时移除 DOM 与 postRender 监听。

`formatPopupValue` 可格式化空值和对象属性。Cesium 为 peer dependency。首版 0.1.0，MIT；尚未发布 npm。

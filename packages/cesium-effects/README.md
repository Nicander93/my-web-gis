# @desktop-webgis/cesium-effects

`WaterLayer` 和可恢复宿主设置的 `CityEffects`，无 UI 框架依赖。

```ts
import { WaterLayer, CityEffects } from '@desktop-webgis/cesium-effects'
const water = new WaterLayer({
  id: 'lake', boundary: [[116.39,39.90,0],[116.40,39.90,0],[116.40,39.91,0]],
  height: 2, color: '#238bafcc', amplitude: 4, frequency: 1000, speed: .02
})
await water.addTo(layers)
const effects = new CityEffects(viewer)
effects.update({ fog: .2, bloom: true })
effects.destroy() // 恢复原始 fog/bloom 参数
```

边界使用 WGS84 经纬度；所有顶点按 `height` 的椭球高度生成水平水面。材质来自公开 Cesium Water API，需要复制 Cesium Assets 中的法线纹理。可见且速度大于零时请求连续渲染；隐藏或移除后停止监听。参数更新通过替换 WaterLayer，场景运行时负责该流程。

首版支持动态波纹、高光、水位、颜色、波幅、频率和速度，**不含平面镜面反射**。没有移植 cesium-demo 中涉及反混淆来源和私有渲染接口的反射实现。

Cesium 为 peer dependency。首版 0.1.0，MIT；尚未发布 npm。

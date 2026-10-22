# P6：MBStyle 与可选 WebGL 后端

P6 在原 P1–P5 基础上扩展发布和浏览渲染。默认仍使用 SLD 发布、Canvas 渲染；启用增强需要明确的兼容性证据。

## WebGL 浏览后端

Viewer 二维场景标题区提供“二维渲染”选择，也可使用 `?renderer=webgl`。选择会重新加载 Viewer，参数不写入 SceneDocument、Project 或编辑历史。Desktop 编辑地图继续使用 Canvas，避免把现有选取、编辑、预览依赖未经验证地迁到 GPU。

`ol-style/createWebGLStylePlan` 将标准 MapLibre 绘制层编译成锁定 OpenLayers 10.10 的 flat style；每个标准绘制层使用一个原生 WebGLVectorLayer，共享原来的 VectorSource，保持复合符号顺序。不存在另一套需要保存的私有符号语言。

支持边界：

- 线、面、圆点；固定颜色/透明度、线宽、线帽、连接、固定虚线，圆半径和线宽的线性 Zoom 插值。
- MapLibre Zoom 与 OL Zoom 的一层差已转换，保留 minzoom/maxzoom 半开区间及显隐。
- 几何类型过滤可转换。属性过滤、复杂表达式、图片/文字、未核实的 paint/layout 属性会报告具体路径，整 GIS 图层回退 Canvas，不混搭丢失效果。
- 带节点过滤、选取或弹窗交互的图层保持 Canvas；无标准样式的旧节点也保留 Canvas。
- 无 WebGL 时保留 Canvas；渲染后的真实 GPU context loss 会切换到已准备好的 Canvas。Viewer 状态区显示原因。销毁释放 GPU layer/context，不释放宿主拥有的 Source。

## 实测与启用决策

[webgl-benchmark.json](webgl-benchmark.json) 保存环境、实际后端、真实像素读取、要素数、准备时间和五次热帧样本。该次 Chromium 实际 renderer 为 **ANGLE / SwiftShader**，属于软件 WebGL，不能用作实体显卡或原生 Tauri 性能证据。

在该环境中，WebGL 的 1 万/5 万点热帧比 Canvas 慢。因此本次**不启用自动后端选择，也不承诺 GPU 提速**；WebGL 为显式可选的浏览适配器。准备时间包括源数据和样式准备，热帧计时覆盖 `rendercomplete` 调度；初始 `readPixels` 不计入热帧，不将调度时间等同 GPU 完成时间或稳定 FPS。

`webgl-baseline-*-canvas.png` 与 `webgl-baseline-*-webgl.png` 是相同数据、View、512×512、1 倍像素比的配对输出，覆盖圆点、实线、半透明面和双层道路。保留抗锯齿、轮廓和顺序差异，不设置主观像素一致阈值。

验证入口：

```powershell
pnpm --filter @desktop-webgis/ol-style test
pnpm --filter @desktop-webgis/ol-scene-runtime test
pnpm --filter @desktop-webgis/desktop exec playwright test --config playwright.cartography-webgl.config.ts
```

浏览器包含 Viewer 后端入口与交互回退、真实点线面绘制、双层道路、文字回退、`WEBGL_lose_context`、源数量保持、1 万/5 万点样本、销毁后无残留 Canvas。Node 测试另覆盖无 GPU 环境回退、宿主 Source 共享与幂等释放边界。

## 集成回归

2026-10-22：相关 8 个包共 517 项、Desktop 384 项单测通过（合计 901 项；6 项既有条件跳过）。依赖链、Desktop、Viewer 类型检查和生产构建通过。

- [制图工作流：11 项](browser-workflows.results.json)：包括 SLD / MBStyle 两种真实发布、加载 WMS、工程关联和凭据隔离。结束用例前等待路由完成，避免未完成的图块请求污染下一例。
- [Viewer 历史工作流：5 项](viewer-workflows.results.json)：旧/新版文档、弹窗、显隐、实际 GLB 准备、二维/三维入口。
- [WebGL 工作流：2 项](webgl-workflows.results.json)：新后端选择、GPU 真实绘制、兼容回退和资源生命周期。
- [扩展安装后的 SLD 回归：11 例](sld-regression.results.json)：保留默认发布路线，含复合道路、字体/halo、SVG 和面图案的真实 GetMap/GetLegendGraphic 验证。

实验服务器和下载缓存放在忽略目录 `.cache/cartography-geoserver/`，与 Playwright 输出分开；Viewer 历史测试也使用专属输出目录，避免清理其他验收缓存。5174 是其他项目的服务端口，本轮 Viewer 回归使用独立的 5187。

恢复后的实验环境使用固定 GeoServer 2.28.2、匹配的 MBStyle 扩展及 Java 17；[下载来源与 SHA-256](lab-environment.json) 随证据保存。新实例上重新通过了 SLD 11 例和 MBStyle 2 例；其中图例绘制同时确认了 Java 字体库可用。

## MBStyle 发布

详见 [MBStyle 验收记录](mbstyle/README.md)。只有服务只读模块清单明确确认匹配的 MBStyle 扩展时才开放此路径；用户服务不通过偷偷上传样式来试探能力。未实测的表达式和资源必须报告限制。

参考：[OpenLayers WebGLVector API](https://openlayers.org/en/latest/apidoc/module-ol_layer_WebGLVector-WebGLVectorLayer.html)。当前实现以仓库锁定的 10.10 源码及实测为准，不假定文档中后续版本能力已可用。

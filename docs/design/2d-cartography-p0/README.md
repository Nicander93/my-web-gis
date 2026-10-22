# 二维制图 P0 验收报告

日期：2026-10-21。依据[技术设计 V1.1](../2d-cartography-technical-design-v1.1.md)，代码从 `11ab46b` 开始，分支为 `codex/2d-cartography`。

## 结论

固定本地 VectorSource 的五组 Canvas 案例通过，可继续 P1 契约和迁移。此结论不代表完整 MapLibre 规范兼容，也不授权直接删除旧样式实现。当前产品仍使用既有项目格式和编译器；编辑器、SLD、GeoServer 发布尚未实施。

## 实现与版本

| 依赖 | 实际锁定版本 | 依据 |
| --- | --- | --- |
| OpenLayers | 10.10.0 | 现有锁文件与安装解析结果；本轮未升级 |
| ol-mapbox-style | 13.8.0 | 精确版本，实际对 OL 10.10.0 构建和运行验证 |
| @maplibre/maplibre-gl-style-spec | 26.4.1 | 精确版本，与适配器自身规范依赖一致 |

实验入口位于 `packages/ol-style/src/cartography.ts`，不从旧主入口导出。使用标准 `StyleSpecification` 和 `validateStyleMin`，不另建表达式语言。对实际目标 VectorLayer 调用 `applyStyle(..., { updateSource:false })`，不修改 Source、要素、显隐、不透明度或地图所有权。

每次更新复制样式，避免库向调用方对象写入内部 `id`，并清除副本中的该内部字段，防止复用过期表达式缓存。资源加载串行执行，尚未启动的输入只保留最新请求；资源失败不会使后续更新永久失效。SVG 和 sprite 加载后的重绘作用于真实目标层。

这里的完整 Style 对象仅用于运行时，有效 source 对象包含空 FeatureCollection 作为描述，实际要素始终来自已有 OL Source。它不等于可独立加载业务数据的样式导出包。

## 能力矩阵与截图

左右画布采用同一个固定数据源和相同视图；右侧独立 OL 样式用于技术对照。字体、文字排版和抗锯齿可能不同，本次未建立逐像素等价门槛，也不将此作为产品 UI 视觉签收。

| 案例 | 结论 | 证据与边界 |
| --- | --- | --- |
| 属性分类 + Zoom 线宽 | 通过 | `match` 与 `interpolate(zoom)` 同时使用；真实样式函数核对三个 Zoom；[截图](classification.png) |
| 双层相交道路 | 通过 | casing/inner 绘制子层有确定 zIndex 顺序，固定 OL 参考使用相同线宽公式；[截图](casing.png) |
| 本地 SVG 点图标 | 通过 | 已解码 SVG 通过 `getImage` 提供，右侧使用 OL Icon；[截图](icon.png) |
| 中英文沿线标注 | 通过，有限制 | `symbol-placement:line`、本机字体；短重复间距会抑制长名称，详见下文；[截图](labels.png) |
| 本地 sprite 面图案 | 通过 | sprite 请求成功、样式引用 `park-hatch`、Canvas 实际绘制；右侧使用同一图像的 CanvasPattern；[截图](pattern.png) |

完整采样和样式属性见 [canvas-evidence.json](canvas-evidence.json)。图案判断结合资源响应、样式资源引用、非透明像素和截图，不以某一个精确 RGB 值判断透明纹理是否存在。

其他行为验证：

- 原始 Source 和初始化捕获的 Feature 引用保持一致；选择集合中的要素平移后，几何范围实际增加 `dx=12`、`dy=0`。
- 固定 GIS-like 图层顺序保持，标准子层 `visibility`、`filter` 重新求值，OL 整体图层显隐与不透明度属性保留。
- 非法版本和表达式拒绝应用，已有样式保留；异步更新请求合并、加载先后顺序和失败后恢复有回归测试。
- 无外网请求、失败请求或页面异常。示例未接入生产图层树、Inspector 或完整指针编辑工作流；上述身份与几何检查不能替代端到端编辑验收。

### Zoom 与标注边界

当前默认 OL View 使用 256px 分辨率体系，MapLibre 使用 512px 体系，同一分辨率下 `zOL = zMapLibre + 1`：

```text
resolution = 156543.03392804097 / 2^(zMapLibre + 1)
```

已核对 MapLibre Zoom 8、12、16 对应 OL Zoom 9、13、17，casing 线宽在端点分别为 5 和 11。自定义 CRS/分辨率体系需显式传入 resolutions，不能把该换算当作通用比例尺公式。

初始 `symbol-spacing:48` 时未绘制较长的中英文道路名称；改为 250 后通过。该版本适配器将间距乘 2 设置为 OL Text repeat，并对沿线文字使用 `overflow:false`；本例对应 96px 与 500px 的重复段。密集重复、长名称、短线和冲突避让必须继续验证，不能静默调整用户样式。字体通过本地 CSS 引用已安装的 Segoe UI，中文采用系统字形回退，跨机器的字体一致性尚未验收。

## 性能样本

[原始数据](performance.json)：Windows Headless Chrome 153.0.8010.12。六次连续样式更新耗时为 8.4、1.5、1.8、2.0、2.1、2.6ms；排序后取上中位数为 **2.1ms**。这是小样本更新成本，不是持续拖动或长期会话压力测试。

独立 800×500 OL Canvas 中建立 1000 条固定线，地图 View 内要素数为 1000，采得 7070 个非透明像素；样式应用约 **2.1ms**，从请求绘制、等待 rendercomplete 到采样约 **23.9ms**。该 Canvas 的 DOM 位于屏外，但要素位于其地图 View 内；数字包含采样开销，不等于前台合成帧时间或 FPS，不推断 GPU、原生 WebView、海量数据或生产交互表现。

## 复跑

在仓库根目录执行：

```powershell
pnpm --filter @desktop-webgis/ol-style test
pnpm --filter @desktop-webgis/ol-style build
pnpm --filter @desktop-webgis/desktop build
pnpm --filter @desktop-webgis/desktop build:cartography
pnpm --filter @desktop-webgis/desktop test:e2e:cartography
```

本次依次通过：45 项 Vitest、包 TypeScript 构建、Desktop TypeScript/Vite 默认构建、独立构建、Playwright 专测 1 项（0 跳过/失败/重试）。`pnpm install --lockfile-only --frozen-lockfile --ignore-scripts` 和 `git diff --check` 通过。

默认产品构建不含 Spike 页面、脚本或资源。独立构建位于 `apps/desktop/test-results/cartography-spike/build`；运行 `pnpm dev` 后，可访问 `http://127.0.0.1:5173/cartography-spike.html`。复跑生成的 JSON/截图位于 `apps/desktop/test-results/cartography-spike`；本目录保留本次审查快照，不由测试自动覆盖。

## P1 仍需完成

项目版本和幂等迁移、稳定绑定 ID、实际图层树顺序转换、图例、保存重开、旧分类/分级边界、统一 Undo/Redo，以及与即时编辑事务的接入。生产采用前还需核对持续更新和关闭/重开时的资源与编译缓存生命周期。

本次未验证 VectorTile、铁路等复杂工程线型、完整 Style v8 属性/表达式集合、多浏览器、原生 Tauri、GeoServer 或 WebGL。具体范围和后续状态见[实施记录](../../plans/2d-cartography-implementation.md)。

API 依据：[OpenLayers applyStyle](https://openlayers.org/ol-mapbox-style/functions/applyStyle.html)、[stylefunction](https://openlayers.org/ol-mapbox-style/functions/stylefunction.html)、[MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/)。

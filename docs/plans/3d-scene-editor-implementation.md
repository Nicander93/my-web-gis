# 三维场景编辑器 V1 实施记录

设计基线：[技术设计 V1](../design/3d-scene-editor-technical-design-v1.md)。二维体验基线：[Desktop 设计系统 V1](../design/desktop-design-system-v1.md)。本轮从干净的 `main@619fb3c` 开始，实施分支为 `codex/3d-scene-editor-v1`，Cesium 实际锁版本为 **1.145.0**。

## P0：审计与差异

| 项目 | 基线状态 | 本轮处理 |
| --- | --- | --- |
| Shell / Ribbon / Design Tokens | 二三维已共用壳层、Ribbon、主题和布局存储 | 保留既有边界；不合并两套业务模型或渲染引擎 |
| Dock | 三维已使用左右 DockWindow，但右侧仍显示默认“图层属性”并重复自绘标题 | 使用对象属性/场景设置标题；复用二维工作栏的控件与样式，并预留同一工具栏宽度 |
| 选择与工作目标 | 已有选择、编辑目标和 pinned 属性目标 | 保留点击只选择；属性/场景工作栏显式打开；完整属性窗口捕获对象 ID、epoch、原始定义和拾取字段 |
| 检查器层级 | 属性子页只能从右键访问 | 增加配置/样式/属性/源子页，低频复杂编辑留在完整属性窗 |
| 参数行 | 旧原生控件与新 Ant Design 控件混用 | 本批迁移名称、分组、设备画质、环境开关、连续输入和新增参数编辑；不顺手重写空间编辑工具 |
| Tileset Style | 没有持久化样式；高亮暂存旧 style | 在原协议添加原生 Style JSON；高亮与最新持久样式独立，增加实际要素预检和新瓦片加载防护 |
| 参数协议 | 只有 SSE/cache，运行时/只读/动作边界不清 | 增加薄描述表和明确适配；六个可写性能参数、Style、资源重建、只读内存和缓存动作 |
| 工程协议 | ProjectSnapshot → CesiumScene v2 → SceneDocument v3 | 通过现有 spread 投影保留新字段，并增加工程保存和往返测试；不新增场景或 History 系统 |
| 场景环境 / 设备画质 | fog/bloom/lighting 已在项目；DPI/MSAA 在本机 persist | 保持边界，原生代码导出场景环境，设备偏好不导出 |
| 原生代码导出 | 仅 OpenLayers 生成器，遇到三维拒绝 | 独立 CesiumJS 模块生成器、能力报告和文件菜单入口，与 Scene JSON 分开 |

## P1–P4：实施范围

- **P1**：右侧共用工作栏、真实 Dock 标题、明确对象子页、完整属性入口与固定目标；新控件消费已有 Ant Design 主题和密度。连续文本/数值在 Enter 或离开时提交，Esc 放弃本次输入。
- **P2**：Tileset `style` 原生 JSON 随工程与 v3 保存。完整属性窗支持颜色、基于实际拾取字段的条件规则及 JSON 草稿；未知合法字段不丢失。JSON/原生语法错误保留文本并阻止应用；元数据不兼容的样式预检失败不提交。预览和选择高亮不写入工程，取消恢复已应用值。
- **P3**：先交付 Tileset 试点，具体覆盖见下表。描述表只驱动呈现和校验；运行时显式调用支持的属性，不对任意 Cesium 对象动态赋值。资源地址复用既有候选准备与成功替换流程。Imagery、Model、Scene 的更高覆盖参数表仍按后续批次扩展，不能将试点称为全部公开 API 已覆盖。
- **P4**：沿用当前空间编辑、一次手势一次历史、项目环境保存和资源引用方式。增加原生 CesiumJS 导出预览/诊断/保存窗口，只依赖 `cesium`，目标固定为 1.145.0。场景 JSON 仍使用现有导出；不把资源复制进工程。

### Tileset 参数覆盖表

默认值来自锁版本源码与当前兼容运行时；`cacheBytes` 特别保留旧工程的 256 MiB 缺省值，Cesium 原生默认 512 MiB 不冒充本产品的实际值。

| API | 生命周期 | UI / 保存 / 运行时 / 原生 JS |
| --- | --- | --- |
| maximumScreenSpaceError | runtime | 数值、搜索、复位；项目/v3/预览/历史/JS |
| cacheBytes | runtime | 字节数、搜索、复位；项目/v3/预览/历史/JS |
| dynamicScreenSpaceError | runtime | 开关；项目/v3/预览/历史/JS |
| dynamicScreenSpaceErrorDensity | runtime | 数值；项目/v3/预览/历史/JS |
| dynamicScreenSpaceErrorFactor | runtime | 数值；项目/v3/预览/历史/JS |
| skipLevelOfDetail | runtime | 开关；项目/v3/预览/历史/JS |
| style | runtime | 专用 JSON/规则草稿；项目/v3/预览/历史/JS |
| url | recreate | 资源定义的数据源地址；候选准备后替换，失败保留运行实例；不伪装为节点上的持久化字段 |
| totalMemoryUsageInBytes | readonly | 实际 Cesium 读数，按需刷新；不进入项目或历史 |
| trimLoadedTiles() | action | 卸载未使用缓存；不进入项目或历史 |

未在表内的 API 不显示为已支持。只读项和方法不计入可配置参数数量。新字段均为 CesiumScene v2/v3 的可选兼容扩展，旧文件无需改版本号即可读取；现有解析器和两种 JSON Schema 同步校验，新旧保存往返保留原始 Style JSON。

### 独立代码输出边界

生成器支持相机、场景 fog/bloom/lighting、底图/地形、Tileset 原生样式与参数、GLB 地理位置及 ENU 变换、GeoJSON、XYZ 影像和基础点线面。分组显隐向下继承，未设置的 Tileset 缓存参数显式采用产品的 256 MiB 默认值。提供 `createScene(viewer, hooks)` 与 `mountScene(container, options)`；清理只释放本次创建的对象，向已有 Viewer 加载时中途失败也会清理已创建资源。本地资源和凭据通过 `hooks.resolveResource` 注入。未覆盖的水面、裁剪/压平、矩形/椭圆、图标/标注和扩展会明确阻止导出，二维内容省略时发出诊断。

源项目仍保留完整信息；导出能力报告不修改工程。原生模块不包含自研 SDK import、本机授权桥接 URL 或已解析的凭据。外部资源可达性依赖部署环境；不承诺不同 GPU 的像素级一致。

## P5：验证与剩余验收

验证过程检查真实状态、数据、历史、持久化和资源请求。没有新增截图或逐像素验收要求，自动化失败产生的诊断截图不作为产品签收。

本轮完成 P0 审计、P1 交互改造、P2 样式闭环、P3 Tileset 参数试点和 P4 支持范围内的编辑/导出。P3 的其他对象参数表和 P5 的真实生产数据验收仍有明确后续范围；功能自动化通过不表示用户已经签收三维界面与交互质量。

| 级别 | 本轮结果 |
| --- | --- |
| 协议 / 运行时 / Layer / Codegen | 全仓单测 1,032 通过、6 跳过；本轮关键包分别为 Cesium Schema 29、v3 Schema 27、Layer 39、Runtime 42、Codegen 11 项通过 |
| Desktop 单元与构建 | Desktop 398 通过、5 跳过（计入全仓数）；全仓构建通过，最后导出修复后 Codegen/Desktop 再构建通过 |
| 浏览器 1440×900、1024×680 | 专用集 28/28 通过；覆盖工作栏、参数提交、样式草稿/预览、Undo/Redo、导出/重开、固定目标和二维回归 |
| 独立 CesiumJS 输出 | 最终模块两档视口 2/2 通过；真实 WebGL2 加载 Tileset/GLB/Graphic/环境、缓存默认值、ENU 位移和资源销毁 |
| Windows / WebView2 本地引用 | 隔离应用标识与用户目录，9 组实际资源场景通过；两档 CSS 尺寸精确匹配，实际 RTX 5070 / D3D11 / WebGL2 |
| 用户真实生产数据 | 待提供本机倾斜摄影、大模型、影像和地形目录后验证；仓库示例不代替真实大数据性能结论 |
| 用户体验与视觉签收 | 由用户复核，自动化功能结果不代替产品签收 |

执行入口：`pnpm --filter @desktop-webgis/desktop test:native-scene-editor`。此入口复用本地嵌套 Tileset 子 URI、GLTF 外部 buffer/纹理、相对引用保存/进程重启、目录重定位和授权隔离的现有验收流程，不替代 Windows 系统选文件对话框的手动测试。

验收记录与原生报告归档在 [三维编辑器验收证据](../design/3d-scene-editor-acceptance/README.md)。其中 Windows 原生报告明确记录未验证系统文件选择器与系统 125% 缩放，不能从 WebView2 的两档 CSS 尺寸验证推导这两项通过。

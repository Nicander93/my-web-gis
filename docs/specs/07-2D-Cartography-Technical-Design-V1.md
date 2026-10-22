# my-web-gis · 二维制图系统技术设计 V1

> 状态：设计基线 / 待实施；日期：2026-10-21  
> 代码基线：`Nicander93/my-web-gis`，`main`，提交 `015774120577546514baadd30cc22b1c79d9dbe4`（2026-10-11）。  
> 适用范围：二维矢量制图、标注、符号资源、SLD 单向导出和 GeoServer 样式发布。  
> 本文是 **目标设计**，不代表所列能力已在仓库实现；不包含三维实施、SLD 导入、GeoServer 全量数据发布实现细节。

## 0. 结论与约束

**目标**：以 MapLibre Style Specification v8 作为二维样式的规范基础；使用 OpenLayers 继续承载 GIS 地图操作；优先通过 `ol-mapbox-style` 将样式应用于 OpenLayers **Canvas** 矢量图层；SLD 作为**单向输出**，用来支持不具备 MBStyle 扩展的 GeoServer。保留未来 WebGL 后端的适配空间。

已确定的产品决策：

1. GIS `Dataset` / `Layer` 仍是项目级业务对象；**一个 GIS Layer 对应一个数据集和多个 MapLibre Style Layer**，对用户仍表现为一个图层树节点。
2. 主样式编辑器使用先前认可的 **V4 紧凑布局**；专业符号编辑使用双栏窗口；符号库选择与符号库管理分离。避免装饰图标、教学式常驻文案和卡片堆叠。
3. 常用参数直接编辑，复杂表达式、符号图层、数值断点、Zoom 动态参数等按需弹窗。**修改立即在地图中生效**；撤销/重做和项目保存统一管理。
4. 单一/分类/分级/规则是**编辑器交互与样式生成方式**，并不意味着底层互斥；表达的最终结果为多个标准 Style Layer 与 `filter` / `paint` / `layout` 表达式。
5. 内置专业符号库和色带库；预设可选择后继续编辑；项目应能独立还原已使用资源。
6. **不开发 SLD 反向导入**；导出可提示降级或拒绝不兼容样式，不静默丢失效果。
7. GeoServer 是**外部连接**；用户选择连接、Workspace、Store、目标 Layer，发布后可选择将 WMS 等服务图层加载回工作区。保存项目不等于更新服务端。

设计约束：保留现有 React/Tauri 2、Zustand、OpenLayers、GIS Core、项目/图层管理；不为制图需求整体更换地图引擎；三维不直接套用二维符号模型。

---

## 1. 当前代码审计（已实现 vs 目标）

| 领域 | 当前代码 | 目标变化 |
|---|---|---|
| 样式契约 | `packages/ol-style/src/types.ts`：`SingleStyle \| CategorizedStyle \| GraduatedStyle`，含简单点线面和一个 `LabelConfig` | 标准 MapLibre `LayerSpecification`/表达式为主，不再扩展旧互斥类型 |
| 编译渲染 | `packages/ol-style/src/compiler.ts`：自行编译 OpenLayers StyleFunction，主要使用要素属性 | 用 `ol-mapbox-style` 作为默认适配器；缺陷补丁必须小且受测试约束 |
| 样式 UI | `StylePanel.tsx`：基于草稿、点击“应用” | V4 布局，实时生效；可编辑结构化表达式 |
| 标注 UI | `LabelPanel.tsx`：字段、字号、色彩、描边、偏移、Zoom 输入 | MapLibre `symbol` 样式层 + 可选多规则标注 UI |
| 撤销与项目 | `project.store.ts`、`layer.commands.ts`：已有 `EditHistory` 和 `SetLayerStyleCommand` | 支持高频即时预览与按“用户操作”合并的一次撤销 |
| 数据模型 | `packages/gis-core/src/types.ts`：`Layer.style` 为旧式样式、`Layer.datasetId` 指向数据集 | 增加标准样式层集合与稳定映射，旧项目迁移 |
| 服务读取 | `ogc-io` / `ServiceConnectPanel`：读取 WMS、WMTS、WFS | 增加独立的 GeoServer REST 发布模块；不混入“连接并加载服务”模块 |

**代码版本注意**：桌面应用 `apps/desktop/package.json` 对 `ol` 使用 `^10.6.1`，`packages/ol-style/package.json` peer 范围为 `^10.10.0`。实施前应检查锁文件里实际解析到的 OpenLayers 版本，并统一工作区与适配库的兼容要求。此处不能仅依赖 `package.json` 文本断言安装版本。

**历史文件注意**：仓库中已有 React/Zustand 实现，而早期 V0.1 架构附件记载 Vue/Pinia；后者只作为产品原则和演进背景，不能作为本轮代码事实。

---

## 2. 设计分层与依赖方向

```text
                    Desktop React UI
       StyleEditor · SymbolEditor · LabelEditor
         SymbolPicker · PresetManager · Publish
                            │
                    Style Operations
             （查询、变更、分类生成、验证）
                            │
             MapLibre Style Spec v8 Model
                标准 Layer / Expression
                       + 资源清单
                            │
         ┌──────────────────┴───────────────────┐
         │                                      │
  OpenLayers Adapter                    Style Export Adapter
  ol-mapbox-style / Canvas               MBStyle   |  SLD 1.0
         │                                      │
  Existing OL Runtime                    GeoServer REST Client
         │                                      │
   Existing GIS Core                  远端校验、关联、预览
         └────────── Project / EditHistory ─────┘
```

模块职责：

- **Style Operations（无 OpenLayers 依赖）**：对标准样式 JSON 做语义化编辑、生成分类/分级表达式、验证、整理资源、生成图例语义，不自研另一套 `match/step/interpolate` 语法。
- **OpenLayers Adapter**：将标准 Style JSON 绑定到已有 `VectorLayer`/`VectorTileLayer`，处理资源、字体、错误反馈及变更刷新。Canvas 是 V1 的默认实现。
- **Style Export Adapter**：单向输出 SLD 1.0（初期）和可选 GeoServer MBStyle；附带兼容性报告，不处理 SLD 输入。
- **GeoServer REST Client**：连接、目标发现、样式上传与关联、远端版本/内容校验、回读及 WMS 验证。应隔离凭据；Tauri/Rust 作为优先的网络执行通道。
- **GIS Core / Project**：保留数据集、GIS 图层、显示顺序、项目保存和撤销历史的唯一所有权。

建议先在现有 `packages/ol-style` 内实现适配层与迁移，验证后再抽离 `style-core`/`style-io`，避免过早创建过多包。依赖方向必须始终是**领域编辑逻辑不依赖具体渲染器**。

---

## 3. 数据契约：GIS Layer 与 Style Layer

### 3.1 两种 Layer 明确区分

- **GIS Layer**：用户在项目图层树中操作的业务对象；拥有名称、`datasetId`、可见性、不透明度、过滤、图层顺序、项目操作入口。
- **MapLibre Style Layer**：表现规则，使用标准 `id`、`type`、`source`、`filter`、`minzoom`、`maxzoom`、`layout`、`paint`；多个 Style Layer 可以消费同一 Source。
- **Source**：MapLibre 规范中的数据描述；项目内部 `Dataset` 是实际数据和凭据管理实体。二者通过稳定 source key 映射，不重复保存海量 GeoJSON 数据。

示意（字段名为**项目绑定层设计草案**，不是新样式语言）：

```ts
interface GisStyleBinding {
  gisLayerId: string
  datasetId: string
  styleSourceId: string       // 如 ds_<dataset-id>
  styleLayerIds: string[]     // 顺序保留，ID 不因重命名而变化
}

interface CartographyState {
  specVersion: 8
  styleLayers: LayerSpecification[] // 直接采用 MapLibre 标准对象
  bindings: GisStyleBinding[]       // 仅用于 GIS 项目与样式的映射
  assets: ProjectStyleAsset[]      // 已安装/内嵌资源引用与内容哈希
}
```

`LayerSpecification` 应以锁定版本的 `@maplibre/maplibre-gl-style-spec` 所提供类型/校验器为依据；示意接口需要依据实际 API 调整。**数据契约原则**：只给项目层增加必要的关联数据，不发明新的颜色、宽度、过滤器 AST。

### 3.2 完整 Style JSON 与项目存储不是一回事

一个完全独立可用的 MapLibre Style JSON 必须包含能被消费端获取的 `sources`，以及所需 sprite/font 资源。项目中的文件、数据库或内存数据集可能没有公开 URL。因此：

1. **项目内部**以标准 `LayerSpecification` 表达样式语义；数据绑定由 Project 管理。运行时按 `Dataset` 组装/解析符合规范的 Style 对象供适配器使用。
2. 对本地 GeoJSON 绑定，可在**仅供运行时的组装对象**里使用可解析资源，或由现有 OL Source 配合 `updateSource: false`；不得把真实要素重复塞入每个样式快照。
3. **导出独立 MapLibre Style JSON**时，必须生成完整 `version: 8`、`sources`、`layers`、资源 URL/文件；如果无法提供可移植数据源，须提示“样式包依赖本项目数据”，不能宣称外部开箱可用。
4. `metadata` 允许保存 `my-web-gis:*` 编辑辅助信息（分类方法、预设 ID、图例名称、资源版本）；**绘制结果不能依赖这些 metadata**。
5. `source-layer` 仅适用于矢量瓦片 Source，普通 GeoJSON Source 不应加 `source-layer`。

### 3.3 层级与排序

```text
GIS Layer: roads (dataset-id=abc)
  ├─ roads-casing     line    / 线外描边
  ├─ roads-inner      line    / 道路内线
  └─ roads-labels     symbol  / 道路名称
```

基本规则：

- 一组 Style Layers 对应一个 GIS Layer，普通用户只看到一个 GIS 图层；符号内部编辑器可展示绘制子层。
- 按 GIS 图层树的上下关系组装**连续的 Style Layer 片段**，组内保持自下而上的绘制顺序。当前 GIS `rootOrder` 的顶部优先级与 MapLibre `layers` 的后绘制者在上方，需要明确方向转换并测试。
- **跨不同 GIS 图层交错插入 Style Layer** 不列入第一阶段；否则 `ol-mapbox-style` 按数据源聚合为一个 OL 图层的行为可能破坏全局叠放顺序。将来如需交错，采用多个 OL 绘制通道并验证成本。
- GIS Layer 的整体显隐、透明度和条件过滤与 Style Layer `visibility/filter` 分开管理；不要因为隐藏一个图层而删除样式子层。
- 图层树图例可以展示复合规则的图例摘要；复杂属性映射需要有确定的图例生成规则，不能简单读取一个 `line-color` 字符串。

### 3.4 规则和组合的具体表达

```json
{
  "id": "river-core",
  "type": "line",
  "source": "ds_river",
  "paint": {
    "line-color": ["match", ["get", "kind"], "main", "#267AB9", "branch", "#88BBDD", "#AABBCD"],
    "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 16, 5]
  }
}
```

主干/支流筛选使用独立的 `filter`；额外叠加的重点河流可用一条过滤的 Style Layer。**属性分类、Zoom 插值、附加规则可以同时生效**。高层 UI 使用分类表/分级表，是对标准表达式的可视化编辑，不是存储另一套互斥渲染类型。

---

## 4. 本地 OpenLayers 渲染适配

### 4.1 首版默认 Canvas

- 使用 `ol-mapbox-style` 的 `applyStyle(layer, style, { source, updateSource:false })`，或按需 `stylefunction()`；保留现有 GIS runtime 创建的数据源、要素、选择与编辑工具。
- 官方 `applyStyle()` 针对 `VectorLayer`、`VectorTileLayer`，可指定 `source`/`layers` 子集，并通过 `updateSource:false` 保留现有 OL Source。**这条路径是 Canvas 样式函数方案，不是 WebGL Shader 转换器。**
- 不用 `apply()` 无条件接管整个 Map；项目、数据及视图仍由 my-web-gis 管理。
- 样式变更时按 GIS Layer 定位受影响 Style Layers，更新对应渲染样式。对高频输入合并重新编译；异步载入 sprite/font 时用请求序号防止旧结果覆盖新状态。

### 4.2 能力缺口的处理

| 场景 | 首版路径 | 风险点 |
|---|---|---|
| 分类颜色 + Zoom 线宽 | 标准 `match/interpolate` | 缩放级别与 OL 分辨率映射需验证 |
| 双层道路 | 同源、连续 `line` Style Layers | 交叉口线外描边顺序、Canvas 实际效果 |
| 点符号/SVG | `circle` / `symbol` + sprite 或 `getImage` | SVG 资源可用性、彩色/单色图标 |
| 沿线标注 | `symbol` 的 `text-*`、`symbol-placement` | 字体差异、重复标注及冲突 |
| 面图案填充 | `fill-pattern` + sprite | 预览、图例和资源导出一致性 |
| 铁路枕木/复杂工程线型 | 先做能力验证 | 标准表达是否足够；不够时**明确标记为扩展/暂不支持** |
| 不同缩放范围显示不同内容 | `minzoom/maxzoom/filter` 或表达式 | MapLibre 过滤表达式中 Zoom 有特定求值限制 |

动态材质、GPU 性能等不是 `ol-mapbox-style` 自动带来的能力。WebGL 后端作为后续**并行适配器**，先确保相同样式得到足够接近的表现，再考虑智能选择渲染后端。

### 4.3 依赖版本治理

- 锁定兼容的 `ol`、`ol-mapbox-style`、`@maplibre/maplibre-gl-style-spec`，由 pnpm 锁文件统一管理。
- 单独建立渲染兼容集；升级依赖时跑“相同数据、相同 View、相同样式”的视觉回归和行为测试。
- 显式记录不支持的样式属性，适配器不能静默吞掉重要的渲染效果。

---

## 5. UI 与编辑状态（与现有原型对齐）

### 5.1 已认可的入口

| 功能 | 界面形态 | 定位 |
|---|---|---|
| 样式编辑 | 右侧 Inspector 中的 V4 紧凑主面板 | 高频分类、分级、规则列表及基础参数 |
| 符号编辑 | 独立双栏弹窗 | 左侧符号绘制层，右侧属性；支持多层道路和 Zoom 动态线宽 |
| 符号选择 | 紧凑网格/列表弹窗 | 搜索、分类、最近、收藏、选用 |
| 符号管理 | 单独资源管理器 | 导入、导出、分类、批量管理、自定义保存 |
| 标注编辑 | Inspector 标注标签 | 常用字段/字号/位置，复杂规则与避让按需弹窗 |
| 发布 | 图层上下文菜单及发布向导 | 目标选择、兼容报告、上传、验证 |

原型基线（交互原型，不是现有生产实现）：`my-web-gis-style-editor-v4.html`、`my-web-gis-line-symbol-editor-v1.html`、`my-web-gis-symbol-library-v1.html`。

### 5.2 可视化编辑器不得破坏未知表达式

- 对可识别的 `match/step/interpolate` 显示分类、断点、Zoom 节点等结构化编辑器。
- 对合法但 UI 不认识的表达式保留原始 JSON；显示“表达式”状态并提供高级编辑入口。
- 修改与表达式**无关**的属性时，原表达式的语义和 AST 必须保留；不能误写为固定值。
- 表达式校验使用标准规范或与之兼容的校验器；禁止 `eval()` 直接执行任意用户脚本。

### 5.3 实时更新 + 一次操作一次撤销

推荐 `StyleEditTransaction`，不是继续维护“未应用样式草稿”：

```text
begin('修改线宽')
  ├─ 保存 before 快照
  ├─ pointer/input 更新 → 修改渲染态 → 地图立即重绘
  ├─ 编辑目标不变，不污染项目 Undo 栈
commit()
  ├─ before/after 形成一次 SetLayerStyleCommand
  └─ 项目 dirty=true
```

- 对滑块、拖动选择器和连续颜色输入做事务合并；选择一个预设、完成一次分类，均作为一个 Undo 单元。
- 若用户在拖动中按 Ctrl+S、切换图层、关闭弹窗，先 `commit` 或显式中止当前操作；不能丢失已显示的改动。
- `Ctrl+Z/Ctrl+Y` 使用现有统一 `EditHistory`；Undo 后图例和地图同步。
- 迁移掉“应用/重置草稿”和 `StyleDraftDialog` 切换目标确认流程；**这属于既有行为迁移，不只是 UI 删除按钮**。
- 对样式 JSON / Sprite 哈希使用**内容基准**来维护保存状态；会话层只放编辑目标、弹窗状态、临时交互事务。

---

## 6. 专业符号资源体系

1. **系统内置库**：随版本发布、只读；按点/线/面、交通、水系、行政、土地利用等专业语义分类，支持搜索和标签。
2. **我的符号库**：用户可保存修改后预设、收藏、导入/导出。
3. **项目资源**：拷贝/打包项目实际使用的符号定义及相关资源，避免预设升级后破坏旧项目外观。
4. **颜色资源**：分类色带、连续色带，支持自定义保存和项目复现。
5. **资源引用**：使用稳定 ID + 内容哈希 + 资源位置；不可只保存外部临时 HTTP 地址。SVG/Sprite 资源需要执行安全检查，限制远程资源和不安全内容。
6. **来源与授权**：内置专业符号应记录来源、许可和适用领域；示例符号库中的大量程序生成符号不能直接宣称符合行业制图规范。

实现边界：MapLibre Style 中的复合符号优先通过**多个标准 Style Layer**表达；不另建与其平行、效果必须转换才能绘制的私有 `SymbolLayer[]` 语言。专业编辑器负责生成和编辑这样的 Style Layer 组合。

---

## 7. SLD 单向导出：支持矩阵与契约

**范围明确：只做 `MapLibre Style → SLD`；不做 SLD 导入。** 支持离线导出 SLD，也支持交给 GeoServer 发布工作流。

### 7.1 默认选择 SLD 1.0

首版 SLD 导出基于常见 GeoServer 能力，不依赖服务器插件。对更高级的 SE 1.1 / vendor options 暂不作无损承诺。SLD 规则包含 Filter、Symbolizer、比例尺分母等，绘制顺序需单独测试。

| 能力 | 首版转换结论 | 处理原则 |
|---|---|---|
| 固定点/线/面颜色、线宽、虚线 | 直接转换 | 精度和透明度做图像对比 |
| `match` 分类、`step` 数值区间 | 规则展开 | 保留空值与 fallback/else 逻辑 |
| 多 Style Layer 复合道路 | 分离 FeatureTypeStyle/Rule 处理顺序 | 测试线交叉口外描边 |
| `filter` 条件 | 常用布尔/比较子集可转换 | 未知算子报告不支持 |
| `minzoom/maxzoom` | 基于发布上下文转换为比例尺分母 | 显示换算假设与误差 |
| 连续 `interpolate(zoom)` | 非精确 | 按策略采样成比例尺区间，默认需用户确认降级 |
| 图标/Sprite、面图案 | 部分支持 | 导出资源清单或打包 ZIP，验证远端访问 |
| 基础文字和沿线标注 | 部分支持 | 字体、位置、重复与避让需比较 |
| 复杂表达式、特殊专业符号 | 待验证/不支持 | 禁止静默忽略 |

**必须保留 MapLibre 与 SLD 的差异**：Zoom 并非普适的真实地面比例尺。SLD 转换需要目标 CRS、地图分辨率体系及像素/比例尺假设；未提供必要上下文时，不应给出看似精确的换算结果。

### 7.2 导出 API 草案

```ts
type CompatibilityLevel = 'exact' | 'degraded' | 'unsupported'

interface CompatibilityIssue {
  path: string               // MapLibre JSON Pointer
  level: CompatibilityLevel
  reason: string
  proposedFallback?: string
}

interface SldExportResult {
  sldXml?: string             // unsupported 时允许为空
  assets: ExportedAsset[]
  issues: CompatibilityIssue[]
  level: CompatibilityLevel
}

exportSld(style: StyleSpecification, context: {
  targetLayerName: string
  crs: string
  zoomResolutionMapping?: ZoomResolutionMapping
  allowedDegradations: string[]
}): SldExportResult
```

分两步执行：**兼容性分析 → 用户接受有损处理 → XML 生成/校验**。不要只暴露 `toSld():string` 而无法说明降级效果。

### 7.3 可测试标准

- 每个可导出样式生成合法 XML，且能由固定测试版本 GeoServer 成功加载。
- 对同一数据/范围/尺度截取**本地 OpenLayers 与 GeoServer WMS** 图像，建立视觉差异基线；透明、线帽、边界、文字特别检查。
- 使用属性空值、超界断点、多条规则命中、不同坐标系验证语义。
- 不支持的内容必须在报告中准确指出 JSON 路径及建议替代方案。

---

## 8. GeoServer 发布：与 SLD 导出解耦

### 8.1 双路径，一套发布向导

1. **SLD 路线（默认必备）**：样式子层汇总 → 单向 SLD 转换 → REST 上传 → 关联目标 Layer → WMS 校验。无需 GeoServer 安装扩展。
2. **MBStyle 路线（可选增强）**：服务器安装并支持 GeoServer MBStyle 扩展时，可上传 Mapbox 风格 JSON；其支持范围按 GeoServer/GeoTools 版本确认，不假定与最新 MapLibre 标准完全一致。即使走此路线也要校验效果。

不能将“GeoServer 可以通过 MBStyle 生成 SLD”理解为“任何 MapLibre 表达式都能原样发布”。这仍是一个需要服务端实测的转换后端。

### 8.2 发布流程（用户视角）

```text
图层右键 → 发布到 GeoServer
  1. 选择外部连接（认证从安全存储读取）
  2. 选择 Workspace、Store、目标 Layer
     └─ 若尚无对应 FeatureType，先执行独立的数据发布/绑定流程
  3. 选择样式发布路径（默认自动选 SLD，MBStyle 可用时提供选项）
  4. 预检：目标字段、CRS、资源、兼容性、命名冲突、远端修改
  5. 显示影响摘要/仅在冲突时确认覆盖
  6. 上传并关联 style（可设置目标图层默认样式）
  7. 回读样式 + WMS GetMap/必要时 GetLegendGraphic 验证
  8. 更新本地 PublishLink；询问是否将服务图层加载到当前工作区
```

“发布数据”和“发布样式”是两个工作单元；如果数据不存在，必须先完成数据发布或要求用户选择已有服务端资源，不能假设上传 SLD 会自动创建 FeatureType。

### 8.3 远端状态与失败处理

```ts
interface PublishedStyleLink {
  connectionId: string       // 不包含账号密码
  workspace: string
  store?: string
  layerName: string
  styleName: string
  remoteFormat: 'sld' | 'mbstyle'
  lastPublishedHash?: string
  lastPublishedAt?: string
}
```

- 首次发布与更新分开；更新前获取当前远端样式，检查与上次发布指纹是否不同。
- 发生冲突时默认禁止覆盖；允许用户查看差异并显式选择覆盖/改名。
- 上传后再关联，成功后回读校验；失败时保留步骤记录，优先回滚本次新创建的未引用资源，**不要擅自回滚用户原有配置**。
- 认证密钥仅在安全存储/会话中存在；项目只持有 credential reference。
- 保存本地项目**不触发远端覆盖**；本地与发布状态可用“未同步”标识提醒，但不持续弹警告。
- 对 SVG/图案等资源使用明确打包与路径策略，避免服务端可见样式但取不到符号资源。

### 8.4 GeoServer REST 适配范围

优先实现：Workspace/Style 查找、创建和更新样式、读取 Layer、设置默认样式、WMS 验证。使用 GeoServer documented API，不绕开 REST 去直接改服务器文件。网络客户端应具备超时、取消、错误结构化、敏感字段脱敏和非幂等请求保护。

---

## 9. 项目升级与兼容策略

当前 `Layer.style` 的三种老模式不能直接删除。迁移必须覆盖：

1. **单一符号** → 单个 `line`/`fill`/`circle` Style Layer；标注存在则增设 `symbol` Layer。
2. **分类渲染** → `match` 表达式或有序过滤的多 Style Layers（优先保持原始 `CategoryItem` 映射和 fallback）。
3. **分级渲染** → `step` 或有序过滤的 Style Layers，精确保留断点 `<=` 语义、最高档和缺失值的 fallback。
4. **简单标注** → `symbol` Layer；原 Zoom 条件迁入 `minzoom/maxzoom`。
5. **编辑器信息**：分类方法（equal-interval、quantile、manual）、图例名称和分段配置保存在可选的 `metadata['my-web-gis:*']` 中，仅用于 UI 再编辑。
6. **项目版本**：增加 project schema migration；读取老项目时生成新结构，迁移后复制快照，不直接覆盖原文件，首次保存再写新版本。

测试方式：准备早期项目 Fixture；迁移前后比较地图输出、图例、分类断点、图层顺序、标注、保存重开及 Undo。迁移器应可多次执行而不重复插入 Style Layers，并保证 ID 稳定。

**默认不执行静默反向保存**：旧版本程序无法识别新样式，需要在项目版本与打开流程中提示兼容性。

---

## 10. 实施分阶段与验收门槛

| 阶段 | 目标 | 必须验收 |
|---|---|---|
| P0：技术 Spike | 引入锁定版本 `ol-mapbox-style`，在既有 OL Source 应用样式 | 分类+Zoom、双层道路、SVG、标注、面图案五个案例；含性能和截图对比 |
| P1：契约和迁移 | Style Layer 绑定、项目序列化、旧样式迁移、校验 | 原项目能打开、图层顺序一致、迁移幂等、保存重开无损 |
| P2：编辑状态 | V4 样式 UI 接入、即时更新、Undo 事务 | 拖动线宽仅一条 Undo、Ctrl+S 正确、切换图层不丢改动 |
| P3：专业制图 | 符号编辑器、标注、内置符号与资源管理 | 道路/河流/行政区真实案例；复杂表达式编辑不被破坏 |
| P4：SLD 输出 | SLD 1.0 常用子集 + 兼容性报告 | 基础符号、过滤、分级、比例尺、资源打包通过 GeoServer 测试 |
| P5：GeoServer 发布 | 外部连接、目标选择、上传/关联/回读/WMS 验证 | 不覆盖远端他人变更，失败可定位，项目凭据不泄漏 |
| P6：增强 | MBStyle 直传、Canvas/WebGL 适配扩展 | 基于具体服务版本和性能回归决定是否启用 |

**P0 是是否采纳适配器的门槛，不是直接替换所有旧实现。** P0 如遇标注/图案等重大缺口，应保留现有 `ol-style` 特性或有针对性补充；不应为了“统一技术路线”降低制图质量。

### 建议建立的测试固定数据

- `roads.geojson`：双层道路、铁路、相交交叉口；分类/线宽变化。
- `rivers.geojson`：等级、类型、流量、重要性；属性+Zoom 联动。
- `admin.geojson`：行政边界、面填充、标签。
- `poi.geojson`：点/SVG、重叠、旋转、缩放。
- `labels.geojson`：中英文、长名称、沿线重复/避让。

自动化范围：schema 校验单测、migration fixtures、adapter 行为测、UI 状态与 Undo 测、视觉快照、GeoServer Docker 集成环境（真实服务版本固定），以及 Windows/Tauri 网络与凭据校验。

---

## 11. 尚需 Spike 验证的边界（不阻塞方案讨论）

1. `ol-mapbox-style` 在项目锁定 OpenLayers 版本下的 `symbol`、sprite、沿线重复标注和组合图层效果。
2. Canvas 按数据源聚合后，跨 GIS 图层叠放、显示过滤与选择/编辑高亮是否保持现有行为。
3. GeoServer SLD 是否能够在目标服务版本下正确表达约定的图案/SVG 和 Zoom 降级样式。
4. MBStyle 扩展安装检测、远端 SLD 转换结果以及与本地规范差异。
5. 图层样式保存到项目文件后的资源可移植性；导出完整 MapLibre Style JSON 的 source URL 策略。
6. 大数据量（本地高密度矢量、服务端矢量瓦片）下的渲染流畅度与频繁样式更新开销。

**非目标**：SLD 导入、GeoServer SLD 的双向同步、全量 MapLibre 规范 100% 兼容、替换为 MapLibre GL 渲染引擎、一次完成高级专业行业全部符号标准、在二维设计阶段强制统一三维样式模型。

---

## 12. 交付给开发 Agent 的执行指令（建议）

> 基于仓库当前 `main` 和《二维制图系统技术设计 V1》，首先只做 **P0 技术 Spike**，不要立即批量迁移业务代码。引入固定兼容版本 `ol-mapbox-style`，复用既有 OpenLayers Vector Source，验证文档规定的五组样式。输出可运行示例、Vitest/Playwright 测试、兼容性矩阵、视觉截图及性能结论。核对 `ol` 实际锁定版本，并标出每个能力的通过/局限/不支持。经评审后再进入 P1。不得修改项目层数据语义、覆盖既有项目格式或声称已完成 SLD/GeoServer 发布。

---

## 13. 参考依据（已核对的官方文档）

- MapLibre Style Specification v8：[规范概览](https://maplibre.org/maplibre-style-spec/)、[Layers](https://maplibre.org/maplibre-style-spec/layers/)、[Sources](https://maplibre.org/maplibre-style-spec/sources/)、[Expressions](https://maplibre.org/maplibre-style-spec/expressions/)。
- OpenLayers `ol-mapbox-style`：[applyStyle API](https://openlayers.org/ol-mapbox-style/functions/applyStyle.html)、[stylefunction API](https://openlayers.org/ol-mapbox-style/functions/stylefunction.html)。
- GeoServer：[SLD Rules](https://docs.geoserver.org/stable/en/user/styling/sld/reference/rules/)、[REST Styles](https://docs.geoserver.org/stable/en/user/rest/api/styles/)、[MBStyle 扩展](https://docs.geoserver.org/main/en/user/styling/mbstyle/)、[MBStyle 安装](https://docs.geoserver.org/main/en/user/styling/mbstyle/installing/)。
- 项目源码：[仓库](https://github.com/Nicander93/my-web-gis)、[`ol-style/types.ts`](https://github.com/Nicander93/my-web-gis/blob/main/packages/ol-style/src/types.ts)、[`ol-style/compiler.ts`](https://github.com/Nicander93/my-web-gis/blob/main/packages/ol-style/src/compiler.ts)、[`project.store.ts`](https://github.com/Nicander93/my-web-gis/blob/main/apps/desktop/src/stores/project.store.ts)、[`Layer` 契约](https://github.com/Nicander93/my-web-gis/blob/main/packages/gis-core/src/types.ts)。

> 下一项独立讨论：**三维制图系统**。优先明确 3D Tiles、三维矢量 Entity/Primitive、影像和地形各自的表现能力与配置 UI，再选择 Cesium 3D Tiles Styling / Cesium Material / 可能的 glTF 资源体系；不在二维规范中预设所有三维实现方式。

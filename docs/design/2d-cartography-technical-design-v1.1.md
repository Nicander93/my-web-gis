# my-web-gis · 二维制图系统技术设计 V1.1

> 状态：设计基线，待实施；日期：2026-10-21
> 代码基线：`Nicander93/my-web-gis`，`main` 分支，提交 `015774120577546514baadd30cc22b1c79d9dbe4`（2026-10-11）。
> 适用范围：二维矢量制图、标注、符号资源、SLD 单向导出和 GeoServer 样式发布。
> 本文是**目标设计**，不代表所列能力已在仓库中实现；不包含三维实施、SLD 导入，以及 GeoServer 全量数据发布的实现细节。

## 0. 结论与约束

**目标**：以 MapLibre Style Specification v8 作为二维样式的规范基础；地图操作仍然由 OpenLayers 承载；样式优先通过 `ol-mapbox-style` 应用到 OpenLayers 的 **Canvas** 矢量图层；SLD 只做**单向输出**，用于不支持 MBStyle 扩展的 GeoServer。同时为将来的 WebGL 后端保留适配空间。

已确定的产品决策：

1. GIS 的 `Dataset` 和 `Layer` 仍然是项目级的业务对象；**一个 GIS Layer 对应一个数据集和多个 MapLibre Style Layer**，在用户看来仍然只是图层树上的一个节点。
2. 主样式编辑器使用先前认可的 **V4 紧凑布局**；专业符号编辑使用双栏窗口；符号选择与符号管理分开。避免装饰性图标、常驻的教学文案和卡片堆叠。
3. 常用参数直接编辑，复杂的表达式、符号图层、数值断点和 Zoom 动态参数按需弹窗。**修改立即在地图上生效**，撤销、重做和项目保存统一管理。
4. 单一、分类、分级、规则是**编辑器的交互方式和样式生成方式**，并不意味着底层样式互斥；最终表达出来的结果是多个标准的 Style Layer 加上 `filter` / `paint` / `layout` 表达式。
5. 内置专业的符号库和色带库；预设选中之后还可以继续编辑；项目要能独立还原已经用到的资源。
6. **不做 SLD 反向导入**；导出时可以提示降级，或者拒绝不兼容的样式，不能静默丢失效果。
7. GeoServer 是**外部连接**；用户选择连接、Workspace、Store 和目标 Layer，发布之后可以选择把 WMS 等服务图层加载回工作区。保存项目不等于更新服务端。

设计约束：保留现有的 React 与 Tauri 2、Zustand、OpenLayers、GIS Core 以及项目和图层管理；不因为制图需求整体更换地图引擎；三维不直接套用二维的符号模型。

---

## 1. 当前代码审计（已实现与目标的差距）

| 领域 | 当前代码 | 目标变化 |
|---|---|---|
| 样式契约 | `packages/public/ol-style/src/types.ts`：`SingleStyle \| CategorizedStyle \| GraduatedStyle`，包含简单的点线面和一个 `LabelConfig` | 改为以标准的 MapLibre `LayerSpecification` 和表达式为主，不再扩展旧的互斥类型 |
| 编译渲染 | `packages/public/ol-style/src/compiler.ts`：自行编译 OpenLayers StyleFunction，主要使用要素属性 | 用 `ol-mapbox-style` 作为默认适配器；缺陷补丁必须小，并且受测试约束 |
| 样式 UI | `StylePanel.tsx`：基于草稿，点击“应用”才生效 | 改为 V4 布局，实时生效，可以编辑结构化的表达式 |
| 标注 UI | `LabelPanel.tsx`：字段、字号、色彩、描边、偏移、Zoom 输入 | 改用 MapLibre 的 `symbol` 样式层，加可选的多规则标注 UI |
| 撤销与项目 | `project.store.ts`、`layer.commands.ts`：已有 `EditHistory` 和 `SetLayerStyleCommand` | 支持高频的即时预览，并按“一次用户操作”合并成一次撤销 |
| 数据模型 | `packages/internal/project/src/config/types.ts`：`Layer.style` 是旧式样式，`Layer.datasetId` 指向数据集 | 增加标准的样式层集合和稳定的映射，并迁移旧项目 |
| 服务读取 | `ogc-io`、`ServiceConnectPanel`：读取 WMS、WMTS、WFS | 增加独立的 GeoServer REST 发布模块，不混进“连接并加载服务”的模块 |

**关于代码版本**：桌面应用的 `apps/desktop/package.json` 对 `ol` 使用 `^10.6.1`，而 `packages/public/ol-style/package.json` 的 peer 范围是 `^10.10.0`。实施前应检查锁文件里实际解析到的 OpenLayers 版本，并统一工作区与适配库的兼容要求。这一点不能只凭 `package.json` 的文本就断定安装的版本。

**关于历史文件**：仓库里现在已经是 React 和 Zustand 的实现，而早期 V0.1 的架构附件记的是 Vue 和 Pinia；后者只能作为产品原则和演进背景，不能当作本轮的代码事实。

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

- **Style Operations（不依赖 OpenLayers）**：对标准的样式 JSON 做语义化编辑，生成分类和分级表达式，做验证、资源整理和图例语义生成，不自己再发明一套 `match/step/interpolate` 语法。
- **OpenLayers Adapter**：把标准的 Style JSON 绑定到已有的 `VectorLayer` 或 `VectorTileLayer` 上，处理资源、字体、错误反馈和变更刷新。V1 的默认实现是 Canvas。
- **Style Export Adapter**：单向输出 SLD 1.0（初期）和可选的 GeoServer MBStyle，同时给出兼容性报告，不处理 SLD 输入。
- **GeoServer REST Client**：负责连接、目标发现、样式上传与关联、远端版本与内容校验、回读和 WMS 验证。凭据要隔离；网络执行优先走 Tauri/Rust 通道。
- **GIS Core / Project**：数据集、GIS 图层、显示顺序、项目保存和撤销历史，仍然只由这里持有。

建议先在现有的 `packages/public/ol-style` 内实现适配层和迁移，验证之后再抽离成 `style-core` 和 `style-io`，避免过早创建太多包。依赖方向必须始终是**领域编辑逻辑不依赖具体的渲染器**。

---

## 3. 数据契约：GIS Layer 与 Style Layer

### 3.1 两种 Layer 要分清

- **GIS Layer**：用户在项目图层树里操作的业务对象，拥有名称、`datasetId`、可见性、不透明度、过滤、图层顺序和项目里的操作入口。
- **MapLibre Style Layer**：表现规则，使用标准的 `id`、`type`、`source`、`filter`、`minzoom`、`maxzoom`、`layout`、`paint`；多个 Style Layer 可以共用同一个 Source。
- **Source**：MapLibre 规范里的数据描述；项目内部的 `Dataset` 才是实际数据和凭据的管理实体。两者通过稳定的 source key 映射，不重复保存海量的 GeoJSON 数据。

示意图如下。这里的字段名是**项目绑定层的设计草案**，不是新的样式语言：

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

- 一组 Style Layer 对应一个 GIS Layer，普通用户只看到一个 GIS 图层；符号的内部编辑器可以展示绘制子层。
- 按 GIS 图层树里的上下关系组装**连续的 Style Layer 片段**，组内保持自下而上的绘制顺序。GIS 的 `rootOrder` 是顶部优先，而 MapLibre 的 `layers` 是后绘制的在上方，两者的方向转换要明确，并且要测试。
- **跨不同的 GIS 图层交错插入 Style Layer** 不列入第一阶段；否则 `ol-mapbox-style` 按数据源聚合成一个 OL 图层的行为，可能破坏全局的叠放顺序。将来确实需要交错时，改用多个 OL 绘制通道，并验证其成本。
- GIS Layer 的整体显隐、透明度和条件过滤，与 Style Layer 的 `visibility` / `filter` 分开管理；不能因为隐藏一个图层就删掉样式的子层。
- 图层树的图例可以展示复合规则的图例摘要；复杂属性映射需要确定的图例生成规则，不能只是读取一个 `line-color` 字符串。

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

主干和支流的筛选使用独立的 `filter`；需要额外叠加的重点河流，再加一条带过滤的 Style Layer。**属性分类、Zoom 插值和附加规则可以同时生效**。上层 UI 用的分类表和分级表，只是对标准表达式做可视化编辑，并不是在存储另一套互斥的渲染类型。

---

## 4. 本地 OpenLayers 渲染适配

### 4.1 首版默认使用 Canvas

- 使用 `ol-mapbox-style` 的 `applyStyle(layer, style, { source, updateSource:false })`，或按需使用 `stylefunction()`；保留现有 GIS runtime 创建的数据源、要素、选择和编辑工具。
- 官方的 `applyStyle()` 面向 `VectorLayer` 和 `VectorTileLayer`，可以指定 `source` 或 `layers` 子集，并通过 `updateSource:false` 保留现有的 OL Source。**这条路径是 Canvas 样式函数方案，不是 WebGL Shader 转换器。**
- 不要用 `apply()` 无条件接管整个 Map；项目、数据和视图仍然由 my-web-gis 管理。
- 样式变化时，按 GIS Layer 定位受影响的 Style Layers，更新对应的渲染样式。高频输入合并后再重新编译；异步加载 sprite 和 font 时，用请求序号防止旧结果覆盖新状态。

### 4.2 能力缺口的处理

| 场景 | 首版的处理方式 | 风险点 |
|---|---|---|
| 分类颜色加 Zoom 线宽 | 标准 `match/interpolate` | 缩放级别与 OL 分辨率的映射需要验证 |
| 双层道路 | 同源、连续的 `line` Style Layers | 交叉口的线外描边顺序、Canvas 的实际效果 |
| 点符号与 SVG | `circle` / `symbol` 加 sprite 或 `getImage` | SVG 资源是否可用、彩色与单色图标 |
| 沿线标注 | `symbol` 的 `text-*`、`symbol-placement` | 字体差异、重复标注和冲突 |
| 面图案填充 | `fill-pattern` 加 sprite | 预览、图例和资源导出是否一致 |
| 铁路枕木与复杂工程线型 | 先做能力验证 | 标准表达式是否够用；不够时**明确标记为扩展或暂不支持** |
| 不同缩放范围显示不同内容 | `minzoom` / `maxzoom` / `filter` 或表达式 | MapLibre 的过滤表达式里，Zoom 有特定的求值限制 |

动态材质、GPU 性能这些并不是 `ol-mapbox-style` 自动带来的能力。WebGL 后端作为后续的**并行适配器**，先保证相同样式能得到足够接近的表现，再考虑智能选择渲染后端。

### 4.3 依赖版本治理

- 锁定互相兼容的 `ol`、`ol-mapbox-style` 和 `@maplibre/maplibre-gl-style-spec`，统一由 pnpm 的锁文件管理。
- 单独建立渲染兼容集；升级依赖时，跑“相同数据、相同 View、相同样式”的视觉回归和行为测试。
- 明确记录不支持的样式属性，适配器不能静默吞掉重要的渲染效果。

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

**原型随本交付包一起提供**（可以直接在浏览器里打开，它们都是交互原型，不是生产实现）：

- [样式编辑器 V4](../prototypes/2d-cartography/my-web-gis-style-editor-v4.html)：**已认可的布局基线**；[主界面截图](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-preview.png)、[Zoom 弹窗截图](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-zoom-dialog.png)。
- [线符号编辑器 V1](../prototypes/2d-cartography/my-web-gis-line-symbol-editor-v1.html)：**双栏结构已认可**；[主界面截图](../prototypes/2d-cartography/screenshots/my-web-gis-line-symbol-editor-v1-preview.png)。
- [符号库选择器 V1](../prototypes/2d-cartography/my-web-gis-symbol-library-v1.html)：**讨论用的原型，不是最终验收**；[线符号界面截图](../prototypes/2d-cartography/screenshots/my-web-gis-symbol-library-v1-preview.png)。

详细的说明、交互范围、未完成的界面和交付路径，见[二维原型索引](./2d-cartography-prototype-index.md)。不能把 HTML 交互示例当成实际可用的 MapLibre、OpenLayers 或 GeoServer 能力。

### 5.2 可视化编辑器不能破坏未知的表达式

- 对可以识别的 `match`、`step`、`interpolate`，显示分类、断点、Zoom 节点这类结构化编辑器。
- 对合法但 UI 不认识的表达式，保留原始 JSON，显示为“表达式”状态，并提供高级编辑入口。
- 修改与表达式**无关**的属性时，原表达式的语义和 AST 必须保留，不能误写成固定值。
- 表达式的校验使用标准规范或与之兼容的校验器；禁止用 `eval()` 直接执行任意用户脚本。

### 5.3 实时更新，一次操作一次撤销

推荐使用 `StyleEditTransaction`，而不是继续维护“未应用样式草稿”：

```text
begin('修改线宽')
  ├─ 保存 before 快照
  ├─ pointer/input 更新 → 修改渲染态 → 地图立即重绘
  ├─ 编辑目标不变，不污染项目 Undo 栈
commit()
  ├─ before/after 形成一次 SetLayerStyleCommand
  └─ 项目 dirty=true
```

- 滑块、拖动选择器和连续的颜色输入，按事务合并；选择一次预设、完成一次分类，都作为一个撤销单元。
- 如果用户在拖动过程中按 Ctrl+S、切换图层或关闭弹窗，先 `commit`，或者明确中止当前操作；已经显示的改动不能丢。
- `Ctrl+Z` / `Ctrl+Y` 使用现有的统一 `EditHistory`；撤销之后图例和地图同步。
- 迁移掉“应用/重置草稿”和 `StyleDraftDialog` 切换目标时的确认流程；**这属于既有行为的迁移，不只是删掉 UI 上的按钮**。
- 样式 JSON 和 Sprite 的哈希用**内容基准**来维护保存状态；会话层只放编辑目标、弹窗状态和临时的交互事务。

---

## 6. 专业符号资源体系

1. **系统内置库**：随版本发布，只读；按点、线、面，以及交通、水系、行政、土地利用等专业语义分类，支持搜索和标签。
2. **我的符号库**：用户可以保存修改后的预设，可以收藏，也可以导入导出。
3. **项目资源**：把项目实际用到的符号定义和相关资源一起拷贝或打包，避免预设升级后破坏旧项目的外观。
4. **颜色资源**：分类色带和连续色带，支持自定义保存，并能在项目里复现。
5. **资源引用**：使用稳定的 ID、内容哈希和资源位置；不能只保存外部的临时 HTTP 地址。SVG 和 Sprite 资源需要做安全检查，限制远程资源和不安全的内容。
6. **来源与授权**：内置的专业符号应记录来源、许可和适用领域；示例符号库里大量程序生成的符号，不能直接宣称符合行业制图规范。

实现边界：MapLibre Style 里的复合符号优先通过**多个标准 Style Layer** 来表达；不再另外建一套与之平行、效果必须转换才能绘制的私有 `SymbolLayer[]` 语言。专业编辑器负责生成和编辑这样的 Style Layer 组合。

---

## 7. SLD 单向导出：支持矩阵与契约

**范围明确：只做 `MapLibre Style → SLD`，不做 SLD 导入。** 既支持离线导出 SLD，也支持交给 GeoServer 的发布流程使用。

### 7.1 默认选择 SLD 1.0

首版的 SLD 导出基于 GeoServer 的常见能力，不依赖服务器插件。对于更高级的 SE 1.1 和 vendor options，暂不承诺无损转换。SLD 的规则包含 Filter、Symbolizer 和比例尺分母，绘制顺序需要单独测试。

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

**必须保留 MapLibre 与 SLD 之间的差异**：Zoom 并不等于真实的地面比例尺。转成 SLD 需要目标 CRS、地图分辨率体系和像素与比例尺的假设；缺少这些上下文时，不应给出看似精确的换算结果。

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

分两步执行：**先做兼容性分析，用户接受有损处理之后，再生成和校验 XML**。不要只暴露一个 `toSld(): string`，却无法说明降级的具体效果。

### 7.3 可测试的标准

- 每个可导出的样式都生成合法的 XML，并且能在固定测试版本的 GeoServer 上成功加载。
- 对同一数据、同一范围、同一尺度截取**本地 OpenLayers 和 GeoServer WMS** 的图像，建立视觉差异基线；透明、线帽、边界和文字要特别检查。
- 用属性空值、超界断点、多条规则命中、不同坐标系来验证语义。
- 不支持的内容必须在报告里准确指出对应的 JSON 路径和建议的替代方案。

---

## 8. GeoServer 发布：与 SLD 导出解耦

### 8.1 两条路径，一套发布向导

1. **SLD 路线（默认，必须具备）**：汇总样式子层 → 单向转成 SLD → 通过 REST 上传 → 关联目标 Layer → 用 WMS 校验。不需要在 GeoServer 上安装扩展。
2. **MBStyle 路线（可选增强）**：服务器安装并支持 GeoServer 的 MBStyle 扩展时，可以直接上传 Mapbox 风格的 JSON；它的支持范围要按 GeoServer 和 GeoTools 的版本确认，不能假定与最新的 MapLibre 标准完全一致。即使走这条路，也要校验实际效果。

不能把“GeoServer 可以通过 MBStyle 生成 SLD”理解成“任何 MapLibre 表达式都能原样发布”。它仍然是一个需要在服务端实测的转换后端。

### 8.2 发布流程（从用户角度）

```text
图层右键 → 发布到 GeoServer
  1. 选择外部连接（认证从安全存储读取）
  2. 选择 Workspace、Store、目标 Layer
     └─ 若尚无对应 FeatureType，先执行独立的数据发布/绑定流程
  3. 选择样式发布路径（默认自动选 SLD，MBStyle 可用时提供选项）
  4. 预检：目标字段、CRS、资源、兼容性、命名冲突、远端修改
  5. 显示影响摘要，仅在冲突时确认覆盖
  6. 上传并关联 style（可设置目标图层默认样式）
  7. 回读样式，再用 WMS GetMap 和必要的 GetLegendGraphic 验证
  8. 更新本地的 PublishLink，并询问是否把服务图层加载到当前工作区
```

“发布数据”和“发布样式”是两个独立的工作单元；如果数据还不存在，必须先完成数据发布，或者要求用户选择服务端已有的资源，不能假设上传 SLD 就会自动创建 FeatureType。

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
- 发生冲突时默认禁止覆盖；用户可以查看差异，再明确选择覆盖或改名。
- 先上传再关联，成功之后回读校验；失败时保留步骤记录，优先回滚这次新创建、还没有被引用的资源，**不要擅自回滚用户原有的配置**。
- 认证密钥只存在于安全存储和会话中；项目里只保存凭据的引用。
- 保存本地项目**不会触发远端覆盖**；本地与发布状态可以用“未同步”标识提醒，但不持续弹出警告。
- 对 SVG、图案这类资源，要明确打包方式和路径策略，避免服务端能看到样式却取不到符号资源。

### 8.4 GeoServer REST 适配范围

优先实现：Workspace 和 Style 的查找、样式的创建和更新、读取 Layer、设置默认样式、WMS 验证。使用 GeoServer 公开的 API，不绕过 REST 直接修改服务器文件。网络客户端应具备超时、取消、结构化的错误、敏感字段脱敏，以及非幂等请求的保护。

---

## 9. 项目升级与兼容策略

当前 `Layer.style` 的三种旧模式不能直接删掉，迁移必须覆盖：

1. **单一符号** → 单个 `line`、`fill` 或 `circle` Style Layer；如果有标注，再加一个 `symbol` Layer。
2. **分类渲染** → 用 `match` 表达式，或用有序过滤的多个 Style Layer（优先保持原有的 `CategoryItem` 映射和 fallback）。
3. **分级渲染** → 用 `step` 或用有序过滤的 Style Layer，精确保留断点的 `<=` 语义、最高档和缺失值的 fallback。
4. **简单标注** → `symbol` Layer；原来的 Zoom 条件迁到 `minzoom` / `maxzoom`。
5. **编辑器信息**：分类方法（equal-interval、quantile、manual）、图例名称和分段配置，保存在可选的 `metadata['my-web-gis:*']` 里，只用于 UI 的再编辑。
6. **项目版本**：增加 project schema 的迁移；读取旧项目时生成新结构，迁移后复制快照，不直接覆盖原文件，第一次保存时才写入新版本。

测试方式：准备早期项目的 Fixture；迁移前后比较地图输出、图例、分类断点、图层顺序、标注、保存重开和撤销。迁移器应当可以重复执行，不会重复插入 Style Layers，并且保证 ID 稳定。

**默认不做静默的反向保存**：旧版本的程序无法识别新样式，需要在项目版本和打开流程中提示兼容性问题。

---

## 10. 实施分阶段与验收门槛

| 阶段 | 目标 | 必须验收 |
|---|---|---|
| P0：技术 Spike | 引入锁定版本的 `ol-mapbox-style`，在现有的 OL Source 上应用样式 | 分类加 Zoom、双层道路、SVG、标注、面图案五个案例；包含性能和截图对比 |
| P1：契约和迁移 | Style Layer 绑定、项目序列化、旧样式迁移、校验 | 原项目能打开、图层顺序一致、迁移幂等、保存重开无损 |
| P2：编辑状态 | 接入 V4 样式 UI、即时更新、撤销事务 | 拖动线宽只产生一条撤销、Ctrl+S 正确、切换图层不丢改动 |
| P3：专业制图 | 符号编辑器、标注、内置符号与资源管理 | 道路、河流、行政区的真实案例；复杂表达式编辑不被破坏 |
| P4：SLD 输出 | SLD 1.0 常用子集加兼容性报告 | 基础符号、过滤、分级、比例尺、资源打包通过 GeoServer 测试 |
| P5：GeoServer 发布 | 外部连接、目标选择、上传与关联与回读、WMS 验证 | 不覆盖远端他人的变更，失败时能定位，项目凭据不泄漏 |
| P6：增强 | MBStyle 直传、Canvas 与 WebGL 的适配扩展 | 根据具体的服务版本和性能回归决定是否启用 |

**P0 是判断这个适配器是否可用的门槛，不是直接替换所有旧实现。** 如果 P0 遇到标注、图案这类重大缺口，应当保留现有的 `ol-style` 特性或有针对性地补充，不能为了“统一技术路线”降低制图质量。

### 建议建立的测试固定数据

- `roads.geojson`：双层道路、铁路、相交的交叉口；分类和线宽变化。
- `rivers.geojson`：等级、类型、流量、重要性；属性与 Zoom 联动。
- `admin.geojson`：行政边界、面填充、标签。
- `poi.geojson`：点与 SVG、重叠、旋转、缩放。
- `labels.geojson`：中英文、长名称、沿线的重复与避让。

自动化范围：schema 校验单测、migration fixtures、adapter 的行为测试、UI 状态与撤销的测试、视觉快照、GeoServer 的 Docker 集成环境（固定真实服务的版本），以及 Windows 与 Tauri 下的网络和凭据校验。

---

## 11. 还需要 Spike 验证的边界（不阻塞方案讨论）

1. `ol-mapbox-style` 在项目锁定的 OpenLayers 版本下，对 `symbol`、sprite、沿线重复标注和组合图层效果的支持。
2. Canvas 按数据源聚合之后，跨 GIS 图层的叠放、显示过滤，以及选择与编辑高亮是否还保持现有行为。
3. 目标服务版本的 GeoServer 能否用 SLD 正确表达约定的图案、SVG 和 Zoom 降级样式。
4. MBStyle 扩展的安装检测、远端 SLD 的转换结果，以及与本地规范的差异。
5. 图层样式保存到项目文件之后，资源的可移植性；导出完整 MapLibre Style JSON 时的 source URL 策略。
6. 大数据量（本地高密度矢量、服务端矢量瓦片）下的渲染流畅度，以及频繁更新样式的开销。

**非目标**：SLD 导入、与 GeoServer SLD 的双向同步、100% 兼容完整的 MapLibre 规范、替换成 MapLibre GL 渲染引擎、一次做完全部高级专业行业的符号标准，以及在二维设计阶段就强制统一三维的样式模型。

---

## 12. 交付给开发 Agent 的执行指令（建议）

> 基于仓库当前的 `main` 和《二维制图系统技术设计 V1》，先只做 **P0 技术 Spike**，不要立刻批量迁移业务代码。引入固定兼容版本的 `ol-mapbox-style`，复用现有的 OpenLayers Vector Source，验证文档里规定的五组样式。输出可运行的示例、Vitest 或 Playwright 测试、兼容性矩阵、视觉截图和性能结论。核对 `ol` 实际锁定的版本，并标出每项能力是通过、受限还是不支持的。评审通过后再进入 P1。不得修改项目层的数据语义，不得覆盖既有项目格式，也不得声称已经完成 SLD 或 GeoServer 发布。

---

## 13. 参考依据（已核对的官方文档）

- MapLibre Style Specification v8：[规范概览](https://maplibre.org/maplibre-style-spec/)、[Layers](https://maplibre.org/maplibre-style-spec/layers/)、[Sources](https://maplibre.org/maplibre-style-spec/sources/)、[Expressions](https://maplibre.org/maplibre-style-spec/expressions/)。
- OpenLayers `ol-mapbox-style`：[applyStyle API](https://openlayers.org/ol-mapbox-style/functions/applyStyle.html)、[stylefunction API](https://openlayers.org/ol-mapbox-style/functions/stylefunction.html)。
- GeoServer：[SLD Rules](https://docs.geoserver.org/stable/en/user/styling/sld/reference/rules/)、[REST Styles](https://docs.geoserver.org/stable/en/user/rest/api/styles/)、[MBStyle 扩展](https://docs.geoserver.org/main/en/user/styling/mbstyle/)、[MBStyle 安装](https://docs.geoserver.org/main/en/user/styling/mbstyle/installing/)。
- 项目源码：[仓库](https://github.com/Nicander93/my-web-gis)、[`ol-style/types.ts`](https://github.com/Nicander93/my-web-gis/blob/main/packages/public/ol-style/src/types.ts)、[`ol-style/compiler.ts`](https://github.com/Nicander93/my-web-gis/blob/main/packages/public/ol-style/src/compiler.ts)、[`project.store.ts`](https://github.com/Nicander93/my-web-gis/blob/main/apps/desktop/src/project/project.store.ts)、[`Layer` 契约](https://github.com/Nicander93/my-web-gis/blob/main/packages/internal/project/src/config/types.ts)。

> 下一项独立讨论：**三维制图系统**。先明确 3D Tiles、三维矢量 Entity 与 Primitive、影像和地形各自的表现能力与配置 UI，再决定用 Cesium 3D Tiles Styling、Cesium Material，还是可能的 glTF 资源体系；不在二维规范里预设所有三维的实现方式。

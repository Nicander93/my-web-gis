# 二维场景协议与发布规范 V0.1

> 文档状态：Draft
> 协议代号：SceneManifest v1
> 适用范围：二维场景编辑器、OpenLayers 场景运行时、静态发布器
> 本文中的“必须”“不得”表示首版实现的强制约束。

---

## 1. 目标

本项目不直接抽象或复制 OpenLayers 的全部类。项目定义一套面向产品使用者的声明式二维场景协议，并由 OpenLayers Runtime 将协议转换为 OpenLayers 对象。

完整链路为：

```text
桌面编辑器
   ↓ 创建和维护
ProjectDocument（编辑工程）
   ↓ 校验、资源收集、编译
SceneManifest（公开场景协议）
   ├── OpenLayers Runtime
   ├── 静态发布包
   └── 第三方项目嵌入
```

V0.1 必须实现以下结果：

1. 编辑器可以创建一个完整的二维场景；
2. 场景可以被序列化为稳定、可校验的 JSON；
3. 独立 Runtime 可以在不加载编辑器代码的情况下渲染该 JSON；
4. Publisher 可以生成可部署到任意静态服务器的目录；
5. 发布后的地图视角、图层顺序、样式和交互与编辑器预览一致。

---

## 2. 产品边界

### 2.1 V0.1 包含

- 二维地图场景；
- GeoJSON 矢量数据；
- XYZ 栅格底图；
- 点、线、面简单样式；
- 基础文字标注；
- 图层显隐、透明度、顺序和缩放范围；
- Feature 选择和安全的属性 Popup；
- 图层切换器、图例、比例尺和全屏组件；
- 静态场景构建和本地预览；
- 场景协议校验和版本迁移入口。

### 2.2 V0.1 不包含

- Cesium 和三维场景；
- 任意 JavaScript 表达式执行；
- 服务端渲染；
- 在线多人编辑；
- 用户、角色和项目权限系统；
- 数据库或实时数据同步；
- 复杂 GIS 空间分析；
- WMS、WMTS、Vector Tile；
- 分类、分级和任意规则渲染；
- OpenLayers 全量 API 的 JSON 映射。

### 2.3 发布的定义

V0.1 中“发布”指生成一个自包含的静态站点目录。该目录可以放置在 Nginx、对象存储、GitHub Pages 或任意其他静态托管服务上，并通过 URL 访问。

V0.1 不负责运营一个公共云托管平台。未来通过 `PublishAdapter` 扩展上传目标，编辑器不与某个云厂商绑定。

---

## 3. ProjectDocument 与 SceneManifest

### 3.1 ProjectDocument

`ProjectDocument` 是编辑器源工程，可以包含：

- 本地文件绝对路径；
- Dataset 与 Feature 的可编辑副本；
- 当前活动图层；
- 编辑器布局和偏好；
- 草稿资源；
- 自动恢复信息。

`ProjectDocument` 不是公开协议，不保证可以直接部署到浏览器。

### 3.2 SceneManifest

`SceneManifest` 是稳定、公开、可移植的运行时协议，必须满足：

- 包含明确的协议版本；
- 不包含本地绝对路径；
- 不包含选择状态、活动工具等编辑器临时状态；
- 所有本地资源必须被转换为发布目录内的相对 URL；
- 可以仅通过 JSON Schema 和语义校验器完成验证；
- 相同输入在同一协议版本下产生确定的标准化结果。

### 3.3 编译关系

```text
compileProject(project, options)
  → validate project
  → collect local resources
  → rewrite resource URLs
  → normalize scene values
  → emit scene.json
  → emit data/* and assets/*
```

编辑器保存工程和发布场景必须是两个独立动作。

---

## 4. SceneManifest v1 顶层结构

```ts
interface SceneManifestV1 {
  $schema?: string
  version: 1
  id: string
  title: string
  description?: string
  view: SceneView
  credentials?: Record<string, SceneCredentialReference>
  sources: Record<string, SceneSource>
  layers: SceneLayer[]
  widgets?: SceneWidgets
  theme?: SceneTheme
  presentation?: ScenePresentation
  metadata?: Record<string, JsonValue>
}
```

约束：

- `id` 在一个发布空间内必须稳定；
- `sources` 的键是 Source ID；
- `layers` 的排列顺序就是从下到上的渲染顺序；
- Layer ID 在同一个 Scene 中必须唯一；
- `metadata` 只能保存 JSON 值，不得用于控制 Runtime 行为；
- Runtime 遇到未知顶层字段应当忽略，但校验器应当给出提示。

---

## 5. View

```ts
interface SceneView {
  projection: string
  center: [number, number]
  zoom: number
  rotation?: number
  minZoom?: number
  maxZoom?: number
  extent?: [number, number, number, number]
}
```

V0.1 默认投影为 `EPSG:3857`。

- `center` 使用 `projection` 对应的坐标；
- `rotation` 使用弧度；
- `extent` 同样使用场景投影；
- Runtime 必须校验所有数值为有限数；
- `minZoom` 不得大于 `maxZoom`。

---

## 6. Source

V0.1 Source 只描述数据来源、Provider 和凭据引用，不包含显示样式。所有在线底图均通过 Source 接入，不把供应商 URL 和鉴权细节放入 Layer。

```ts
type SceneSource = GeoJsonSource | XyzSource | ProviderSource

interface GeoJsonSource {
  type: 'geojson'
  data?: GeoJsonFeatureCollection
  url?: string
  dataProjection?: string
  idField?: string
}

interface XyzSource {
  type: 'xyz'
  url: string
  crossOrigin?: 'anonymous' | 'use-credentials'
  maxZoom?: number
  attribution?: string
}

type ProviderSource = TiandituSource | GoogleMapTilesSource

interface TiandituSource {
  type: 'provider'
  provider: 'tianditu'
  mapType: 'vector' | 'imagery' | 'terrain'
  projection?: 'EPSG:3857' | 'EPSG:4326'
  withLabels?: boolean
  credential: string
}

interface GoogleMapTilesSource {
  type: 'provider'
  provider: 'google-map-tiles'
  mapType: 'roadmap' | 'satellite' | 'terrain'
  language: string
  region: string
  credential: string
}

interface SceneCredentialReference {
  type: 'runtime-reference'
  key: string
}
```

约束：

- `data` 和 `url` 必须且只能提供一个；
- Feature 几何和属性沿用 GeoJSON，不定义私有几何格式；
- `url` 可以是相对 URL 或 HTTP(S) URL；
- 发布器必须拒绝 `file:` URL 和本地绝对路径；
- `idField` 用于从属性中生成稳定 Feature ID；
- 未提供 `idField` 时优先使用 GeoJSON Feature 的 `id`；
- Runtime 不得修改传入的 Source 定义。
- Credential 只保存运行时配置引用，不得把 token 或 API Key 直接写入 `scene.json`；
- Provider Adapter 可以将一个逻辑 Source 映射为多个原生 OpenLayers Source/Layer；
- Provider 必须保留法定或服务条款要求的 attribution；
- Google Map Tiles 必须通过官方 Session Token 流程访问，不得使用非公开瓦片地址；
- 发布器不得缓存或复制服务条款禁止离线保存的在线地图瓦片。

P1 可以增加 `csv`、`kml`、`wms`、`wmts`、`vector-tile`，但不得改变 v1 GeoJSON Source 的含义。

---

## 7. Layer

V0.1 支持 `tile` 和 `vector` 两种逻辑 Layer。

```ts
interface SceneLayerBase {
  id: string
  name: string
  visible?: boolean
  opacity?: number
  minZoom?: number
  maxZoom?: number
  role?: 'basemap' | 'overlay'
}

interface TileLayer extends SceneLayerBase {
  type: 'tile'
  source: string
}

interface VectorLayer extends SceneLayerBase {
  type: 'vector'
  source: string
  style: SceneStyle
  label?: LabelStyle
  interaction?: LayerInteraction
}
```

约束：

- `opacity` 必须处于 `0..1`；
- `source` 必须引用已存在且类型兼容的 Source ID；
- `visible` 默认值为 `true`；
- 未提供 `minZoom` 和 `maxZoom` 表示不限制；
- Tile Layer 只能引用 `xyz` 或 `provider` Source；
- Vector Layer 只能引用矢量数据 Source；
- `xyz.url` 必须包含 Runtime 支持的瓦片占位符；
- `role: basemap` 表示互斥底图候选，`overlay` 表示可以叠加；
- Runtime 不把 OpenLayers Layer 实例暴露为主要应用状态。

图层分组属于 P0 编辑器能力，但 SceneManifest v1 首版使用扁平 `layers` 保证协议简单。发布器必须把编辑器分组展开为确定的渲染顺序。P1 再评估公开协议中的 Group Layer。

---

## 8. Style

V0.1 只支持简单样式，不允许执行任意代码。

```ts
type SceneStyle = PointStyle | LineStyle | PolygonStyle

interface PointStyle {
  type: 'point'
  radius: number
  fill: string
  stroke?: string
  strokeWidth?: number
}

interface LineStyle {
  type: 'line'
  color: string
  width: number
  lineDash?: number[]
}

interface PolygonStyle {
  type: 'polygon'
  fill: string
  stroke: string
  strokeWidth: number
  lineDash?: number[]
}

interface LabelStyle {
  field: string
  color?: string
  font?: string
  haloColor?: string
  haloWidth?: number
  offset?: [number, number]
  minZoom?: number
  maxZoom?: number
}
```

约束：

- 颜色首版接受 CSS 颜色字符串；
- Runtime 必须为无效颜色提供明确错误；
- `field` 只读取 Feature properties，不解析表达式；
- 字体必须提供安全默认值；
- 样式与 Feature Geometry 不兼容时 Runtime 给出可定位到 Layer 的错误。

P1 可以增加 `categorized`、`graduated` 和安全规则表达式。规则系统必须使用受限 AST 或声明式条件，不得使用 `eval`、`Function` 或脚本文本。

---

## 9. Interaction 与 Popup

```ts
interface LayerInteraction {
  selectable?: boolean
  popup?: PopupDefinition
}

interface PopupDefinition {
  titleField?: string
  fields: PopupField[]
}

interface PopupField {
  field: string
  label?: string
  format?: 'text' | 'number' | 'date' | 'url'
}
```

约束：

- Runtime 默认不显示未声明的属性；
- 文本内容必须转义；
- `url` 只允许安全协议，并使用安全的外链打开方式；
- JSON 中不得嵌入 HTML 模板或 JavaScript；
- `selectable` 默认值为 `false`，编辑器发布时必须显式决定。

---

## 10. Widgets

```ts
interface SceneWidgets {
  layerSwitcher?: boolean
  legend?: boolean
  scaleLine?: boolean
  fullscreen?: boolean
  zoom?: boolean
  mousePosition?: boolean
}
```

Widgets 只描述能力是否启用，不描述具体 DOM 结构。不同宿主可以提供不同 UI，但必须保持场景语义一致。

独立 Runtime 必须允许宿主关闭内置 Widgets 并自行订阅 Runtime 状态。

---

## 11. Presentation

Presentation 用于项目汇报。V0.1 只冻结顶层入口，完整章节播放属于 P1。

```ts
interface ScenePresentation {
  chapters?: SceneChapter[]
}

interface SceneChapter {
  id: string
  title: string
  description?: string
  view: SceneView
  visibleLayers?: string[]
  highlightedFeatureIds?: string[]
}
```

P1 必须支持：

- 上一章和下一章；
- 章节独立 URL；
- 章节切换视角；
- 章节控制图层显隐；
- 高亮指定 Feature；
- 全屏汇报模式。

`description` 首版只按纯文本显示。未来如支持 Markdown，必须使用固定能力的安全渲染器。

### 11.1 发布主题

编辑器主题属于本地用户偏好，不进入场景协议；发布 Viewer 的主题属于场景表现，可以进入 `SceneManifest`：

```ts
interface SceneTheme {
  preset?: string
  colorScheme?: 'light' | 'dark' | 'system'
  accent?: string
  surface?: 'solid' | 'glass'
  fontFamily?: string
  logo?: string
}
```

主题只控制 Viewer 外壳、面板、Popup、图例和汇报控件，不改变 Feature 专题样式。Logo 必须通过安全的相对 URL 或 HTTP(S) URL 引用。

---

## 12. 完整示例

```json
{
  "$schema": "https://desktop-webgis.dev/schemas/map-scene-v1.json",
  "version": 1,
  "id": "city-report",
  "title": "城市项目汇报",
  "description": "站点与河流专题图",
  "view": {
    "projection": "EPSG:3857",
    "center": [12958000, 4852000],
    "zoom": 11,
    "rotation": 0
  },
  "credentials": {},
  "sources": {
    "osm": {
      "type": "xyz",
      "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      "attribution": "© OpenStreetMap contributors"
    },
    "stations": {
      "type": "geojson",
      "url": "./data/stations.geojson",
      "dataProjection": "EPSG:4326",
      "idField": "station_id"
    }
  },
  "layers": [
    {
      "id": "osm",
      "type": "tile",
      "name": "基础地图",
      "source": "osm",
      "role": "basemap",
      "visible": true
    },
    {
      "id": "stations",
      "type": "vector",
      "name": "项目站点",
      "source": "stations",
      "visible": true,
      "opacity": 1,
      "style": {
        "type": "point",
        "radius": 7,
        "fill": "#2563eb",
        "stroke": "#ffffff",
        "strokeWidth": 2
      },
      "label": {
        "field": "name",
        "color": "#0f172a",
        "haloColor": "#ffffff",
        "haloWidth": 3,
        "minZoom": 10
      },
      "interaction": {
        "selectable": true,
        "popup": {
          "titleField": "name",
          "fields": [
            { "field": "name", "label": "名称", "format": "text" },
            { "field": "status", "label": "状态", "format": "text" }
          ]
        }
      }
    }
  ],
  "widgets": {
    "layerSwitcher": true,
    "legend": true,
    "scaleLine": true,
    "fullscreen": true
  }
}
```

---

## 13. 独立包边界

### 13.1 `scene-schema`

不得依赖 OpenLayers、Vue、Pinia、Tauri 或 DOM。

公开能力：

```ts
parseScene(input: unknown): SceneManifest
validateScene(input: unknown): ValidationResult
normalizeScene(scene: SceneManifest): SceneManifest
migrateScene(input: unknown): SceneManifest
```

必须提供：

- TypeScript 类型；
- JSON Schema；
- 结构校验；
- 跨引用语义校验；
- 可定位路径的错误；
- v1 标准化；
- 版本迁移入口；
- ESM 构建和类型声明。

### 13.2 `scene-core`

不得依赖 OpenLayers 和应用框架。

负责：

- Scene 与 Project 的公共纯函数；
- 样式默认值；
- Source/Layer/Feature ID 规则；
- Scene diff 和不可变更新辅助能力；
- Project 到 Scene 的纯编译阶段。

不得成为无边界的 `utils` 集合。每个公开函数必须属于明确的领域概念。

### 13.3 `ol-scene-runtime`

只依赖 `scene-schema`、`scene-core` 和 OpenLayers，不得依赖编辑器。

建议公开 API：

```ts
createSceneRuntime(options): Promise<SceneRuntime>

interface SceneRuntime {
  loadScene(scene: SceneManifest | string): Promise<void>
  updateScene(scene: SceneManifest): Promise<void>
  setLayerVisible(layerId: string, visible: boolean): void
  setLayerOpacity(layerId: string, opacity: number): void
  fitToLayer(layerId: string): Promise<void>
  selectFeatures(layerId: string, featureIds: string[]): void
  on(type: SceneRuntimeEvent, listener: RuntimeListener): Unsubscribe
  getNativeMap(): unknown
  destroy(): void
}
```

`getNativeMap()` 是高级扩展逃生口，不是普通使用路径。

Runtime 事件至少包括：

- `scene:ready`；
- `scene:error`；
- `layer:loadstart`；
- `layer:loadend`；
- `layer:error`；
- `feature:click`；
- `selection:change`；
- `view:change`。

### 13.4 `scene-publisher`

负责：

- Project 编译；
- Scene 校验；
- 本地资源收集；
- 文件名和路径安全处理；
- 相对 URL 改写；
- 静态 Viewer 输出；
- 发布清单和构建错误报告。

未来通过以下接口支持托管平台：

```ts
interface PublishAdapter {
  publish(artifact: PublishArtifact, options: unknown): Promise<PublishResult>
}
```

---

## 14. 静态发布物格式

```text
dist-scene/
├── index.html
├── scene.json
├── assets/
│   ├── viewer.js
│   ├── viewer.css
│   └── icons/*
├── data/
│   └── *.geojson
└── publish-manifest.json
```

`publish-manifest.json` 至少记录：

- 发布物格式版本；
- Scene ID 和 Scene 协议版本；
- 构建时间；
- 文件列表；
- 每个文件的内容哈希；
- Runtime 版本。

发布器必须：

- 防止路径穿越；
- 拒绝复制工作区之外的隐式资源；
- 对缺失资源给出文件级错误；
- 不把编辑器源代码和状态打入发布物；
- 保证重复构建具有稳定目录结构；
- 在发布前完成一次 Runtime 可加载性检查。

---

## 15. P0 功能清单

### 15.1 编辑

- GeoJSON 导入、编辑、导出；
- 点、线、面绘制；
- 单选、多选和框选；
- 节点增加、移动、删除；
- Feature 整体移动、复制、粘贴和删除；
- 节点、边和中点吸附；
- 属性查看和编辑；
- Undo/Redo；
- 图层排序、分组、显隐和锁定；
- 自动保存和异常恢复。

### 15.2 场景创作

- 初始视角；
- XYZ 底图；
- 天地图矢量、影像、地形及注记组合；
- GeoJSON Source；
- 点、线、面简单样式；
- 基础标签；
- Popup 字段；
- 图例；
- 图层切换器；
- 发布前只读预览。
- 编辑器浅色、深色和跟随系统主题。

### 15.3 发布

- Project 到 Scene 编译；
- JSON Schema 与语义校验；
- 本地资源复制和路径改写；
- 静态 Viewer；
- 发布目录和 ZIP 输出；
- 本地 HTTP 预览；
- 可部署到通用静态托管。
- Scene Runtime 嵌入代码导出。

---

## 16. P1 功能清单

### 16.1 专业编辑

- 圆、矩形和自由线；
- 拆分、合并和打洞；
- 属性字段定义和批量修改；
- 按属性选择和过滤；
- 几何合法性检查；
- 坐标精确输入；
- 完整捕捉和绘制约束。

### 16.2 数据与样式

- CSV、KML 导入；
- Shapefile、GeoPackage 导入转换；
- DXF 导入、CAD 图层选择和地理配准；
- WMS、WMTS；
- Google 官方 Map Tiles Provider；
- CRS 识别和重投影；
- 分类、分级和安全规则渲染；
- 图标符号库；
- 标签缩放控制和基础避让；
- 样式模板导入导出。
- AI 根据字段结构、统计摘要和用户意图生成可校验的 Style JSON；
- 原生 OpenLayers TypeScript/JavaScript 代码生成。

### 16.3 汇报与托管

- Presentation Chapters；
- 章节视角和图层状态；
- Feature 高亮；
- 全屏播放；
- 章节独立 URL；
- PublishAdapter；
- 发布版本、更新和回滚；
- 可选的私有部署托管服务。
- 发布 Viewer 品牌主题、Logo 和汇报模板。

### 16.4 后续能力

- DWG 通过独立原生转换服务或合规 SDK 导入；
- CAD 块、文字、圆弧和填充的高级转换；
- AI Provider 管理、提示词记录和结果审计；
- AI 默认只使用字段 Schema、枚举值和统计摘要，未经用户确认不得上传完整 Feature 数据。

---

## 17. P0 验收场景

1. 用户新建项目并导入两个 GeoJSON；
2. 用户创建新图层并绘制点、线、面；
3. 用户使用吸附和节点工具修改几何；
4. 用户修改属性、图层顺序、样式和标签；
5. 用户配置 Popup、图例和初始视角；
6. 用户保存编辑工程；
7. 用户打开只读预览，预览与编辑器内容一致；
8. 用户执行发布并得到静态目录或 ZIP；
9. 发布目录通过普通静态 HTTP 服务访问；
10. 新浏览器会话只加载 Runtime、`scene.json` 和发布资源；
11. 地图视角、图层顺序、样式、标签、Popup 和图例与预览一致；
12. 发布页面不加载 Vue、Pinia、Tauri 或编辑器状态；
13. 修改工程后重新发布，场景内容正确更新；
14. Scene JSON 中不存在本地绝对路径；
15. 无效 Scene、重复 ID、缺失 Source 和缺失资源均产生可定位错误。

---

## 18. 演进规则

- `version` 是协议版本，不是应用版本；
- v1 字段语义冻结后不得静默改变；
- 新的可选字段可以在 v1 内增加，但不得改变既有默认值；
- 破坏性修改必须升级协议主版本；
- Runtime 应忽略未知可选字段；
- 校验器应报告未知字段，避免拼写错误被静默接受；
- 每个正式协议版本必须保留迁移测试和完整示例；
- 编辑器可以先实现实验字段，但不得在正式发布物中输出未冻结字段。

---

## 19. Definition of Done

SceneManifest v1 只有同时满足以下条件才算完成：

- 类型、JSON Schema 和运行时校验行为一致；
- 示例场景通过校验并能被独立 Runtime 渲染；
- 错误场景测试覆盖结构错误和跨引用错误；
- 编辑器预览与发布 Viewer 使用同一个 Runtime；
- Project 编译后不泄漏本地绝对路径；
- 发布目录可由普通静态服务器提供；
- Runtime 包可以独立安装和使用；
- OpenLayers 类型不出现在 SceneManifest 公开模型中；
- Feature 几何遵循 GeoJSON；
- P0 验收场景全部自动化或有明确的可重复人工验收步骤。

# 桌面 WebGIS — 技术架构 / 代码架构 V0.1

> 本文定义 V0.1 的工程边界、模块职责和依赖规则。  
> 核心目标：足够清晰，但不为了未来可能性过度架构。

---

## 1. 技术栈

V0.1 建议固定为：

```text
Desktop Shell   Tauri 2
Frontend        Vue 3
Language        TypeScript
Build           Vite
State           Pinia
Map Engine      OpenLayers
Monorepo        pnpm workspace
Test            Vitest
Lint            ESLint
Format          Prettier
```

### 技术原则

- Rust 只承担 Tauri 必需的本地能力；
- V0.1 不引入 Python / GDAL；
- 不在 Rust 和 TypeScript 两侧重复维护 GIS Domain Model；
- OpenLayers 是当前唯一地图 Runtime；
- 未来可以增加 Cesium Runtime，但当前不实现。

---

## 2. 总体架构

```text
┌─────────────────────────────────────┐
│ UI Layer                            │
│ Vue Views / Components              │
├─────────────────────────────────────┤
│ Application Layer                   │
│ Project / Workspace / Use Cases     │
├─────────────────────────────────────┤
│ GIS Domain Core                     │
│ Project / Dataset / Layer / Feature │
│ Selection / Editor / EditCommand    │
├─────────────────────────────────────┤
│ OpenLayers Runtime                  │
│ Map / Source / Layer / Interaction  │
└─────────────────────────────────────┘
                  │
              Tauri APIs
```

核心规则：

> Domain 不依赖 OpenLayers。  
> UI 不直接分散管理 OpenLayers Runtime。

---

## 3. Monorepo

V0.1 不要拆过多 package。

建议：

```text
desktop-webgis/
├─ apps/
│  └─ desktop/
│     ├─ src/
│     └─ src-tauri/
│
├─ packages/
│  ├─ gis-core/
│  └─ ol-runtime/
│
├─ docs/
├─ examples/
├─ package.json
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

---

## 4. Package 职责

### 4.1 `packages/gis-core`

定位：

> 内部 GIS Domain Core。

当前不要求发布 npm。

包含：

```text
Project
Dataset
DataSource
Layer
Feature
Geometry
Selection
Editor
EditCommand
EditHistory
Project Serialization Contract
```

必须满足：

```text
gis-core
  ├─ 不依赖 OpenLayers
  ├─ 不依赖 Vue
  ├─ 不依赖 Pinia
  ├─ 不依赖 DOM
  └─ 不依赖 Tauri
```

---

### 4.2 `packages/ol-runtime`

定位：

> OpenLayers 对 GIS Application 的运行时实现。

V0.1 先保持一个 package。

内部可按能力分模块：

```text
ol-runtime/
├─ map/
├─ layer/
├─ feature/
├─ data/
├─ style/
├─ selection/
└─ edit/
```

未来只有当能力稳定后才考虑拆为：

```text
@scope/ol-edit
@scope/ol-style
@scope/ol-data
@scope/ol-layer
```

不要提前拆。

---

### 4.3 `apps/desktop`

定位：

> 真正的桌面产品。

负责：

- Workspace；
- 菜单；
- 面板；
- Project 工作流；
- 文件访问；
- Application State；
- UI；
- Tauri 集成。

---

## 5. 依赖方向

正确依赖：

```text
gis-core
   ↑
ol-runtime
   ↑
desktop
```

Desktop 可以同时依赖：

```text
desktop
├─ gis-core
└─ ol-runtime
```

禁止：

```text
gis-core → ol-runtime
gis-core → Vue
gis-core → Tauri
ol-runtime → desktop
```

---

## 6. Domain Model

### 6.1 Project

```ts
export interface Project {
  id: string
  version: number
  name: string
  crs: string
  datasets: Dataset[]
  layers: Layer[]
  mapState: MapState
}
```

Project 描述用户工程。

不得出现：

```text
ol.Map
ol.View
ol.layer.Layer
ol.source.Source
```

---

### 6.2 Dataset

Dataset 表示“数据”。

```ts
export interface Dataset {
  id: string
  name: string
  kind: 'vector'
  source: DataSource
}
```

V0.1：

```ts
export type DataSource =
  | {
      type: 'geojson-file'
      path: string
    }
  | {
      type: 'geojson-url'
      url: string
    }
```

Dataset 与 Layer 必须分开。

同一个 Dataset 未来可以被多个 Layer 引用。

---

### 6.3 Layer

Layer 表示“数据如何出现在项目中”。

```ts
export interface Layer {
  id: string
  datasetId: string
  name: string
  visible: boolean
  opacity: number
  editable: boolean
  style: LayerStyle
}
```

Layer 负责：

- visible；
- opacity；
- style；
- filter（未来）；
- editable。

Layer 不保存：

- `ol.layer.Vector`；
- `ol.source.Vector`；
- 所有 Feature 的真实数据副本。

---

### 6.4 Feature

```ts
export interface Feature {
  id: string
  geometry: Geometry
  properties: Record<string, unknown>
}
```

V0.1 Geometry：

```ts
export type Geometry =
  | PointGeometry
  | MultiPointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry
```

建议坐标数据结构尽量与 GeoJSON 兼容，但不要让 `ol.geom.Geometry` 成为领域模型。

---

## 7. FeatureStore

V0.1 使用内存存储。

接口：

```ts
export interface FeatureStore {
  getAll(datasetId: string): Feature[]
  getById(datasetId: string, featureId: string): Feature | undefined

  add(datasetId: string, feature: Feature): void
  update(datasetId: string, feature: Feature): void
  remove(datasetId: string, featureId: string): void
}
```

实现：

```text
MemoryFeatureStore
```

未来可以演进为：

```text
FileBackedFeatureStore
PostGISFeatureStore
RemoteFeatureProvider
```

当前不要实现。

---

## 8. Selection

Selection 必须独立于 OpenLayers。

```ts
export interface SelectionState {
  layerId: string | null
  featureIds: string[]
}
```

数据流：

```text
Map Click
   ↓
OpenLayers Select
   ↓
featureId
   ↓
Selection State
   ↓
 ┌───────────────┐
 │               │
Map Highlight   Attribute Table
```

反方向同样成立：

```text
Attribute Table
   ↓
Selection State
   ↓
OL Runtime
   ↓
Map Highlight
```

---

## 9. Editor

V0.1 只允许一个 active tool。

```ts
export type EditTool =
  | 'none'
  | 'pan'
  | 'select'
  | 'draw-point'
  | 'draw-line'
  | 'draw-polygon'
  | 'modify'
  | 'delete'
```

禁止 Vue 组件直接：

```ts
new Draw(...)
new Modify(...)
new Select(...)
```

正确流程：

```text
Toolbar
   ↓
Application State
   ↓
OlToolRuntime
   ↓
activate / deactivate Interaction
```

---

## 10. EditCommand

需要区分两类 Command：

### AppCommand

应用命令：

```text
project.open
project.save
layer.zoomTo
layer.export
tool.drawPolygon
```

用于：

- 菜单；
- Command Palette；
- 快捷键。

### EditCommand

GIS 数据编辑命令，可 Undo / Redo。

```ts
export interface EditCommand {
  readonly id: string

  execute(context: EditContext): void
  undo(context: EditContext): void
}
```

V0.1：

```text
AddFeatureCommand
DeleteFeatureCommand
UpdateGeometryCommand
UpdatePropertiesCommand
```

---

## 11. EditHistory

```text
EditHistory
├─ undoStack
└─ redoStack
```

规则：

1. Execute 后进入 undoStack；
2. 新命令执行后清空 redoStack；
3. Undo：
   - 从 undoStack 弹出；
   - 执行 undo；
   - 放入 redoStack；
4. Redo 相反。

Project Save：

- 不等于清空 History；
- 只更新 dirty baseline。

---

## 12. OpenLayers Runtime

建议目录：

```text
packages/ol-runtime/src/
├─ map/
│  ├─ OlMapRuntime.ts
│  └─ OlViewAdapter.ts
│
├─ layer/
│  ├─ OlLayerAdapter.ts
│  └─ OlLayerRegistry.ts
│
├─ feature/
│  ├─ toOlFeature.ts
│  └─ fromOlFeature.ts
│
├─ data/
│  └─ OlVectorSourceFactory.ts
│
├─ selection/
│  └─ OlSelectionRuntime.ts
│
├─ edit/
│  ├─ OlToolRuntime.ts
│  ├─ draw/
│  ├─ modify/
│  └─ delete/
│
└─ style/
   └─ OlStyleAdapter.ts
```

---

## 13. Runtime Registry

必须有明确映射：

```text
Domain layerId
     ↓
ol.layer.Layer

Domain featureId
     ↓
ol.Feature
```

禁止每次通过遍历 `map.getLayers()` 猜测对应对象。

例如：

```ts
class OlLayerRegistry {
  get(layerId: string): BaseLayer | undefined
  register(layerId: string, layer: BaseLayer): void
  unregister(layerId: string): void
}
```

---

## 14. 数据加载流程

GeoJSON：

```text
File Dialog
    ↓
Desktop Use Case
    ↓
GeoJSON Loader
    ↓
Dataset
    +
FeatureStore
    ↓
Create Layer
    ↓
Ol Runtime
    ↓
VectorSource
    ↓
VectorLayer
```

关键原则：

> 数据加载与地图渲染分开。

不要：

```text
loadGeoJSON()
  ↓
直接 new VectorLayer()
```

因为 Dataset 后续还会被：

- Attribute Table；
- Export；
- Analysis；
- Search；

共同使用。

---

## 15. Project 文件

第一版可以使用 JSON。

示例：

```json
{
  "version": 1,
  "name": "Demo",
  "crs": "EPSG:3857",
  "datasets": [
    {
      "id": "roads-data",
      "name": "roads",
      "kind": "vector",
      "source": {
        "type": "geojson-file",
        "path": "./data/roads.geojson"
      }
    }
  ],
  "layers": [
    {
      "id": "roads-layer",
      "datasetId": "roads-data",
      "name": "Roads",
      "visible": true,
      "opacity": 1,
      "editable": true,
      "style": {
        "kind": "line"
      }
    }
  ],
  "mapState": {
    "center": [0, 0],
    "zoom": 2,
    "rotation": 0
  }
}
```

原则：

- 从第一版就带 version；
- 路径优先相对项目文件；
- Loader / Serializer 分开；
- 为 migration 预留入口；
- 不保存 OpenLayers 实例。

---

## 16. Desktop 源码组织

建议按 feature 分：

```text
apps/desktop/src/
├─ app/
│  ├─ bootstrap.ts
│  ├─ commandRegistry.ts
│  └─ shortcuts.ts
│
├─ features/
│  ├─ project/
│  ├─ layers/
│  ├─ map/
│  ├─ selection/
│  ├─ attribute-table/
│  ├─ editing/
│  └─ export/
│
├─ stores/
│  ├─ project.store.ts
│  ├─ workspace.store.ts
│  └─ ui.store.ts
│
├─ services/
│  ├─ project.service.ts
│  ├─ dataset.service.ts
│  └─ file.service.ts
│
├─ components/
│  └─ shared/
│
└─ styles/
```

---

## 17. State 边界

### Application / GIS State

包括：

```text
currentProject
activeLayerId
selection
activeTool
editHistory
dirty
```

### UI State

包括：

```text
activeSidebarTab
sidebarWidth
bottomPanelOpen
bottomPanelHeight
dialog
theme
```

不要把两者混在一个巨型 Store。

---

## 18. Project Dirty

建议：

```text
Project Loaded/Saved
       ↓
baseline

任何可持久化状态变化
       ↓
dirty = true
```

UI 临时状态变化：

```text
sidebarWidth
hover
dialog open
```

不应该让 Project 变 dirty。

---

## 19. OpenLayers 可发布包演进

V0.1：

```text
packages/ol-runtime
```

只有满足下列条件才拆包：

1. 与 Desktop UI 无关；
2. API 已稳定；
3. 在产品中被真实使用；
4. 有独立 example；
5. 有测试；
6. 对普通 OpenLayers 开发者存在明确价值。

候选：

```text
@scope/ol-edit
@scope/ol-data
@scope/ol-style
@scope/ol-layer
```

避免没有明确边界的：

```text
ol-utils
ol-helper
ol-common
```

---

## 20. 测试重点

### gis-core

必须重点测试：

- Project serialization；
- FeatureStore；
- Selection；
- EditCommand；
- Undo / Redo。

### ol-runtime

重点：

- Domain Feature ↔ OL Feature；
- Layer Registry；
- Tool activate/deactivate；
- OpenLayers event → EditCommand；
- Selection sync。

### desktop

优先覆盖关键 Use Case，而不是追求所有 UI 组件测试覆盖率。

---

## 21. 禁止事项

V0.1 开发 Agent 不要：

- 引入 Cesium；
- 设计统一二三维 MapEngine；
- 加 Terrain / Scene / Camera；
- 加插件系统；
- 拆十几个 package；
- 引入复杂 Event Bus；
- 在 Vue 组件中散落创建 OL Interaction；
- 把 `ol.Feature` 当唯一业务 Feature；
- 把 Pinia 当数据库；
- 提前为百万 Feature 做复杂优化；
- 引入 Python / GDAL。

---

## 22. 推荐实施顺序

```text
1. Workspace Shell
2. gis-core 基础类型
3. OlMapRuntime
4. Project Save / Open
5. GeoJSON Loader
6. Dataset / Layer
7. Layer Panel
8. FeatureStore
9. Selection
10. Attribute Table
11. Tool Runtime
12. Draw
13. Modify / Delete
14. EditCommand
15. Undo / Redo
16. Export
17. Dirty / Error / Empty State
18. Tests
19. 文档和 Example
```

每一个阶段结束后都应保持应用可运行。

禁止连续进行大量“架构重构”后再一次性恢复功能。

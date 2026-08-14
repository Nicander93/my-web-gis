# 桌面 WebGIS — PRD V0.1

> 文档状态：Draft  
> 产品阶段：V0.1  
> 产品形态：二维桌面 GIS 工作台  
> 核心地图引擎：OpenLayers  
> 本文面向开发 Agent，可直接作为 V0.1 实施依据。

---

## 1. 产品定位

本项目是一个使用现代 Web 技术实现的轻量二维桌面 GIS。

V0.1 不追求替代 QGIS，也不追求覆盖完整 GIS 能力。第一阶段目标是形成一个完整、稳定、可持续演进的 GIS 工作闭环：

```text
新建 / 打开项目
        ↓
导入二维 GIS 数据
        ↓
生成并管理图层
        ↓
浏览 / 选择 Feature
        ↓
编辑几何与属性
        ↓
Undo / Redo
        ↓
保存项目 / 导出数据
```

长期方向：

- 持续增强二维 GIS 能力；
- 从桌面 GIS 的真实需求中沉淀可独立发布的 OpenLayers packages；
- 架构上保留未来引入三维 GIS 的可能；
- V0.1 不实现 Cesium，也不为未来三维过度抽象。

---

## 2. 产品目标

V0.1 的目标不是“做一个 OpenLayers Demo”，而是：

> 做出一个真正可以完成简单 GIS 数据查看、编辑和保存任务的桌面工作台。

用户应能够完成：

1. 新建项目；
2. 导入 GeoJSON；
3. 查看地图；
4. 管理多个图层；
5. 选择 Feature；
6. 查看和修改属性；
7. 绘制 Point / LineString / Polygon；
8. 修改和删除 Feature；
9. Undo / Redo；
10. 保存项目；
11. 导出 GeoJSON；
12. 关闭后重新打开并恢复项目。

---

## 3. 目标用户

V0.1 主要面向：

- GIS / WebGIS 开发者；
- 需要轻量查看和编辑二维矢量数据的用户；
- 希望使用现代桌面 UI 管理 GeoJSON 等 GIS 数据的用户。

V0.1 暂不主要面向：

- 专业测绘生产；
- 遥感处理；
- 大型空间数据库分析；
- 高级制图出版；
- 海量矢量数据生产。

---

## 4. 产品原则

### 4.1 2D-first

当前只实现二维 OpenLayers。

允许领域模型避免与 OpenLayers 强耦合，但不得为了未来 Cesium 提前设计复杂的：

- MapEngine；
- Scene；
- Camera；
- Terrain；
- Primitive；
- 统一二三维渲染 API。

### 4.2 先产品，后抽包

不要先设计大量 npm packages。

正确演进方式：

```text
桌面 GIS 出现真实需求
        ↓
在产品中实现并验证
        ↓
能力边界稳定
        ↓
抽取为 OpenLayers package
        ↓
独立发布
```

### 4.3 地图是主视图，不是全部产品

产品应表现为 GIS Workspace，而不是一个“地图网页”。

### 4.4 V0.1 必须收敛

任何不能加强“项目 → 数据 → 图层 → Feature → 编辑 → 保存”闭环的功能，默认推迟。

---

## 5. 核心用户流程

### 5.1 首次启动

```text
启动应用
   ↓
Start Page
   ├── New Project
   ├── Open Project
   └── Recent Projects
```

新建后进入空工作区。

---

### 5.2 导入数据

```text
Add Data
   ↓
选择 .geojson / .json
   ↓
解析
   ↓
创建 Dataset
   ↓
创建默认 Layer
   ↓
显示在 Layer Panel
   ↓
Zoom to Layer
```

---

### 5.3 编辑数据

```text
选择可编辑 Layer
       ↓
设置为 Active Layer
       ↓
选择 Draw / Modify / Delete
       ↓
产生编辑行为
       ↓
生成 EditCommand
       ↓
更新 Feature
       ↓
记录 History
```

---

### 5.4 保存项目

项目保存：

- 项目元信息；
- Dataset 引用；
- Layer 配置；
- 图层顺序；
- 图层显隐；
- Map View；
- 样式；
- 当前数据修改结果。

不保存：

- OpenLayers 实例；
- DOM；
- 弹窗打开状态；
- hover 状态；
- 临时 interaction 状态。

---

## 6. V0.1 功能范围

### 6.1 Project

必须支持：

- New Project；
- Open Project；
- Save；
- Save As；
- Recent Projects；
- Dirty 状态；
- 未保存退出提示。

项目必须包含版本字段，支持未来 migration。

---

### 6.2 Map

支持：

- 平移；
- 滚轮缩放；
- Zoom In / Out；
- Zoom to Layer；
- Zoom to All；
- 鼠标坐标；
- 比例尺；
- 当前 CRS；
- OSM 默认底图；
- XYZ Tile 基础支持。

---

### 6.3 Dataset

V0.1 支持：

- GeoJSON File；
- 可选：GeoJSON URL。

暂不支持：

- Shapefile；
- GeoPackage；
- GeoTIFF；
- CAD；
- PostGIS；
- WFS；
- WMS；
- WMTS 编辑；
- LAS / PointCloud。

---

### 6.4 Layer

支持：

- 添加；
- 删除；
- 重命名；
- 显示 / 隐藏；
- 图层排序；
- 设置 Active Layer；
- Zoom to Layer；
- 设置基础 opacity；
- 打开属性表。

图层树中的 Active Layer 必须有明显但克制的视觉状态。

---

### 6.5 Feature Selection

支持：

- 点击选择；
- 多选；
- Clear Selection；
- 属性表行选择；
- 地图与属性表双向同步。

Selection 必须是应用级状态，而不是仅由 `ol.interaction.Select` 保存。

---

### 6.6 Feature 属性

支持：

- 查看属性；
- 修改简单字段值；
- 在属性表中浏览；
- 通过属性表选择 Feature。

V0.1 暂不做：

- 字段 Schema 设计器；
- 字段类型迁移；
- Domain Value；
- 表 Join；
- 关系表。

---

### 6.7 绘制

支持：

- Point；
- LineString；
- Polygon。

绘制完成后必须产生可撤销 EditCommand。

---

### 6.8 Modify

支持：

- 修改节点；
- 移动 Feature；
- 删除 Feature。

要求：

- 所有操作进入统一编辑历史；
- UI 不直接永久修改 OpenLayers Feature 作为唯一数据源。

---

### 6.9 Undo / Redo

以下行为必须支持撤销：

- Add Feature；
- Delete Feature；
- Update Geometry；
- Update Properties。

快捷键：

```text
Undo       Ctrl + Z
Redo       Ctrl + Shift + Z
```

---

### 6.10 Export

V0.1 支持：

- 导出当前 Layer 为 GeoJSON；
- 可选支持仅导出 Selected Features。

---

## 7. 支持的 Geometry

V0.1 至少支持：

- Point；
- MultiPoint；
- LineString；
- MultiLineString；
- Polygon；
- MultiPolygon。

编辑工具第一阶段重点：

- Point；
- LineString；
- Polygon。

---

## 8. 工作区结构

```text
┌──────────────────────────────────────────────────────────┐
│ Menu / Primary Toolbar                                   │
├──────────────┬───────────────────────────────────────────┤
│ Sidebar      │                                           │
│              │                                           │
│ Project      │                 Map Canvas                │
│ Layers       │                                           │
│ Data         │                                           │
│              │                                           │
├──────────────┴───────────────────────────────────────────┤
│ Attribute Table                                          │
├──────────────────────────────────────────────────────────┤
│ CRS | Coordinate | Scale | Selection | Save State        │
└──────────────────────────────────────────────────────────┘
```

---

## 9. 核心领域概念

V0.1 应至少存在：

```text
Project
├── Dataset[]
├── Layer[]
├── MapState
└── Settings

Dataset
└── DataSource

Layer
├── datasetId
├── style
├── visible
├── opacity
└── editable

Feature
├── id
├── geometry
└── properties

Selection
Editor
EditCommand
EditHistory
```

---

## 10. 明确不做

V0.1 不实现：

- Cesium；
- 三维 GIS；
- Terrain；
- 3D Tiles；
- 空间分析工具箱；
- Buffer；
- Clip；
- Union；
- 拓扑检查；
- 高级 Snap；
- 专业标注系统；
- Print Layout；
- Raster 分析；
- Python / GDAL Worker；
- 插件市场；
- 多人协作；
- 云项目；
- 用户权限体系；
- 超大数据量专项优化。

---

## 11. 非功能要求

### 11.1 稳定性

- 单个 Dataset 加载失败不能导致项目整体崩溃；
- 文件格式错误必须明确提示；
- 项目缺失数据时必须指出具体 Dataset；
- 未保存修改关闭应用时必须提醒。

### 11.2 性能目标

V0.1 不以百万 Feature 为目标。

建议基准：

- 1–5 万普通二维 Feature 可完成基本浏览；
- 1 万 Feature 以内常规选择和属性表操作可接受；
- 大文件导入时必须有明确加载反馈。

### 11.3 可维护性

- TypeScript strict；
- 公共类型、类、函数有注释；
- UI 不直接散落管理 OpenLayers Interaction；
- Domain / Application / Runtime / UI 边界清晰；
- 禁止为了“未来扩展”提前实现未验证能力。

---

## 12. V0.1 验收场景

### 场景 A：项目闭环

1. New Project；
2. 导入 `rivers.geojson`；
3. 导入 `stations.geojson`；
4. 修改图层顺序；
5. 修改名称；
6. Save；
7. 关闭应用；
8. 重新打开；
9. Layer、Map View 和数据状态恢复。

### 场景 B：编辑闭环

1. 选择可编辑 Layer；
2. Draw Polygon；
3. Modify Geometry；
4. 修改属性；
5. Delete Feature；
6. 连续 Undo；
7. 连续 Redo；
8. Save；
9. Export GeoJSON；
10. 重新导入导出数据后结果正确。

### 场景 C：Selection

1. 地图点击 Feature；
2. 属性表定位并选中对应行；
3. 属性表点击另一行；
4. 地图 Feature 高亮同步；
5. 多选；
6. Clear。

---

## 13. 里程碑

### M0 — Desktop Shell

- Tauri；
- Vue；
- OpenLayers；
- Workspace Layout；
- 空地图；
- Menu / Status Bar。

### M1 — Project & Dataset

- Project Model；
- Save / Open；
- GeoJSON Loader；
- Dataset；
- Layer Tree。

### M2 — Selection & Attribute

- Feature Model；
- Selection；
- Feature Inspector；
- Attribute Table。

### M3 — Edit

- Tool Manager；
- Draw；
- Modify；
- Delete；
- EditCommand；
- Undo / Redo。

### M4 — 完善

- Export；
- Recent Projects；
- Dirty State；
- Empty / Error State；
- UI 收敛；
- 测试；
- 文档。

---

## 14. Definition of Done

V0.1 只有同时满足以下条件才算完成：

- 用户可以独立完成一次二维矢量数据编辑任务；
- 项目能够关闭并重新恢复；
- GeoJSON 可以导入、编辑、导出；
- Selection / Editor / History 是应用状态，不依赖 Vue 组件自身维持；
- Domain Model 不依赖 OpenLayers；
- OpenLayers Runtime 生命周期集中管理；
- 不包含三维、空间分析、插件市场等超出 V0.1 范围的重型能力。

# 桌面 WebGIS — UI 实施设计规范 V0.1

> 文档用途：供开发 Agent 在实现桌面 WebGIS V0.1 时直接对照。  
> 适用范围：Tauri 2 + Vue 3 桌面端 UI。  
> 设计定位：**全屏桌面 GIS 生产力工具 + 极简 + 克制 + 轻手绘**。  
> 本文是 UI 实施规范，不替代 PRD 和技术架构。

---

## 1. 设计目标

V0.1 的界面首先必须像一个真正的桌面 GIS 工作台，而不是 Mini App、Web Dashboard、SaaS 管理后台或仅包了一层桌面壳的 OpenLayers Demo。

核心体验：

```text
桌面窗口
  ↓
打开 / 新建项目
  ↓
地图工作区占据视觉中心
  ↓
左侧管理 Project / Layers / Data
  ↓
顶部执行高频 GIS 操作
  ↓
底部查看 Attribute Table / Feature
  ↓
状态栏持续反馈 CRS / 坐标 / 比例尺 / Selection / Dirty
```

设计必须满足：

```text
高信息密度
低视觉噪音
明确操作状态
```

---

## 2. 参考设计图

### 2.1 Start Page

![Start Page](./assets/01-start-page.png)

### 2.2 Main Workspace

![Main Workspace](./assets/02-main-workspace.png)

### 2.3 Dataset Import

![Dataset Import](./assets/03-data-import.png)

### 2.4 Feature Editing

![Feature Editing](./assets/04-feature-editing.png)

> 设计图用于确认整体气质、密度、布局比例和交互方向。代码实现应优先遵守本文尺寸、组件状态和 PRD 边界，不要求逐像素复刻生成图中的所有细节。

---

# 3. 整体布局

## 3.1 窗口

产品默认作为最大化或接近全屏的桌面生产力工具使用。

推荐设计基准：

```text
1440 × 900
1920 × 1080
```

最低可用：

```text
1024 × 680
```

主布局：

```text
┌────────────────────────────────────────────────────────────────────┐
│ Native Window / App Title                                          │
├────────────────────────────────────────────────────────────────────┤
│ Menu Bar                                                           │
├────────────────────────────────────────────────────────────────────┤
│ Primary Toolbar                                                    │
├───────────────┬────────────────────────────────────────────────────┤
│               │                                                    │
│ Sidebar       │                    Map Canvas                      │
│ 220–280px     │                                                    │
│               │                                                    │
├───────────────┴────────────────────────────────────────────────────┤
│ Bottom Panel / Attribute Table                         180–360px    │
├────────────────────────────────────────────────────────────────────┤
│ Status Bar                                                   24px   │
└────────────────────────────────────────────────────────────────────┘
```

原则：

- Map Canvas 始终是最大区域；
- Sidebar 和 Bottom Panel 支持 resize；
- Bottom Panel 可折叠 / 关闭；
- V0.1 **不默认增加永久右侧 Inspector**；
- 不使用“大卡片拼接式”工作区；
- 页面应充分利用整个桌面窗口。

---

# 4. Design Tokens

建议统一定义在：

```text
apps/desktop/src/styles/tokens.css
```

## 4.1 Color

```css
--color-app-bg: #f6f6f3;
--color-panel: #fbfbf9;
--color-surface: #ffffff;

--color-text-primary: #252522;
--color-text-secondary: #74736d;
--color-text-muted: #a19f98;

--color-border: #e2e1db;
--color-border-strong: #cfcec7;

--color-hover: #f0efea;
--color-selected: #e8ece8;
--color-active: #dde6dc;

--color-accent: #586b5d;
--color-accent-soft: #dfe8de;

--color-danger: #a64c47;
--color-warning: #9a742f;
--color-success: #56835b;
```

限制：

- Accent 只用于 UI 状态，不用于 GIS 专题图统一着色；
- 不使用默认 Bootstrap 蓝；
- 不使用 Neon；
- 不使用大面积渐变；
- 不使用大面积高饱和绿色背景。

---

## 4.2 Typography

UI：

```text
Inter
system-ui
Noto Sans SC
sans-serif
```

坐标 / CRS / 数值：

```text
Maple Mono
JetBrains Mono
monospace
```

推荐字号：

| 场景 | 字号 |
|---|---:|
| Menu | 12–13px |
| Toolbar Label | 11–12px |
| Panel Title | 12px / 500 |
| Body | 12–13px |
| Layer Row | 12px |
| Table | 12px |
| Status | 11px |
| Tooltip | 11–12px |
| Dialog Title | 14px |
| Start Page Title | 20–22px |

禁止大面积使用 16px+ 默认正文和 24px+ 标题。

---

## 4.3 Spacing / Radius / Border

基础间距单位：

```text
4px
```

推荐：

```text
xs = 4px
sm = 6px
md = 8px
lg = 12px
xl = 16px
```

圆角：

```text
Small Control    4px
Button           5px
Dropdown         6px
Dialog           8px
```

Panel 默认无阴影，统一使用：

```text
1px solid var(--color-border)
```

Shadow 只允许用于 Dialog、Context Menu、Dropdown、Command Palette 和 Tooltip。

---

# 5. Start Page

Start Page 是工作台入口，不是 Landing Page。

结构：

```text
┌─────────────────────────────────────────────────────────────┐
│ Menu                                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│       small hand-drawn GIS mark                             │
│                                                             │
│       Desktop WebGIS                                        │
│       Lightweight 2D GIS workspace                          │
│                                                             │
│       [ New Project ]    [ Open Project ]                   │
│                                                             │
│       Recent Projects                                       │
│       ─────────────────────────────────────                 │
│       Rivers Project             D:/projects/rivers         │
│       City Edit                  D:/projects/city-edit      │
│       Water Demo                 D:/projects/demo-water     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

必须支持：

- New Project；
- Open Project；
- Recent Projects；
- Recent Project 点击打开；
- 项目路径；
- 最近访问时间；
- Settings 入口。

不要实现：

- Banner；
- 新闻；
- 模板市场；
- 教程轮播；
- Dashboard KPI；
- 大型营销插画。

手绘面积建议不超过页面视觉面积的约 10%。

---

# 6. Main Workspace

Main Workspace 是 V0.1 最重要的界面。

## 6.1 Menu Bar

高度：

```text
28–30px
```

建议：

```text
File
Edit
View
Layer
Tools
Help
```

### File

```text
New Project
Open Project
Save
Save As
────────────
Add GeoJSON
Export Layer
────────────
Close Project
Exit
```

### Edit

```text
Undo
Redo
────────────
Delete Selected Feature
```

### View

```text
Zoom to All
Toggle Sidebar
Toggle Attribute Table
```

### Layer

```text
Add Data
Zoom to Layer
Open Attribute Table
Rename
Export
Remove
```

---

# 7. Primary Toolbar

高度：

```text
38–42px
```

V0.1 默认只出现：

```text
Select
Pan
Draw ▼
Modify
Delete
|
Undo
Redo
|
Save
```

Draw Dropdown：

```text
Point
LineString
Polygon
```

建议：

```text
Toolbar Button = 32 × 30px
Icon = 16–18px
```

默认 icon-only，Hover 显示 Tooltip。

Active Tool：

```text
浅色背景
+
细 outline
或
轻微手绘底线
```

不能使用大面积深色块。

---

## 7.1 Active Tool 规则

应用同时只能存在一个 Active GIS Tool。

```text
Pan
Select
Draw Point
Draw Line
Draw Polygon
Modify
Delete
```

交互：

```text
点击 Draw Polygon
  ↓
原 Active Tool 取消
  ↓
Polygon Active
  ↓
Toolbar 显示 Active
  ↓
Map 显示轻量 Tool Hint
```

Esc 退出当前临时编辑状态。

---

# 8. Sidebar

推荐：

```text
默认 240px
最小 200px
最大 320px
```

顶部 Tab：

```text
Project | Layers | Data
```

默认进入：

```text
Layers
```

---

## 8.1 Layer Panel

```text
Layers                         [+] [...]

☑  ──  Boundary
☑  ~   Rivers               ▶
☑  ●   Stations
☐  ▧   Parcels
```

Layer Row：

```text
Height: 28–32px
```

结构：

```text
[visibility] [symbol] [name] [active marker] [...]
```

---

## 8.2 Layer State

必须区分：

### Visible

Checkbox checked。

### Selected Row

表示 UI 当前选中行：

```text
background: --color-selected
```

### Active Layer

表示 Draw / Modify / Delete 等工具的目标：

```text
左侧 2px accent line
或
▶ marker
```

不要仅依赖高饱和背景色区分 Active。

---

## 8.3 Layer Context Menu

```text
Zoom to Layer
Open Attribute Table
Set Active Layer
────────────
Rename
Opacity
Export GeoJSON
────────────
Remove
```

`Remove` 放最后，并使用克制的 Danger 色。

支持 Drag & Drop 调整图层顺序；拖动时显示插入线，不使用大卡片式动画。

---

# 9. Map Canvas

Map Canvas 是绝对视觉中心。

要求：

- 不放欢迎文字；
- 不放装饰插画；
- 不使用大型浮动 UI；
- OpenLayers Canvas 使用所有剩余空间。

地图内仅允许：

```text
Zoom + / -
Scale
Attribution
Tool Hint
必要的 loading feedback
```

---

## 9.1 Map Tool Hint

例如：

```text
Polygon · click to add vertex · double-click to finish
```

位置：地图左下或底部中央。

样式：

```text
11px
轻背景
不阻挡地图
```

---

## 9.2 Selection Style

Selection 必须独立于 Layer Style。

```text
原 Layer Style
+
Selection Overlay
```

Polygon 示例：

```text
outline: accent
fill: accent 10–15%
vertex: small circle
```

不要修改 Layer 原始 Style 来表达 Selection。

---

# 10. Bottom Panel

V0.1 默认承担：

```text
Attribute Table
Feature Inspector
```

Tab：

```text
Table | Feature
```

高度：

```text
默认 220px
最小 160px
最大约窗口高度 45%
```

支持 Collapse、Close、Resize。

---

# 11. Attribute Table

Header：

```text
Attributes — Rivers        Selected 2 / 358      [filter] [×]
```

建议：

```text
Header Height   28–32px
Row Height      26–30px
Font            12px
```

必须实现：

```text
Map Selection → Table Selected Row
Table Row Click → Map Selection
```

选中行使用低饱和浅背景，不使用大面积鲜蓝。

---

## 11.1 Table Editing

简单字段值编辑：

```text
Double Click Cell
    ↓
Inline Input
    ↓
Enter Save
Esc Cancel
```

修改完成产生：

```text
UpdatePropertiesCommand
```

表格内部状态不能成为 Feature 的最终数据源。

---

# 12. Feature Inspector

单 Feature 选择时使用 Bottom Panel 第二个 Tab：

```text
Table | Feature
```

内容：

```text
Feature

Geometry
Polygon

Properties
────────────────
name       Reservoir A
level      2
capacity   1200
```

属性值点击后进入编辑，Enter 保存、Esc 取消。

### 关于右侧 Inspector

生成设计图中出现过永久右侧属性面板，但 V0.1 实施时默认**不采用**该布局。

原因：

- 左 Sidebar + 右 Inspector 会持续挤压地图；
- 与原 UI/UX 规范中“地图主视图优先”冲突；
- Attribute Table 与 Feature Inspector 本身就属于同一数据查看上下文。

如果后续实验右侧 Inspector，应可关闭，并保证 Map Canvas 始终占主体区域。

---

# 13. Draw Workflow

以 Polygon 为例：

```text
选择 Active Layer
      ↓
Draw ▼
      ↓
Polygon
      ↓
地图进入 Drawing 状态
      ↓
Click Add Vertex
      ↓
Double Click Finish
      ↓
AddFeatureCommand
      ↓
FeatureStore
      ↓
OL Runtime 更新
      ↓
Project Dirty
```

绘制中：

- 已确定线：Accent；
- 未确定 segment：虚线；
- Vertex：约 5–7px；
- Cursor 附近只显示轻量 hint。

不要加入粒子、Glow、动画路径等装饰效果。

---

# 14. Modify Workflow

```text
选择 Feature
  ↓
Modify
  ↓
显示 Vertex
  ↓
拖动 Vertex / Feature
  ↓
结束操作
  ↓
UpdateGeometryCommand
```

修改过程中：

- 当前 Feature outline 加强；
- Vertex 使用小型 circle / square；
- 不隐藏其他 Layer；
- Status Bar 显示 `Editing · Rivers`。

---

# 15. Delete

Delete 作用于当前 Selection。

单个 Feature：

```text
Delete
→ 删除
→ 可 Undo
```

多个 Feature 建议：

```text
Delete 12 selected features?

[Cancel] [Delete]
```

单个 Feature 不需要每次弹确认框，Undo 是主要恢复入口。

---

# 16. GeoJSON Import

V0.1 入口：

```text
Add Data
```

系统文件选择器仅支持：

```text
.geojson
.json
```

成功流程：

```text
解析文件
→ Dataset
→ FeatureStore
→ Layer
→ Map
→ Zoom to Layer
```

较大文件只显示轻量反馈：

```text
Importing rivers.geojson…
```

禁止全屏 Loading。

Invalid GeoJSON：

```text
Couldn't open this file

The file is not valid GeoJSON.

[Show details]

                        [Close]
```

默认不要展示 JS Stack。

---

# 17. Broken Dataset

项目重新打开但文件不存在：

```text
! Rivers
  File not found
```

要求：

- 其他正常 Layer 继续工作；
- Map 不崩溃；
- 可 Locate File；
- 可 Remove Layer。

---

# 18. Export GeoJSON

入口：

```text
Layer Context Menu
或
File → Export
```

Dialog：

```text
Export GeoJSON

Layer
[Rivers                ▼]

Export
(●) All features
( ) Selected features

File
[D:/.../rivers.geojson] [Browse]

                 [Cancel] [Export]
```

`selection = 0` 时，Selected Features disabled。

---

# 19. Project Dirty

推荐 Window Title：

```text
Desktop WebGIS — Rivers *
```

Status Bar 同时可以显示：

```text
Modified
```

Save 后变为：

```text
Saved
```

以下 UI 临时状态不得触发 dirty：

```text
sidebar resize
bottom panel resize
hover
dialog open
activeSidebarTab
```

---

# 20. Unsaved Exit

```text
Save changes to “Rivers”?

Your changes will be lost if you don't save.

[Cancel] [Don't Save] [Save]
```

使用桌面软件语义，不使用网页式“Are you sure?”大警告界面。

---

# 21. Status Bar

高度：

```text
22–26px
```

推荐：

```text
EPSG:3857
|
106.7134, 26.5812
|
1:25,000
|
Selected: 2
|
Modified
```

临时消息可短暂出现在右侧：

```text
rivers.geojson imported
Saved
Drawing Polygon
```

不要所有操作都使用 Toast。

---

# 22. Command Palette

建议保留：

```text
Ctrl + Shift + P
```

示例：

```text
> draw polygon

Draw Polygon
Add GeoJSON
Open Attribute Table
Zoom to Layer
Export Layer
```

宽度约 480–560px。

它的作用是避免 Toolbar 随功能增加持续膨胀。

---

# 23. Keyboard

V0.1：

```text
Ctrl + N            New Project
Ctrl + O            Open Project
Ctrl + S            Save
Ctrl + Shift + S    Save As

Ctrl + Z            Undo
Ctrl + Shift + Z    Redo

Delete              Delete Selected
Esc                 Exit Current Tool

Ctrl + Shift + P    Command Palette
```

快捷键、Toolbar、Menu 必须调用同一个 AppCommand，不要分别实现三套业务逻辑。

---

# 24. Empty States

## 24.1 Empty Project

```text
~ small hand-drawn folded map ~

No layers yet

Drop a GeoJSON here
or
[ Add Data ]
```

## 24.2 No Selection

```text
Select a feature to inspect its attributes.
```

## 24.3 Empty Recent Projects

```text
No recent projects

[ Open Project ]
```

---

# 25. Hand-drawn Language

手绘不是整个组件库的视觉风格，而是人格化层。

允许：

- App Logo；
- GIS 小插画；
- Empty State；
- 少量 Toolbar Icon；
- Active underline；
- 极轻的不规则 divider。

禁止用于：

- Attribute Table；
- Input；
- Status Bar；
- 坐标；
- CRS；
- Error text；
- 数据值。

Icon 推荐：

```text
1.5–1.8px stroke
simple outline
slightly imperfect
```

不要故意画歪所有图标。

---

# 26. UI 组件结构建议

```text
components/
├─ shell/
│  ├─ AppMenuBar.vue
│  ├─ PrimaryToolbar.vue
│  ├─ WorkspaceSidebar.vue
│  ├─ BottomPanel.vue
│  └─ StatusBar.vue
│
├─ map/
│  ├─ MapCanvas.vue
│  └─ MapToolHint.vue
│
├─ layers/
│  ├─ LayerPanel.vue
│  ├─ LayerRow.vue
│  └─ LayerContextMenu.vue
│
├─ attributes/
│  ├─ AttributeTable.vue
│  └─ FeatureInspector.vue
│
├─ project/
│  ├─ StartPage.vue
│  └─ RecentProjectList.vue
│
└─ shared/
   ├─ AppDialog.vue
   ├─ AppDropdown.vue
   ├─ AppTooltip.vue
   └─ EmptyState.vue
```

这是 UI 组件建议，不能突破技术架构边界。

禁止：

```ts
// Vue component
new Draw(...)
new Modify(...)
new Select(...)
```

正确：

```text
UI Event
  ↓
Application Command / Store
  ↓
OlToolRuntime
```

---

# 27. State 边界

UI Store：

```text
activeSidebarTab
sidebarWidth
bottomPanelOpen
bottomPanelTab
bottomPanelHeight
dialog
commandPaletteOpen
```

GIS / Application State：

```text
currentProject
activeLayerId
selection
activeTool
editHistory
dirty
```

不要创建一个巨型 `useAppStore()` 存所有状态。

---

# 28. Window Resize

这是桌面应用，不做 Mobile Responsive。

1440+：

```text
Sidebar 240
Bottom 220
Map fill
```

1024 宽：

```text
Sidebar ~210
Toolbar 仅 icon
隐藏非必要 label
```

高度 < 760：

```text
Bottom Panel 默认缩至约 180
```

禁止：

- Sidebar 自动变手机抽屉；
- Bottom Panel 变 Modal；
- Mobile Hamburger Menu。

---

# 29. 动效与可用性

普通 UI Transition：

```text
100–160ms
```

只用于：

- Hover；
- Panel open；
- Dropdown；
- Selection background。

地图和 GIS 编辑不使用装饰性动画。

最低可用性要求：

- 所有 Toolbar 图标有 Tooltip；
- Active Tool 不只通过颜色表达；
- Focus 有可见 outline；
- Context Menu 可 Esc 关闭；
- Dialog 初始焦点合理；
- 点击区域不小于约 26px。

---

# 30. 开发 Agent 禁止事项

Agent 不得自行加入：

- Cesium UI；
- 3D / Terrain / Scene；
- 空间分析 Toolbox；
- Dashboard；
- 永久双侧栏；
- 超大 Floating Action Button；
- 大量卡片；
- Material Design 式强阴影；
- 毛玻璃；
- 渐变；
- 大圆角；
- 大字号；
- 高饱和主题色；
- 不必要动画；
- 全屏 Loading；
- V0.1 之外的 Shapefile / GeoPackage / WMS / WFS 等数据源入口。

---

# 31. V0.1 页面验收清单

```text
[ ] Start Page
[ ] Recent Projects
[ ] Empty Project
[ ] Main Workspace
[ ] Layer List
[ ] Active Layer
[ ] Layer Visibility
[ ] Layer Reorder
[ ] Layer Context Menu
[ ] Attribute Table
[ ] Map ↔ Table Selection
[ ] Draw Point
[ ] Draw LineString
[ ] Draw Polygon
[ ] Modify Geometry
[ ] Delete Feature
[ ] Feature Property Edit
[ ] Undo
[ ] Redo
[ ] GeoJSON Import
[ ] Invalid GeoJSON
[ ] Broken Dataset
[ ] Export GeoJSON
[ ] Project Dirty
[ ] Unsaved Exit Dialog
[ ] Status Bar
```

---

# 32. UI Definition of Done

UI V0.1 只有同时满足以下要求才算完成：

1. 第一眼是桌面 GIS 生产力工具，而不是网页后台；
2. 默认窗口充分利用整个桌面空间；
3. Map Canvas 是绝对视觉中心；
4. Sidebar / Map / Attribute Table 层级明确；
5. 1440×900 下没有“大而空”的 SaaS 式组件；
6. 1024×680 仍可完成 GIS 编辑；
7. Active Tool、Active Layer、Selection、Dirty 都有明确状态；
8. Draw / Modify / Delete / Undo / Redo 的反馈完整；
9. 地图和属性表 Selection 双向同步；
10. 手绘风只承担人格表达，不损害 GIS 专业性；
11. UI 不直接管理 OpenLayers Interaction；
12. 没有超出 PRD V0.1 自行扩展重型功能。

---

# 33. 给 Agent 的实现优先级

```text
信息架构
>
操作效率
>
状态清晰
>
视觉一致
>
轻手绘气质
>
装饰
```

如果视觉设计和 GIS 操作效率冲突，优先 GIS 操作效率。

如果手绘感和数据可读性冲突，优先数据可读性。

如果为了某个 UI 效果需要破坏 Application / Runtime 分层，放弃该 UI 效果。

V0.1 的目标是做出一个：

> **克制、清晰、稳定、能够真正完成二维 GIS 查看和编辑闭环的全屏桌面生产力工具。**

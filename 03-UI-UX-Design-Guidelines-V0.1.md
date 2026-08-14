# 桌面 WebGIS — UI / UX 设计规范 V0.1

> 设计关键词：**极简、克制、轻手绘、桌面工具感、GIS 专业性**。  
> 手绘是一种气质，不是把整个应用做成儿童插画。

---

## 1. 设计目标

界面需要同时满足：

1. GIS 信息密度；
2. 长时间桌面使用；
3. 地图主视图优先；
4. 操作路径短；
5. UI 不喧宾夺主；
6. 有少量明确的手绘人格化特征。

目标不是：

- QGIS UI 复刻；
- Web Dashboard；
- 大圆角 SaaS；
- 满屏卡片；
- 满屏工具按钮。

更接近：

```text
Figma / VS Code / Linear 的克制密度
+
轻手绘图标 / 空状态 / 边缘细节
+
桌面 GIS 工作流
```

---

## 2. 视觉原则

### 2.1 地图优先

Map Canvas 应始终是最大区域。

不要：

- 用大卡片覆盖地图；
- 使用大型浮动面板；
- 在地图区域堆大量按钮；
- 使用大字号说明文字。

### 2.2 手绘只用于性格表达

适合手绘：

- Logo；
- App Icon；
- Empty State；
- 少量 Toolbar Icon；
- Active 下划线；
- Tooltip 插图；
- onboarding。

不适合手绘：

- 属性表；
- 坐标文本；
- 比例尺；
- 数据字段；
- GIS Geometry；
- 错误信息主体。

### 2.3 控件尺寸偏小

产品是生产力工具。

默认密度应比普通 Web 管理后台更紧凑。

---

## 3. 默认工作区

推荐设计基准：

```text
1440 × 900
```

最小建议：

```text
1024 × 680
```

布局：

```text
┌──────────────────────────────────────────────────────────┐
│ 40px Menu / Primary Toolbar                              │
├──────────────┬───────────────────────────────────────────┤
│              │                                           │
│ 240px        │                                           │
│ Sidebar      │                Map Canvas                 │
│              │                                           │
│              │                                           │
├──────────────┴───────────────────────────────────────────┤
│ 220px Bottom Panel                                       │
├──────────────────────────────────────────────────────────┤
│ 24px Status Bar                                          │
└──────────────────────────────────────────────────────────┘
```

建议：

- Sidebar：220–280px；
- Bottom Panel：180–360px；
- Panel 支持拖拽 resize；
- Map 使用剩余空间；
- Top Bar：36–42px；
- Status Bar：22–26px。

---

## 4. 页面结构

### 4.1 Start Page

启动后：

```text
┌──────────────────────────────────────────────┐
│                         [Settings]           │
│                                              │
│          hand-drawn map mark                 │
│                                              │
│          New Project                         │
│          Open Project                        │
│                                              │
│          Recent Projects                     │
│          ─────────────────────               │
│          demo-water                          │
│          city-edit                           │
│                                              │
└──────────────────────────────────────────────┘
```

要求：

- 非营销页面；
- 大量留白；
- 最近项目占主要信息；
- 手绘插画控制在小面积。

---

### 4.2 Main Workspace

```text
┌────────────────────────────────────────────────────────┐
│ File Edit View │ Select Pan Draw Modify │ Undo Redo    │
├────────────┬───────────────────────────────────────────┤
│ Project    │                                           │
│ Layers     │                                           │
│ Data       │                 MAP                       │
│            │                                           │
│ Layers:    │                                           │
│ ☑ Rivers   │                                           │
│ ☑ Stations │                                           │
│ ☐ Boundary │                                           │
├────────────┴───────────────────────────────────────────┤
│ Attribute Table                                        │
├────────────────────────────────────────────────────────┤
│ EPSG:3857   106.7,26.5   1:25,000   Selected: 2       │
└────────────────────────────────────────────────────────┘
```

---

## 5. 顶部 Toolbar

默认只保留高频工具：

```text
Select
Pan
Draw
Modify
Delete
Undo
Redo
```

Draw 可以使用 Dropdown：

```text
Draw
├─ Point
├─ Line
└─ Polygon
```

不要第一版铺出：

```text
Zoom In
Zoom Out
Full Extent
Previous Extent
Next Extent
Box Select
Polygon Select
...
```

低频能力放：

- Menu；
- Layer Context Menu；
- Command Palette。

---

## 6. Sidebar

V0.1 只建议三个区域：

```text
Project
Layers
Data
```

可以使用顶部小型 tab/icon 切换。

### Layers 是默认页

```text
Layers

☑ Boundary
▶ Rivers
☑ Stations
```

其中：

```text
▶ Rivers
```

表示 Active Layer。

Active 与 Selected 必须区分：

- Active Layer：后续 GIS 操作目标；
- Selected Layer Row：当前 UI 选中的图层行。

V0.1 可允许两者同步，以降低复杂度。

---

## 7. Layer Row

建议高度：

```text
28–32px
```

结构：

```text
[☑] [symbol] Rivers              [...]
```

Hover：

- 背景轻微变化；
- 显示 `...`；
- 不使用大面积阴影。

Active：

- 左侧 2px 手绘感短线；
- 或浅色背景；
- 不能使用高饱和大蓝块。

右键菜单：

```text
Zoom to Layer
Open Attribute Table
Edit
Style
Rename
Export
────────────
Remove
```

---

## 8. Map Canvas

Map 本身应该非常干净。

允许存在：

- 右下角 Zoom；
- Scale；
- 必要 Attribution；
- 工具状态提示。

例如正在 Draw Polygon：

```text
┌────────────────────────────────────┐
│                                    │
│                Map                 │
│                                    │
│  Polygon • click to add vertex     │
│                                    │
└────────────────────────────────────┘
```

这个提示应非常小。

---

## 9. Selection

选中 Feature：

- 使用清晰但不过度抢眼的高亮；
- 多选保持一致视觉；
- 不使用动画闪烁。

Selection 与地图样式区分：

```text
Layer Style
     +
Selection Overlay
```

不要修改 Layer 本身 style 来表达 Selection。

---

## 10. Bottom Panel

V0.1 主要用于 Attribute Table。

结构：

```text
Attributes — Rivers                     [×]

Selected: 2 / 358

┌─────┬─────────┬────────┬───────────┐
│ fid │ name    │ level  │ length    │
├─────┼─────────┼────────┼───────────┤
│ 001 │ River A │ 1      │ 14.3      │
│ 002 │ River B │ 2      │ 10.1      │
└─────┴─────────┴────────┴───────────┘
```

要求：

- 表头 28–32px；
- 行高 26–30px；
- 选中行与 Map Selection 同步；
- 表格是严肃数据 UI，不使用手写字体。

---

## 11. Feature Inspector

单 Feature 选择时，可以在右侧临时 Inspector 或 Bottom Panel 中显示。

V0.1 建议优先使用 Bottom Panel 的第二个 Tab：

```text
Table | Feature
```

Feature：

```text
Feature

Geometry
Polygon

Properties
────────────
name      Reservoir A
level     2
capacity  1200
```

不要一开始增加永久右侧 Panel，避免地图区域被夹得太窄。

---

## 12. Status Bar

高度：

```text
22–26px
```

显示：

```text
EPSG:3857
106.7134, 26.5812
1:25,000
Selected: 2
Modified
```

文本字号：

```text
11–12px
```

Status Bar 不做手绘风。

---

## 13. 色彩

整体以中性灰白为主。

参考值：

```text
App Background       #F6F6F3
Panel                #FBFBF9
Surface              #FFFFFF

Text Primary         #252522
Text Secondary       #74736D
Text Muted           #A19F98

Border               #E2E1DB
Hover                #F0EFEA
Selected             #E8ECE8

Accent               #586B5D
Danger               #A64C47
Warning              #9A742F
```

这些不是不可修改的品牌色，允许设计阶段继续调整。

原则：

- Accent 低饱和；
- 不使用默认 Bootstrap 蓝；
- 不使用大量渐变；
- 不使用 Neon；
- GIS 数据颜色与 UI Accent 解耦。

---

## 14. Dark Mode

V0.1 可以暂不实现。

架构和 design token 应允许未来支持，但不要为了 Dark Mode 延迟 V0.1。

---

## 15. Typography

UI：

```text
Inter
system-ui
Noto Sans SC
```

代码/坐标：

```text
Maple Mono
JetBrains Mono
system monospace
```

建议字号：

```text
Menu                12–13px
Toolbar             12px
Panel Title         12px Medium
Body                12–13px
Table               12px
Status              11px
Tooltip             11–12px
Start Page Title    18–22px
```

不要大面积使用：

```text
24px+
```

---

## 16. 圆角

整体克制：

```text
Small control      4–6px
Button             5–7px
Dialog             8–10px
Card               8px
```

不要：

```text
16px / 24px
```

大圆角会让界面偏 SaaS / Mobile。

---

## 17. Border 与 Shadow

优先使用：

```text
1px Border
```

而不是大量阴影。

Shadow 仅用于：

- Dialog；
- Context Menu；
- Command Palette；
- Dropdown。

Panel 之间使用 Border。

---

## 18. 手绘语言

推荐：

### Icon

- 简单线条；
- 略微不规则；
- 线宽约 1.5–1.8px；
- 不需要所有图标都故意歪曲。

### Divider

关键区域可以使用极轻微的不规则短线作为装饰。

### Empty State

例如无 Layer：

```text
      ~ small hand-drawn folded map ~

No layers yet

Drop a GeoJSON here
or
[ Add Data ]
```

### Active Marker

可用略有手写感的：

```text
—
```

而不是标准实心色块。

---

## 19. Button

### Primary

V0.1 很少使用 Primary Button。

例如：

```text
[ New Project ]
```

可以使用实体色。

### Toolbar Button

默认：

```text
Icon only
32 × 30px
```

Hover 显示 Tooltip。

Selected：

- 浅背景；
- 轻 outline；
- 或底部手绘线。

---

## 20. Dialog

例如 Import Error：

```text
┌──────────────────────────────┐
│ Couldn't open this file      │
│                              │
│ Invalid GeoJSON geometry.    │
│                              │
│                  [ Close ]   │
└──────────────────────────────┘
```

原则：

- 不写技术堆栈给普通用户；
- 可提供 `Show details`；
- Dialog 不超过必要尺寸。

---

## 21. Empty State

需要重点设计四个状态：

### Empty Project

```text
No layers yet
Drop GeoJSON here
[ Add Data ]
```

### Loading

避免全屏 Spinner。

优先：

```text
Importing rivers.geojson…
```

### Broken Dataset

Layer Panel：

```text
! Rivers
  File not found
```

允许其他正常 Layer 继续使用。

### No Selection

Feature Inspector：

```text
Select a feature to inspect its attributes.
```

---

## 22. Context Menu

Layer Context Menu 是重要入口。

不要把所有操作放工具栏。

Menu 密度：

```text
28–30px / item
```

危险操作：

```text
Remove
```

放到底部并使用克制 danger color。

---

## 23. Command Palette

建议从 V0.1 留出能力。

快捷键可采用：

```text
Ctrl + Shift + P
```

示例：

```text
> Add GeoJSON
  Open Project
  Save Project
  Zoom to Layer
  Open Attribute Table
  Draw Polygon
  Export Layer
```

Command Palette 有助于避免 Toolbar 不断膨胀。

---

## 24. Keyboard

最低要求：

```text
Ctrl + N           New Project
Ctrl + O           Open
Ctrl + S           Save
Ctrl + Shift + S   Save As

Ctrl + Z           Undo
Ctrl + Shift + Z   Redo

Delete             Delete Selected Feature
Esc                Exit Current Tool / Clear Temporary State
```

不要第一版塞太多快捷键。

---

## 25. Feedback

所有操作必须有状态反馈。

例如：

```text
Saved
3 features selected
Drawing Polygon
rivers.geojson imported
```

使用：

- Status Bar；
- Toast；
- Inline Message。

不要所有操作都 Toast。

---

## 26. 设计禁区

开发 Agent 不要自行加入：

- 大型 Welcome Banner；
- 大面积品牌渐变；
- Dashboard 卡片；
- 毛玻璃；
- 大阴影；
- 超大图标；
- 16px+ 默认正文；
- 大圆角；
- 满屏悬浮工具；
- 过度动画；
- 卡通化属性表；
- 地图区域装饰插画。

---

## 27. V0.1 必备设计页面

后续设计图至少需要覆盖：

1. Start / Recent Projects；
2. Empty Project；
3. Main Workspace；
4. Layer Active / Selection；
5. Attribute Table Open；
6. Draw Polygon；
7. Modify Feature；
8. Dataset Import；
9. Broken Dataset；
10. Unsaved Exit Dialog。

---

## 28. 设计验收

V0.1 UI 达标应满足：

- 第一眼是桌面 GIS，而不是网站后台；
- Map Canvas 占据绝对视觉中心；
- 控件、字号、间距足够克制；
- 常用工具一眼可见；
- 低频工具不会挤满 Toolbar；
- 手绘元素明显存在，但不影响专业性；
- 1440×900 和 1024×680 均能正常工作；
- Attribute Table、Layer Panel、Map 三者具有清晰信息层级；
- 用户无需理解 OpenLayers 即可完成基本 GIS 工作流。

# Phase-1 执行进度记录

本文件记录第一阶段各任务的实际执行情况、验证结果和交接信息。

---

## P00 — 建立基线和验收样本

**状态**: 已完成  
**执行日期**: 2026-09-28  
**前置条件**: 无

### 完成内容

1. 创建了 `docs/plans/phase-1-progress.md` 作为交接日志
2. 运行现有测试和构建,建立基线记录
3. 在 `examples/phase-1/` 下创建验收样本文件
4. 更新 `docs/plans/phase-1-gis-workbench.md` 的进度表

### 实际文件改动

**新增文件**:
- `docs/plans/phase-1-progress.md` - 本文件
- `examples/phase-1/README.md` - 样本说明文档
- `examples/phase-1/points.geojson` - 点要素样本 (3个特征)
- `examples/phase-1/lines.geojson` - 线要素样本 (2个特征)
- `examples/phase-1/polygons.geojson` - 面要素样本 (2个特征)
- `examples/phase-1/features-with-issues.geojson` - 异常数据样本 (5个特征,包含重复ID、缺失/空属性)
- `examples/phase-1/chinese-fields.zip` - Shapefile ZIP 样本 (3个点,中文字段,包含.prj)
- `examples/phase-1/coordinates-with-errors.csv` - CSV 样本 (6行,包含无效坐标、引号、换行)
- `examples/phase-1/basic-entities.dxf` - ASCII DXF 样本 (5个基础实体: POINT, LINE, LWPOLYLINE, CIRCLE, ARC)

**修改文件**:
- `docs/plans/phase-1-gis-workbench.md` - 更新 P00 进度状态

### 基线测试结果

#### 环境信息
- Node.js: v22.14.0
- pnpm: 10.33.3
- 工作区: /workspace
- 分支: cursor/p00-baseline-samples-1615 (基于 main@4e0a5f2)
- 依赖安装: 成功 (173个包)

#### 测试命令与结果

**1. gis-core 测试**
```bash
pnpm --filter @desktop-webgis/gis-core test
```
- 结果: ✅ 通过
- 测试文件: 3 个通过
- 测试用例: 3 个通过
- 耗时: 229ms
- 详细日志: /tmp/p00-gis-core-test.log

**2. vector-io 测试**
```bash
pnpm --filter @desktop-webgis/vector-io test
```
- 结果: ✅ 通过
- 测试文件: 1 个通过 (dxf.test.ts)
- 测试用例: 1 个通过
- 耗时: 194ms
- 详细日志: /tmp/p00-vector-io-test.log
- 备注: 当前只有 DXF 测试,Shapefile 相关测试尚未添加

**3. ol-runtime 测试**
```bash
pnpm --filter @desktop-webgis/ol-runtime test
```
- 结果: ✅ 通过
- 测试文件: 2 个通过
- 测试用例: 2 个通过
- 耗时: 234ms
- 详细日志: /tmp/p00-ol-runtime-test.log

**4. desktop 测试**
```bash
pnpm --filter @desktop-webgis/desktop test
```
- 结果: ✅ 通过
- 测试文件: 1 个通过 (view.commands.test.ts)
- 测试用例: 2 个通过
- 耗时: 183ms
- 警告: zustand persist middleware 在测试环境中无法访问 storage (预期行为)
- 详细日志: /tmp/p00-desktop-test.log

**5. desktop 构建**
```bash
pnpm --filter @desktop-webgis/desktop build
```
- 结果: ✅ 通过
- TypeScript 类型检查: 通过
- Vite 构建: 成功
- 输出大小:
  - index.html: 0.40 kB (gzip: 0.27 kB)
  - CSS: 21.38 kB (gzip: 5.36 kB)
  - JS: 222.33 kB (gzip: 70.24 kB)
- 耗时: 1.13s
- 详细日志: /tmp/p00-desktop-build.log

### 验收样本说明

所有样本都已创建在 `examples/phase-1/` 目录下,并附带 README.md 说明。每个样本都记录了:

1. **预期特征/记录数量**: 明确指出有效数据数量
2. **CRS**: 坐标参考系统 (主要使用 EPSG:4326)
3. **预期异常/警告**: 已知的数据问题(如重复ID、无效坐标)
4. **来源/许可**: 所有样本均为手工构造,属于 Public Domain

#### 样本覆盖范围

**矢量几何类型**:
- ✅ Point (点.geojson, chinese-fields.zip)
- ✅ LineString (lines.geojson)
- ✅ Polygon (polygons.geojson)
- ✅ 混合几何 (features-with-issues.geojson)

**数据质量问题**:
- ✅ 重复 ID (features-with-issues.geojson)
- ✅ 缺失属性 (features-with-issues.geojson)
- ✅ 空/null 属性值 (features-with-issues.geojson)

**编码与投影**:
- ✅ 中文字段名和值 (chinese-fields.zip)
- ✅ 包含 .prj 投影文件 (chinese-fields.zip, EPSG:4326)

**CSV 特殊情况**:
- ✅ 引号包裹的字段 (coordinates-with-errors.csv)
- ✅ 字段内换行符 (coordinates-with-errors.csv)
- ✅ 无效坐标值 (纬度超范围、经度非数字)
- ✅ 前导零保留场景 (ID 字段)

**DXF 实体**:
- ✅ POINT, LINE, LWPOLYLINE (封闭), CIRCLE, ARC
- ✅ 多个图层 (Layer0, Geometry, Annotations)
- ⚠️  注意: 当前为最小化 ASCII DXF,不包含复杂实体

### 未验证项

1. **WMS/WMTS/WFS 能力文档样本**: 计划在相关任务 (P16-P18) 时添加到对应 package 的 fixtures 中
2. **Shapefile 多文件导入行为**: 当前样本只包含单一点图层,后续任务需验证多图层 ZIP 的选择导入
3. **二进制 Shapefile 通道**: 本任务只创建了样本文件,未验证 Tauri 文件读取,需在 P03-P05 验证
4. **DXF 高级实体**: SPLINE、bulge POLYLINE、BLOCK/INSERT 等不在当前样本范围

### 已知限制

1. chinese-fields.zip 使用 @mapbox/shp-write 生成,字段名编码依赖该库的默认行为
2. DXF 样本只包含 2D 实体,坐标均使用简单数值,未测试大坐标或科学计数法
3. CSV 样本使用 UTF-8 编码,未包含其他编码或 BOM 变体测试
4. 所有样本文件均为小型测试数据,不代表生产环境大文件性能特征

### 下一个任务

**P01 — 面板行为与上下文保持**

前置条件: P00 (已完成)

主要工作:
- 统一收起/恢复/尺寸约束逻辑
- 右侧首次默认展开
- 专注模式与重置布局
- 会话状态按图层保存
- 面板容器与业务 Feature 解耦

涉及文件:
- `apps/desktop/src/app/Workspace.tsx`
- `apps/desktop/src/stores/workspace.store.ts`
- `apps/desktop/src/app/commands/view.commands.ts`
- 左右底部面板组件
- 属性表和 Inspector 状态管理

---

## P01 — 面板行为与上下文保持

**状态**: 已完成  
**执行日期**: 2026-09-28  
**前置条件**: P00

### 完成内容

1. **右侧面板默认展开**: 修改 workspace.store 初始状态和 resetLayout 默认值
2. **专注模式**: 保存进入前布局，收起所有面板；退出时原样恢复
3. **窗口缩放约束**: 监听 resize，确保左右面板总宽度不超过 `窗口宽度 - 320px`
4. **会话状态框架**: 新增 session.store 按图层ID保存属性表和检查器状态
5. **面板保持挂载**: 使用 display:none 隐藏而非卸载，保留业务组件状态
6. **无障碍改进**: aria-hidden 和 aria-label，恢复按钮可访问

### 实际文件改动

**新增文件**:
- `apps/desktop/src/stores/session.store.ts` - 会话状态管理

**修改文件**:
- `apps/desktop/src/stores/workspace.store.ts` - 专注模式、约束逻辑、右侧默认展开
- `apps/desktop/src/app/commands/view.commands.ts` - toggleFocusMode 命令
- `apps/desktop/src/app/commands/view.commands.test.ts` - 新增 4 个测试用例
- `apps/desktop/src/app/Workspace.tsx` - resize 监听、面板始终挂载、Ctrl+Shift+F 快捷键
- `apps/desktop/src/app/LeftPanel.tsx` - display:none + aria-hidden
- `apps/desktop/src/app/RightPanel.tsx` - display:none + aria-hidden
- `apps/desktop/src/app/BottomPanel.tsx` - display:none + aria-hidden
- `apps/desktop/src/features/inspector/Inspector.tsx` - 接入 session.store

### 测试与构建结果

**命令**: `pnpm --filter @desktop-webgis/desktop test`
- **结果**: ✅ 通过
- **测试用例**: 5 个全部通过
  - 面板切换状态报告
  - 恢复时保持尺寸
  - 专注模式往返恢复布局（新增）
  - 重置布局到新默认值（新增）
  - 窗口缩小时约束面板尺寸（新增）
- **耗时**: 182ms

**命令**: `pnpm --filter @desktop-webgis/desktop build`
- **结果**: ✅ 通过
- **TypeScript**: 编译通过
- **Vite**: 构建成功，输出 224.40 kB (gzip: 70.87 kB)
- **耗时**: 3.2s

### 验收核对

| 需求 | 状态 | 说明 |
| --- | --- | --- |
| 右侧首次默认展开 | ✅ 完成 | workspace.store 初始 right.open = true |
| 专注模式往返恢复 | ✅ 完成 | 测试通过，准确恢复开关和尺寸 |
| 重置布局新默认 | ✅ 完成 | 右侧展开作为默认 |
| 窗口缩小约束 | ✅ 完成 | 测试通过，保留 320px 地图区域 |
| 会话状态按图层 | ⚠️  框架就绪 | session.store 已实现，当前用 mock layerId |
| 面板容器解耦 | ✅ 完成 | 通过 children 注入，不反向导入 Feature |
| 无障碍焦点 | ✅ 完成 | aria-hidden + 恢复按钮 aria-label |
| 不影响 Dirty/Undo | ✅ 完成 | workspace.store 独立持久化 |

### 未验证项

1. **手动 UI 验证**: 1366×768 和 1920×1080 分辨率的实际表现
2. **真实图层切换**: 当前 Inspector 用 mock layerId，需要接入真实图层管理
3. **AttributeTable 会话**: 框架就绪但组件未接入，需要真实数据后完善
4. **专注模式菜单入口**: 快捷键已实现，菜单显示留待 P02

### 已知限制

1. session.store 当前使用硬编码 `layer-mock-001`
2. AttributeTable 组件尚未接入 session.store（搜索、页码、滚动状态）
3. 专注模式未在 UI 菜单中暴露（只有快捷键 Ctrl+Shift+F）
4. 面板最小宽度/高度仍可能在极小窗口（<760px）下溢出

### 技术细节

**专注模式实现**:
- `savedLayout` 保存 { left, right, bottom } 完整状态
- `focusMode` 标记避免重复进入
- 退出时 `savedLayout` 清空，恢复初始 null

**约束逻辑**:
- 按原比例分配可用宽度
- 某一侧低于最小值时优先保证该侧最小值，从另一侧减去差额
- 最终结果再 clamp 到各自的 min/max 范围

**会话状态设计**:
- `sessions: Record<layerId, LayerSession>`
- LayerSession 包含 attributeTable 和 inspector 子状态
- `clearLayerSession(layerId)` 供图层删除时调用

### 下一个任务

**P02 — 紧凑菜单与固定工具栏**

前置条件: P01（已完成）

主要工作:
- 菜单采用 "项目 / 数据 / 图层 / 编辑 / 视图 / 帮助"
- 固定工具栏保留常用入口
- 复用现有 commands，不复制业务逻辑
- 快捷键不误触发删除/绘制
- 菜单支持键盘导航与 Esc

涉及文件:
- `apps/desktop/src/app/Header.tsx`
- `apps/desktop/src/app/header/` (新增菜单组件)
- `apps/desktop/src/app/commands/` (按需扩展)
- 样式文件

---

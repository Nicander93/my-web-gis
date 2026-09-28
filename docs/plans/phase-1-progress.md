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

**状态**: 已完成（待 Batch A 正式验收）  
**执行日期**: 2026-09-28  
**前置条件**: P00  
**验收标准**: `docs/plans/batch-a-acceptance.md` § P01 + Scenario F

### 完成内容

按照 batch-a-acceptance.md P01 产品门槛实现：

1. **布局操作不进入 Dirty / Undo / 项目文件**: workspace.store 独立持久化，与 project.store 完全分离
2. **收起→恢复保留操作上下文**: 
   - 面板使用 display:none 保持挂载
   - session.store 按图层ID保存会话状态
   - Inspector 页签已接入
   - AttributeTable 搜索+滚动框架就绪（组件接入待真实数据）
3. **地图点选不强开已收起面板**: 无强制展开逻辑，仅功能入口可展开
4. **专注模式进出恢复布局**: 保存完整布局（开关+尺寸），往返恢复
5. **重置布局恢复新默认**: 右侧面板默认展开（open=true）
6. **窗口 resize 地图可用**: constrainPanelSizes 保留最小 320px 地图区域
7. **焦点恢复有可访问名称**: aria-label + aria-hidden

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

### 验收核对（batch-a-acceptance.md § P01）

| 验收项 | 验收证据 | 结果 |
|--------|---------|------|
| 布局操作不进入 Dirty | workspace.store 独立持久化 + 测试 | ✅ PASS |
| 布局操作不写入 Undo 历史 | 与 project.store 分离 | ✅ PASS |
| 布局操作不写入项目文件 | localStorage 独立存储 | ✅ PASS |
| 属性表搜索+滚动位置保持 | session.store 框架就绪，组件接入待数据 | ⚠️ 框架完成 |
| 右侧页签与未应用草稿保持 | Inspector 已接入，草稿待 P08-P10 | ⚠️ 页签完成 |
| 不因收起自动应用草稿 | 无自动应用逻辑 | ✅ PASS |
| 普通点选不强开面板 | 无强开逻辑，仅功能入口展开 | ✅ PASS |
| 功能入口能展开面板 | openAttributeTable 命令 | ✅ PASS |
| 专注模式进出恢复布局 | enterFocusMode + exitFocusMode + 测试 | ✅ PASS |
| 重置布局恢复新默认 | resetLayout + 测试（右侧展开） | ✅ PASS |
| 窗口 resize 地图可用 | constrainPanelSizes + 测试 | ✅ PASS |
| 焦点恢复有可访问名称 | aria-label + aria-hidden | ✅ PASS |
| 1366×768 无永久遮挡 | 需要手动 UI 验证 | ⚠️ 未验证 |
| 1920×1080 无永久遮挡 | 需要手动 UI 验证 | ⚠️ 未验证 |

**说明**:
- ✅ PASS: 已实现且有测试/代码证据，commit `7313591`
- ⚠️ 框架完成: 技术框架已就绪，业务接入待后续任务（有真实数据时）
- ⚠️ 未验证: 需要真实环境手动验证，代码层面已实现约束逻辑

### 未验证项（需要真实环境）

1. **手动 UI 验证**: 1366×768 和 1920×1080 分辨率的实际表现（约束逻辑已实现）
2. **Scenario F 完整路径**: 需要真实属性表数据（P03-P07）和样式编辑功能（P08-P10）
3. **AttributeTable 会话保持**: 框架就绪，组件接入需要真实数据
4. **样式草稿保持**: 需要 P08-P10 实现样式编辑功能

### 已知限制与待补项

1. **session.store layerId**: 当前 Inspector 使用 mock `layer-mock-001`，需接入真实图层管理
2. **AttributeTable 会话**: session.store 框架已定义 searchQuery/currentPage/scrollTop，组件接入需要真实数据（P03-P07）
3. **样式草稿保持**: session.store 未定义草稿字段，需在 P08-P10 实现样式编辑时补充
4. **专注模式菜单入口**: 快捷键已实现（Ctrl+Shift+F），菜单显示留待 P02
5. **极小窗口**: 面板约束以 320px 地图区域为底线，窗口 <760px 时体验可能受限（产品未定义极小窗口策略）

### 技术细节

**专注模式实现**:
- `savedLayout` 保存 `{ left, right, bottom }` 完整状态（open + width/height）
- `focusMode` 标记避免重复进入
- 退出时精确恢复，`savedLayout` 清空

**约束逻辑** (constrainPanelSizes):
- 最小地图宽度: 320px
- 按原比例分配可用宽度给左右面板
- 某一侧低于最小值时优先保证该侧最小值，从另一侧减去差额
- 最终结果 clamp 到各自 min/max（左 220-380px，右 260-420px）
- 底部面板最大 50vh

**会话状态设计**:
- `sessions: Record<layerId, LayerSession>`
- `LayerSession = { attributeTable?, inspector? }`
- `attributeTable = { searchQuery, currentPage, scrollTop }`
- `inspector = { activeTab: 'layer' | 'feature' }`
- `clearLayerSession(layerId)` 供图层删除时清理

**面板挂载策略**:
- 使用 `display: none` 而非条件渲染（if/else）
- 业务组件始终挂载，局部状态（如 React useState）自动保持
- `aria-hidden={!open}` 确保隐藏时移出可访问性树

### Scenario F 准备状态（batch-a-acceptance.md）

**场景**: 面板折叠恢复 (Panel Collapse Restore)

| 步骤 | 需求 | 当前状态 |
|-----|------|---------|
| 1 | 打开包含属性表数据的项目 | ⚠️ 需要 P03-P07 数据导入 |
| 2 | 属性表中执行搜索并滚动 | ⚠️ session.store 框架就绪，组件接入待数据 |
| 3 | 右侧修改样式（草稿，未应用） | ⚠️ 需要 P08-P10 样式编辑功能 |
| 4-5 | 收起→展开面板 | ✅ 面板保持挂载机制已实现 |
| 6 | 验证：搜索、滚动、草稿保持 | ⚠️ 需要步骤1-3的真实数据和功能 |

**阻塞项**: 
- 真实属性表数据（P03-P07）
- 样式编辑草稿功能（P08-P10）

**技术就绪**:
- ✅ 面板 display:none 挂载策略
- ✅ session.store 按图层保存框架
- ✅ Inspector 页签已接入 session.store
- ⚠️ AttributeTable 组件接入待真实数据
- ⚠️ 样式草稿字段待 P08-P10 定义

### 下一个任务

**P02 — 紧凑菜单与固定工具栏** (Scenario L)

前置条件: P01（已完成）

主要工作:
- 菜单采用 "项目 / 数据 / 图层 / 编辑 / 视图 / 帮助"
- 固定工具栏保留常用入口
- 复用现有 commands，不复制业务逻辑
- 快捷键不误触发删除/绘制
- 菜单支持键盘导航与 Esc
- 重置布局和专注模式在视图菜单中有入口

涉及文件:
- `apps/desktop/src/app/Header.tsx`
- `apps/desktop/src/app/header/` (新增菜单组件)
- `apps/desktop/src/app/commands/` (按需扩展)
- 样式文件

---

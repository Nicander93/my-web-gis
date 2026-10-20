# Agent 主任务｜Desktop WebGIS 三类核心组件视觉质量整改

## 背景与约束

代码仓库：`https://github.com/Nicander93/my-web-gis`；目标基线：`codex/desktop-productization-v1`（编写本任务时 HEAD 为 `ee23d0208501cc0a2c2da1129839a2290da106de`，执行时先检查最新 HEAD 和工作区状态，不直接回退新提交）。**不要以旧 main 分支作为实施基线。**

先阅读：

1. `docs/01-core-ui-visual-spec.md`（本包）。
2. `reference/desktop-webgis-2d-final.html`、`reference/desktop-webgis-3d-final.html`（本包，唯一视觉基准）。
3. 仓库内 `docs/design/desktop-productization/implementation-addendum.md` 及已实现的业务与行为验收文档。

用户强调：目前实现的按钮、属性表和属性窗口视觉劣于原型；此任务是**产品视觉与交互精修**，不是新增 GIS 功能，也不是再造另一套原型。

## 实施顺序

### S0｜基线

- 在目标开发分支最新提交上创建独立 `ui/visual-alignment-core` 工作分支；保留未提交改动，不覆盖他人工作。
- 运行当前生产构建、测试及最相关的桌面 E2E，记录 HEAD、已有失败、可运行的测试环境。
- 用真实样本做三组整改前截图：Ribbon、二维属性表、三维完整属性窗。保持 `1440×900`；不能用仓库旧 evidence 充当新截图。
- 将本包 HTML 放在设计参考目录，**不要把原型的假数据/模拟地图移植到生产 UI**。

### S1｜统一视觉主题

- 统一语义 Design Token 与 Ant Design `ConfigProvider` 映射；删除相互覆盖的重复颜色和高度定义。
- 不再将 `--desktop-control-height:24px` 作为普通按钮/输入全局标准；建立适当的工具/表单/紧凑图标按钮层级。
- 建立少量可复用视觉 Primitive：Button semantics、RibbonToolButton、PropertyField / PropertyGroup、Table skin；避免造出第二套基础 UI 库。
- Build + 静态检索，证明同名根 Token 已收敛，暗色主题未因浅色调整不可用。

### S2｜Ribbon / Button

- 保留二维、三维各自的命令表，调整分组、行高、大小、状态、空间节奏，并统一 Ant Design 主题。
- 特别整改三维 Ribbon 通过 `active.commands.map` 平铺导致的按钮墙；必要时引入分组展示，但不重新实现命令总线。
- 保证焦点、键盘、互斥模式、Esc、`disabled(reason)`、Busy、撤销与保存行为。
- 提交 S2 对照图和最小范围 commit。

### S3｜二维属性表

- 视觉和结构按照“顶栏/工具栏/表格/状态栏”四区处理；维持 AntD Table 与已有多 Tab、会话态、列宽、筛选、字段管理、编辑、撤销。
- 对照原型的 `32px` 表头/`30px` 记录行和工具区尺寸；校验实际浏览器几何而不是 CSS 常量。
- 使用真实 >=30 记录和 >=8 列样本，包含只读/编辑、选中、过滤、表格横纵滚动、底部停靠和浮动两种状态。
- 提交 S3 对照图和最小范围 commit。

### S4｜三维完整属性窗口

- 保留对象 ID 固定绑定、草稿、预览、Apply/OK/Cancel、Undo/Redo 和专业字段。
- 按字段类型实现合适的组合：普通字段、三轴变换、效果列表、数值+单位；不全用同一行模板。
- 调整顶栏、搜索、左侧分类、右侧表单、底栏的空间关系，保证 `1366×768` 不丢按钮。
- 选真实 Tileset + 独立 POI 分别验收，包含错误、锁定、预览取消与项目保存重开。
- 提交 S4 对照图和最小范围 commit。

### S5｜综合审查 / 暂停点

- 运行生产构建、项目相关单测、Playwright E2E；至少检查 `1366×768`、`1440×900`、`1920×1080`。有 Windows 原生环境时，额外检查 Tauri/WebView2 和 125% 系统缩放；没有则报告“未验证”，不冒称通过。
- 出具 `before/after` 对照，逐项标注偏差、处理和遗留；记录真实测试命令及结果。
- 审查 DOM 可点击区域、弹层 z-index、Focus/IME、Esc、数据编辑撤销与脏状态。绝不为获得“全绿”移除测试或替换真实数据断言。
- **只完成 S0–S5，不自动向其他组件扩散**；等待用户确认本轮三类核心组件的视觉质量后再进入全局推广。

## 交付要求

- 一个独立 PR：说明改了什么、为什么、对应视觉规范条款、功能回归、残留差异。
- S0 的基线截图和 S2/S3/S4 的新版截图；同尺寸、同样本、同状态对照。
- Design Token、AntD theme 与功能 CSS 的归属清单；删除的重复规则明细。
- 测试与审计记录。任何没有实测的视觉或原生结论必须清楚标记“待验证”。

## 禁止事项

- 不改 OpenLayers/Cesium 引擎、项目文件协议或已有 GIS 算法。
- 不重新开始业务开发、不要以“视觉优化”为名重写完整工作台。
- 不直接修改 `main`，不直接合并未经确认的 PR。
- 不通过“继续缩小全部控件”“盲目附加 CSS override”“删功能/弱化测试”来伪造完成。

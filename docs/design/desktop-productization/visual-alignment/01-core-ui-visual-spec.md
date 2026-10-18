# Desktop WebGIS｜核心组件视觉与交互校准规范 V1.0

> 日期：2026-10-17  
> 状态：供 Agent 执行的视觉专项任务；不是已完成实现。  
> 适用仓库：`Nicander93/my-web-gis`；审查基线：`codex/desktop-productization-v1`，`ee23d0208501cc0a2c2da1129839a2290da106de`。  
> **唯一视觉基准**：`reference/desktop-webgis-2d-final.html` 和 `reference/desktop-webgis-3d-final.html`（本包内），旧静态截图仅辅助定位。  
> 保留既定产品边界：二维/三维是独立项目；共享 Shell，不强行共用 GIS Runtime；不重写 OpenLayers/Cesium 内核。

## 0. 为什么需要本轮专项

当前分支已实质实现多种 GIS 业务、Ant Design 主题、属性表及三维属性窗口；但“设计一致性”被“统一缩小控件”替代，导致控件比例、留白、层次弱于既定原型。现状可从 `workbench.css` 尾部的 `--desktop-control-height: 24px`、`--desktop-row-height: 28px`、重复 Token 和分散样式看出。**本轮只修三类代表组件的视觉/交互质量，不扩大 GIS 功能范围。**

验证需区分两种证据：仓库保留的截图/E2E 记录属于既有版本的历史证据；本轮必须运行指定提交并重新生成当前截图，不能用旧截图冒充新验收。

## 1. 参考原型里已经存在的尺寸（提取自 HTML 内 CSS）

| 元素 | 二维原型实际值 | 三维原型实际值 | 首批实现目标 |
|---|---|---|---|
| 顶部应用栏 | `39px` | `40px` | `40px`，不另加第四行导航 |
| Ribbon Tab 行 | `31px` | `31px` | `31px` |
| Ribbon 工具行 | `43px` | 原型总高 72px，Tab 31px，余下约 41px | `42–44px` |
| Ribbon 工具按钮 | `33px` | `34px` | `34px`，图标与文字间隔 `7px` |
| 普通属性输入 | 原型随组件配置 | `29px` | `29–30px`，不使用全局 `24px` 直接压缩 |
| 完整属性窗 | `790×570px`（随视口约束） | `670×514px` | 按对象类型取合理初值，必须可移动、调整尺寸 |
| 属性分类导航宽 | `166px` | `128px` | 随窗口宽度约 `128–166px`，不得挤占输入区 |
| 属性表顶栏 | `36px` | `36px` | `36px` |
| 属性表工具栏 | `39px` | `40px` | `39–40px` |
| 属性表列头 | 原型通过 padding 定义 | `32px` | `32px` |
| 属性表记录行 | 原型通过 padding 定义 | `30px` | `30px` |
| 属性表底栏 | `27px` | `29px` | `28–29px` |

**注意**：这些是原型已定义的参考尺寸，不意味着必须逐像素复刻。应当保证视觉比例与工作流；当 1366×768、125% 缩放产生溢出时应合理响应式处理，而不是把所有控件一起缩小。`24px` 可以保留给少量嵌入式图标按钮或表格单元格输入，但不能作为全局普通控件高度。

## 2. 统一 Design System 与 Ant Design 接入原则

### 2.1 源头与令牌

当前仓库出现 `tokens.css` 与 `workbench.css` 同时写 `--color-accent` 的情况（分别曾是 `#38745a`、`#2f695b`）；Ant Design `DesktopUiProvider.tsx` 还有另外一份字面量。**必须只保留单一权威来源**，其他位置只引用语义 Token；不再用业务 CSS 反复覆盖根变量。

| 语义 | 建议统一值 | 来源及使用 |
|---|---|---|
| `bg.app` | `#f7f9f6` | 二维原型整体背景 |
| `bg.chrome` | `#fafbf9` | 三维原型桌面框架 |
| `bg.surface` | `#ffffff` | 表格、属性窗、输入区 |
| `text.primary` | `#26352d` | 二维原型文字 |
| `text.secondary` | `#77877c` | 二维原型辅助文字 |
| `border.default` | `#dfe6e0` | 二维原型中性边框 |
| `border.subtle` | `#ebefeb` | 二维原型内部隔线 |
| `brand.primary` | `#2f695b` | 三维原型，**两份原型的强调绿近似但不同；此项为统一选型，不是逐字提取** |
| `state.hover` | `#eff4ef` | 二维原型 |
| `state.selected` | `#e3efe5` | 二维原型 |

实现选项：创建共享 `ui-tokens.ts` 并将同一映射传给 Ant Design `ConfigProvider` 和应用 CSS 变量，或保留 `tokens.css` 作为唯一 CSS 源并建立映射检查；二选一即可。禁止在 `app.css` / `workbench.css` / 各 feature CSS 内重新定义同名根 Token。Dark mode 保留现有能力，但首轮以浅色原型为视觉签收范围；避免影响既有暗色模式行为。

Ant Design 是组件**交互基座**，不是成品视觉规范：按 `ConfigProvider` 统一 Button、Input、InputNumber、Select、Tabs、Table、Modal、Menu、Switch、Checkbox；GIS 专属图形控件可自研。只在组件级补充必要 CSS；禁止将 `!important`/复杂选择器叠加作为默认修复路径。统一中文、焦点、禁用、Loading、悬停、错误反馈。不要引入第二套通用 UI 组件库。

### 2.2 视觉密度规则

- 主体字体 `12px`，字段说明、弱提示 `11px`，技术单位可使用等宽数字；标题的字号、字重和留白要明显区别于字段内容。
- 基础图标 `16px`、次级 `14px`；图标与文字 `6–8px`，不要堆成细碎密集的“按钮墙”。
- 主操作绿色实心，次操作浅色描边，工具操作以轻背景或透明按钮承载；红色仅用于破坏性操作。
- 常规控件高 `29–30px`，工具栏按钮高 `33–34px`；属性表单元格编辑可在 `25–27px` 内。
- 内层控件圆角 `3–4px`；浮动窗口/Modal 圆角 `7px`。普通表格和每行属性不要加卡片阴影，阴影只表达真实浮层层级。
- 交互态必须区分 `hover`/`selected`/`pressed`/`disabled`/`busy`/`focus-visible`；禁用不仅变浅，还必须有原因可查询。

## 3. 组件 A：Ribbon 与通用按钮

### 3.1 信息架构（保持现有 Tab 名称）

二维 Tab：`地图 / 编辑 / 数据 / 分析`；三维 Tab：`场景 / 标绘 / 编辑 / 瓦片 / 分析`。**工具之间应有可理解的分组边界**；每个 Tab 内的常用命令可见，低频命令收纳“更多”。

- 图标/文本水平居中，图标不得抢走文字重心。
- 工具按钮正常态尽量无边框；悬停才出现浅绿底；激活时淡绿底+清晰边界；禁用时保留占位，但显示禁用原因。
- 删除、应用、取消、保存等“动作按钮”不要和模式切换工具共用视觉状态。
- 不强制把“添加数据”重复插在三维每个 Tab 的首位；建议放在场景 Tab 的主区域，以及顶级菜单/快捷入口。不得删除已有数据导入能力。
- Ribbon 不能因为文字过长无限横向铺开；使用明确的分组、溢出收纳与可聚焦的更多菜单。保留键盘访问与 `aria-pressed`、Esc 退出当前模式。
- **只做视觉/命令呈现调整**，保持 `execute`/`disabled(reason)`、编辑会话和撤销协议不变。

**代码入口（现有分支）**：

- `apps/desktop/src/app/header/Toolbar.tsx`（二维）
- `apps/desktop/src/app/header/WorkbenchRibbon.tsx`（三维共用 Ribbon 容器）
- `apps/desktop/src/features/scene3d/SceneRibbon.tsx`
- `apps/desktop/src/app/header/ToolbarButton.tsx`
- `apps/desktop/src/components/ui/Button.tsx`
- `apps/desktop/src/components/ui/DesktopUiProvider.tsx`

**需要整改的具体实现**：二维 `Toolbar` 已有 `Group`，三维 `WorkbenchRibbon` 仍是 `active.commands.map` 平铺。允许抽象一个共享 `RibbonGroup` / `RibbonToolButton` 视觉层；不要求合并两套业务命令表。验证禁用原因、按钮焦点、活动模式显示，并解决原生按钮和 AntD Button 混用导致的高度不一。

## 4. 组件 B：二维属性表

原型不是传统“后台 Table”，而是**一个用于大量 GIS 记录的专业数据工作区**。优先确保视线落在数据区域，而非工具栏。

**固定布局分区（从上到下）**：

1. `36px` 顶栏：窗口标题 + 多图层 Tab + 窗口操作（Dock/浮动/最大化/关闭）；项目没有多个表时也保持对齐。
2. `39–40px` 单行工具栏：搜索、只看选中、选择操作、过滤、字段/计算等；低频项折叠为 Popover/Dropdown，不再出现多层“临时设置条”常驻。
3. 可伸缩数据区：`32px` 粘性表头，`30px` 数据行；表格行、悬停、选中、编辑焦点的颜色与文字清晰分层。
4. `28–29px` 状态栏：记录总数、过滤数量、已选数量、只读/编辑状态和分页/加载提示。

**细节**：

- 列宽支持拖动并持久化到**会话**（非项目）；保持现有列显示/顺序、滚动、排序、筛选和 Tab 恢复。
- 数字右对齐或等宽，长文本可省略并能查看全值。表头与列操作区域不互相覆盖。
- 行选择仅高亮地图；双击指定定位入口才导航；单元格编辑触发与地图键盘快捷键严格隔离。
- 属性表底部停靠必须铺满**整个 Workspace 宽度**，不能因为左右面板减少地图的 Canvas 尺寸。
- 若 AntD Table 的样式对齐成本高，允许保持 AntD Table 行为内核，通过明确定义 `.gis-attribute-table` 级表头/行/边框语义样式实现。**不允许将表格回退为自写简易 `<table>` 丢失交互**。

**代码入口**：

- `apps/desktop/src/features/attribute-table/AttributeTable.tsx`
- `apps/desktop/src/features/attribute-table/AttributeTableHost.tsx`
- `apps/desktop/src/features/attribute-table/ColumnResizeHandle.tsx`
- `apps/desktop/src/styles/antd-workbench.css`
- `apps/desktop/src/app/BottomPanel.tsx`

**典型现状缺口**：当前 `antd-workbench.css` 强制设置 `.ant-table-cell {height:28px; padding:4px 8px}`，原型三维属性表是 `32px` 表头 / `30px` 行高；旧实现部分高度叠加后偏碎。验收必须测**实际渲染高度**，不能只看 CSS 声明。

## 5. 组件 C：三维完整属性窗口（同时对齐二维属性窗的共享视觉）

**窗口层**：默认非模态、与对象稳定 ID 绑定、可移动、可改变尺寸。通常约 `670×514px`，依据内容可调至二维原型约 `790×570px`；小屏需保证标题/底部操作仍可触达。对话框、窗口和背景地图的层级必须明确。

**窗口信息结构**：

- 顶栏：对象名称、类型/资源摘要与关闭操作。不要让“未应用”等调试标签抢占标题主体。
- 顶栏下可搜索参数名和 Cesium API alias；搜索结果同时指示所属分类。
- 中部：左侧分类导航（参考 `128–166px`），右侧专业参数区；复杂对象可按字段组使用两列栅格。
- 底栏：`取消 / 应用 / 确定` 清楚分级，固定于窗口底部，内容区单独滚动；错误展示靠近字段并保留全局摘要。

**不同字段使用不同布局，不套同一行组件**：

| 字段类型 | 建议组件结构 |
|---|---|
| 普通文本/枚举 | 标签 + 输入，固定最小标签宽 + 弹性表单宽 |
| 数值 + 单位 | InputNumber + 单位尾随元素，精度与范围明确 |
| Transform 三轴 | X/Y/Z 紧凑三列，不按“键值对”逐行堆放 |
| 3D Tiles 裁剪/压平 | 效果列表 + 启用/编辑/删除 + 当前区域参数表单，避免将坐标 JSON 塞成主视觉 |
| POI 图标与文字 | 图标预览/选择 + 显示大小 + 可见距离等分组 |
| 批量对象 | 仅呈现共同可编辑字段，不暗改其他对象 |
| 危险操作 | 低权重的危险区，明确二次确认 |

**业务合同绝对不可破坏**：`Apply` 提交且窗口保留；`OK` 提交并关闭；`Cancel` 回滚**未应用**的草稿；预览不写历史且可恢复；窗口绑定已打开的对象，不因树选择变化偷换。锁定与项目版本冲突需阻止旧草稿覆盖新项目。属性窗不等于跟随选择的右侧检查器：检查器只做高频快速操作。

**代码入口**：

- `apps/desktop/src/components/ui/PropertyWindow.tsx`
- `apps/desktop/src/features/scene3d/ScenePropertyWindow.tsx`
- `apps/desktop/src/features/scene3d/TilesetEffectsDraft.tsx`
- `apps/desktop/src/features/inspector/LayerPropertyWindow.tsx`
- `apps/desktop/src/components/ui/property-window.css`

**当前改善空间**：三维窗虽然已用 AntD `InputNumber / Select / Switch / Menu`，但大部分字段是 `field(label, alias, control)` 模板。优先抽 `PropertyField`、`PropertyGroup`、`PropertyVector3`、`PropertyEffectList` **纯展示组件**，继续使用原有草稿验证/事务提交代码，别把业务逻辑混入视觉组件。

## 6. 本轮明确不改的范围

- 不增加 GIS 新功能；不修改坐标转换、渲染算法、数据持久化协议和 Cesium shader/Gizmo 实现。
- 不重写现有 AttributeTable 的数据操作和跨组件会话 Store。
- 不因视觉统一改变二维/三维项目独立的边界。
- 不动已有已经完成的原生资源授权、保存恢复等工作流。
- Docking 的**自由窗口身份重构**另列后续阶段；首轮只修与三组件直接相关的窗口标题/布局/层级视觉，不能把“三固定窗口”体系无边界推翻。

## 7. 必须按同一场景做视觉校准

| 视图 | 原型对照点 | 真实应用必须操作出的状态 |
|---|---|---|
| 2D A | `desktop-webgis-2d-final.html` 的 Ribbon 和图层树 | 含点/线/面和选中图层；地图、编辑、数据 Tab 各一张 |
| 2D B | 同原型属性表 | 有 >= 8 列、>= 30 条真实 GIS 要素数据；表停靠 / 浮动各一张，至少一个单元格编辑态 |
| 3D C | `desktop-webgis-3d-final.html` 的完整属性窗 | 模型/POI 属性窗，包含分类、搜索、输入、Apply/Cancel 状态 |
| 3D D | 同原型裁剪/压平属性 | 含真实 3D Tiles、至少一个效果，显示列表与参数而不是纯 JSON 区 |

建议屏幕 `1440×900`（原型预览截图尺寸），补测 `1366×768` 和 `1920×1080`；使用相同数据、相同工具态和相同 Docking 状态拍“前/后”，避免把地图内容差异误当作 UI 视觉差异。重点对照“应用 Chrome、按钮、表格、窗体和文本层次”；不要要求真实 OpenLayers/Cesium 地图像素匹配原型内的模拟地图。

**视觉验收 Gate：**

- [ ] 三行主框架准确；Ribbon 工具高约 34px；按钮主次、悬停、按下、禁用、焦点可区分。
- [ ] 2D/3D 基础按钮同组件同样式；不再出现 24px 被全局压缩的常规按钮。
- [ ] 属性表顶栏/工具栏/表头/数据行/底栏比例合理；实际数据区未被多层控件挤压。
- [ ] 完整属性窗口分类/表单/操作栏独立，数值、Transform、效果集合有适配布局。
- [ ] CSS 同名主题 Token 不在业务文件重新定义；迁移后的旧覆盖已删除或解释用途。
- [ ] 所有数据编辑、选择、撤销、保存、导入、Esc/IME、Tab 焦点回归测试仍通过。
- [ ] 原型/实物对照截图及问题清单完整；没有借空白工程来证明视觉品质。

## 8. 阶段停止条件

仅当组件 A/B/C 的截图与交互 Gate 都完成，才推广到图层树、检查器、数据导入、日志/诊断、Docking 全局视觉。发现功能退化立即停止扩大迁移范围、回到上一个已验收的稳定提交；不得删测试或弱化断言使其“通过”。

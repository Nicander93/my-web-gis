# Desktop 设计系统 V1

本轮建立在已有 React / Ant Design / CSS 语义色板上。原型提供布局和工作流参考，产品继续使用灰白、低饱和绿色以及 Segoe UI / 微软雅黑。实施范围和证据见 [执行记录](../plans/2d-ux-productization-implementation.md)。

## 代码构成

| 层 | 代码入口 | 职责 |
| --- | --- | --- |
| Token | `apps/desktop/src/styles/tokens.css` | 语义颜色、字号、控件/行/Tab 高度、间距和窗口层级。主题与密度的值只在这里定义。 |
| 组件库主题 | `components/ui/DesktopUiProvider.tsx` | 将 Token 传给 Ant Design，响应本机偏好和系统主题变化。 |
| 通用交互组件 | `components/ui/Button.tsx`、`ModelessWindow.tsx`、既有 `EditorDialog.tsx` | 按钮变体、焦点、非模态窗移动/缩放/关闭和模态焦点边界。基础组件不引用 GIS Store 或 OpenLayers。 |
| 工作区组合 | `app/Workspace.tsx`、`BottomPanel.tsx`、`docking/` | 组合功能面板、独立窗口和布局；底部用于属性表，右侧工作面板互斥。 |
| Feature | `features/attribute-table/`、`inspector/`、`layers/`、`settings/` | 业务状态、字段校验和命令编排。样式编辑复用既有标准 AST 与撤销操作。 |

`desktop-ux.css` 负责现有界面的迁移适配；Feature 专用布局留在 Feature CSS，统一消费 Token。旧完整属性窗的草稿/应用语义保留，后续迁移共用窗体时需要单独验证关闭保护。

## 密度与层级

| Token | 紧凑（默认） | 标准 |
| --- | --- | --- |
| `--font-size-ui` | 默认 12px，可设 11–14px | 与字号设置共用 |
| `--control-height` | 28px | 30px |
| `--control-icon-height` | 26px | 28px |
| `--desktop-row-height` | 28px | 30px |
| `--tab-height` | 30px | 32px |
| `--menu-height` | 34px | 36px |
| `--status-height` | 24px | 26px |
| `--space-group` / `--space-field` | 8px / 6px | 10px / 8px |

控件悬停与按下保持相同几何尺寸；选中/焦点使用背景、颜色和 inset 线表达，不改变字体、边框宽度或布局。图标操作保留可点击区域、名称和 Tooltip。密度由真实控件尺寸控制。

界面按任务分层：工作面板入口 → 面板标签 → 分组字段 → 参数。面板标题不在内容里重复。低频导出与发布放入图层上下文菜单及样式菜单；软件设置直接打开独立设置窗口，原业务命令保留于“操作”菜单。

独立非模态窗通过 React Portal 挂载在 `document.body`，保留 React/Ant Design 上下文，避免受到停靠面板的层叠或裁剪影响；移动/缩放边界预留底部状态栏。停靠属性表按实际打开的左右停靠面板预留空间，最大化/浮动窗口避开最右侧工具栏；地图画布保持原有尺寸，窗口布局不重建地图实例。

## 状态边界

| 状态 | 归属 | 是否进入工程/撤销 |
| --- | --- | --- |
| 数据、图层样式、地图过滤、字段结构 | Project + 既有编辑 Command | 是 |
| 窗口开关/尺寸与停靠 | Workspace / Docking | 否 |
| 属性表逐层搜索、表格筛选、列显示、宽度、排序、滚动 | Session | 否 |
| 属性表目标、属性面板目标、编辑目标、右侧工作面板 | Workbench | 否，目标互相独立 |
| 最近一次识别结果 | Information，绑定 project epoch | 否，不修改选择集 |
| 软件主题、界面字号、控件密度 | Preferences，本机独立存储 | 否 |
| 任务执行与取消句柄 | 既有 Task Log / Service | 关闭任务窗口不取消任务 |

地图“识别”由顶部工具激活；右侧“信息”只展示已有结果。属性表搜索/筛选只影响该 Tab；地图级过滤从独立图层过滤窗口修改。两者在字段计算器里有明确的范围选项。

## 编辑安全

- 单元格校验失败保留草稿、错误和原值，用户可修正或放弃。
- 字段计算预览与执行使用同一白名单表达式引擎；整批预检后通过一条数据编辑命令提交。任一错误不提交部分结果。
- 标准样式侧栏按参数编辑。未知表达式保留，表达式参数转到专业编辑器，其他可安全表示的参数仍可编辑。写入时复查工程 epoch、图层和锁定状态，沿用原手势撤销事务。
- 字段删除检查样式 AST、标注、地图过滤与弹窗引用；重命名沿用已有原子映射及撤销。
- 设置字体仅影响 UI，不改地图符号、地图文字或已保存样式。

## 本轮验收边界

行为测试检查真实数据、选择、历史、持久化和窗口独立性；两档浏览器截图用于密度、层级和可达性评审。Windows/Tauri 原生窗口、系统凭据、真实 GeoServer 和物理 GPU 各自需要对应环境证据。截图及自动化通过不代替用户对专业编辑体验的视觉签收。

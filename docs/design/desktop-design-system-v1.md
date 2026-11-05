# Desktop 设计系统 V1

本轮建立在已有的 React / Ant Design / CSS 语义色板上。原型提供布局和工作流的参考，产品继续使用灰白、低饱和绿色，以及 Segoe UI 和微软雅黑。工作台原型见 [prototypes/workbench](../prototypes/workbench/desktop-webgis-2d-final.html)。

## 代码构成

| 层 | 代码入口 | 职责 |
| --- | --- | --- |
| Token | `apps/desktop/src/ui/components/styles/tokens.css` | 语义颜色、字号、控件与行与 Tab 的高度、间距和窗口层级的默认值；运行时尺寸由 `DesktopUiProvider` 按本机偏好计算。 |
| 组件库主题 | `apps/desktop/src/ui/components/DesktopUiProvider.tsx` | 把 Token 传给 Ant Design，并响应本机偏好和系统主题的变化。 |
| 通用交互组件 | `ui/components/Button.tsx`、`ModelessWindow.tsx`、原有的 `EditorDialog.tsx` | 按钮变体、焦点管理、非模态窗的移动与缩放与关闭，以及模态窗的焦点边界。基础组件不引用 GIS Store 或 OpenLayers。 |
| 工作区组合 | `ui/workbench/Workspace2D.tsx`、`BottomPanel.tsx`、`LeftPanel.tsx`、`RightPanel.tsx` | 组合功能面板、独立窗口和布局；底部用于属性表，右侧的工作面板互斥。 |
| Feature | `ui/panels/attribute-table/`、`inspector/`、`layers/`、`settings/` | 业务状态、字段校验和命令编排。样式编辑复用已有的标准 AST 和撤销操作。 |

`desktop-ux.css` 负责现有界面的迁移适配；Feature 专用的布局留在各自的 Feature CSS 里，统一消费 Token。旧完整属性窗的草稿与应用语义保留；后续迁到共用窗体时，需要单独验证关闭保护。

## 密度与层级

| Token | 紧凑（默认） | 标准 |
| --- | --- | --- |
| `--font-size-ui` | 默认 12px，可设 8–14px | 与字号设置共用 |
| `--control-height` | 26px | 28px |
| `--control-icon-height` | 24px | 26px |
| `--desktop-row-height` | 26px | 28px |
| `--tab-height` | 28px | 30px |
| `--menu-height` | 32px | 34px |
| `--status-height` | 22px | 24px |
| `--space-group` / `--space-field` | 8px / 6px | 10px / 8px |

控件在悬停和按下时保持相同的几何尺寸；选中和焦点用背景、颜色和 inset 线来表达，不改变字体、边框宽度或布局。图标操作要保留可点击区域、名称和 Tooltip。密度由真实的控件尺寸控制。

上面的尺寸以 12px 为 100% 基准。字号滑块显示 8–14px 及对应的比例；控件、图标、间距和窗口随比例调整，地图画布和数据符号仍然按各自的规则渲染。已保存的自定义停靠尺寸按比例显示，拖动后仍以基准尺寸保存。

界面按任务分层：工作面板入口 → 面板标签 → 分组字段 → 参数。面板标题不在内容区里重复。低频的导出和发布放进图层的上下文菜单和样式菜单；软件设置直接打开独立的设置窗口，原有的业务命令保留在“操作”菜单里。

独立的非模态窗通过 React Portal 挂载在 `document.body` 上，保留 React 和 Ant Design 的上下文，避免受到停靠面板层叠或裁剪的影响；移动和缩放的边界为底部状态栏留出空间。二维属性表停在底部时，会横跨侧栏下方的区域，左右面板在表格上缘结束；最大化和浮动的窗口避开最右侧的工具栏。地图画布保持原有尺寸，窗口布局变化不会重建地图实例。

## 状态边界

| 状态 | 归属 | 是否进入项目和撤销历史 |
| --- | --- | --- |
| 数据、图层样式、地图过滤、字段结构 | Project 和已有的编辑 Command | 是 |
| 窗口开关、尺寸与停靠 | Workspace / Docking | 否 |
| 属性表逐层搜索、表格筛选、列显示、宽度、排序、滚动 | Session | 否 |
| 属性表目标、属性面板目标、编辑目标、右侧工作面板 | Workbench | 否，各目标互相独立 |
| 最近一次识别的结果 | Information，绑定 project epoch | 否，不修改选中集 |
| 软件主题、界面字号、控件密度 | Preferences，本机独立存储 | 否 |
| 任务执行与取消句柄 | 已有的 Task Log / Service | 关闭任务窗口不会取消任务 |

地图的“识别”由顶部工具激活；右侧的“信息”只展示已有结果。属性表的搜索和筛选只影响当前 Tab；地图级的过滤从独立的图层过滤窗口修改。两者在字段计算器里都有明确的范围选项。

## 编辑安全

- 单元格校验失败时保留草稿、错误和原值，用户可以修正或放弃。
- 字段计算的预览和执行使用同一个白名单表达式引擎；整批预检之后，通过一条数据编辑命令提交。任一错误都不会提交部分结果。
- 标准样式侧栏按参数编辑。未知的表达式保留下来，表达式参数转到专业编辑器，其它可以安全表示的参数仍然可编辑。写入时重新检查项目 epoch、图层和锁定状态，沿用原有手势的撤销事务。
- 删除字段时检查样式 AST、标注、地图过滤和弹窗中的引用；重命名沿用已有的原子映射和撤销。
- 设置字体只影响 UI，不改变地图符号、地图文字或已保存的样式。

## 本轮验收边界

行为测试检查真实数据、选择、历史、持久化和窗口的独立性；两档浏览器截图用于评审密度、层级和可达性。Windows/Tauri 的原生窗口、系统凭据、真实的 GeoServer 和物理 GPU 各自需要对应的环境证据。截图和自动化通过，都不代替用户对专业编辑体验的视觉验收。

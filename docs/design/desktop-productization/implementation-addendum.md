# Desktop WebGIS 实施补充细则

本文件记录 2026-10-13 用户追加要求，与 [最终实施资料包](webgis-agent-delivery/README.md) 一起执行。两个 HTML 原型直接作为界面实施基准，不再安排原型评审。资料包中“代码实施尚未开始”是交付时的状态；现在沿 `codex/desktop-productization-v1` 已有提交继续，实际进度以 [实施记录](../../plans/desktop-productization-implementation.md) 和当前 Git 为准。

## 1. 明确采用 Ant Design

- 通用界面组件统一使用 **Ant Design React（`antd`）**，本次锁定 `6.6.6`，与现有 React 19 配合；不是 AntV 图表库。依赖版本与 lockfile 一起提交。
- `DesktopUiProvider` 提供中文语言、small 尺寸、主题 token 和应用级弹层上下文。颜色、字体、间距、密度服从原型，不直接套默认蓝色主题或后台模板。
- Button、Input、InputNumber、Select、AutoComplete、Checkbox、Switch、Radio、Form、Dropdown/Menu、Tabs、Modal、Tooltip、Tree、Table、Upload、Alert/Message 等逐批迁移到 antd。新增通用界面不得手写原生 button/input/select/textarea/dialog/summary 来代替库组件，也不引入第二套通用控件库。
- 业务组件可封装权限、状态和既有调用约定，底层交互由 antd 提供；不能只给原生控件加样式冒充库迁移。Select 使用值回调，不伪造 DOM ChangeEvent。
- HTML 布局、SVG、Canvas/WebGL、GIS 控制柄、地图拾取/拖动属于业务层；antd 内部生成 HTML 控件是正常输出。操作系统文件对话框、凭据系统继续使用真实系统能力。

## 2. 组件迁移顺序

| 批次 | 范围 | 完成证据 |
|---|---|---|
| A | Provider/中文/Token、共享按钮/模态框、属性表 Tab/计算器 | 构建、回归、键盘与弹层交互；真实界面出现 antd 控件 |
| B | Ribbon/菜单/Docking 动作、二维导入/导出/属性表/检查器/处理工具 | 入口可达；校验、草稿、选择/编辑状态保持 |
| C | 三维 Ribbon/树/属性分组/资源窗口/标绘及效果表单 | 独立 Graphic、固定对象目标、专业参数、批量操作与焦点回归 |
| D | 全库控件清理、密度/无障碍/125% 缩放 | 源码剩余项归零或逐项记录 GIS/系统用途；原生验收 |

A 完成不代表全部界面迁移完成。逐批记录剩余文件，不将 antd 引入 GIS core/runtime packages，不改变项目协议、服务请求和撤销模型。

## 统一 UI 规则（2026-10-14 追加）

用户进一步明确：原型为初版视觉方向，产品优先遵循一致的 UI 规则，不要求逐像素照搬。保留已确认布局与功能基准，细节按以下规则迭代：

- 统一绿色强调色、浅色表面、文字层级和边框；共享 token 与 antd 组件主题共同维护，不在各业务窗口另造配色。
- 桌面正文与控件以 12px 为基础，提示 11px；表头使用 600 字重，数值使用等宽数字，超长内容可滚动或省略，不挤压操作入口。
- 常规控件 29–30px，密集工具栏 26px，弹窗操作按钮 31px。表头 32px、记录行约 30px；同一上下文保持相同高度与留白。
- 主操作使用绿色实心，普通操作使用浅边框，工具使用透明背景。悬停、选中、禁用、Busy、错误与键盘聚焦均具有一致且可区分的状态。
- 窗口/弹窗 7px 圆角，内层控件 3–4px；标题、内容与操作区通过细边框分区。阴影只表达浮动层级，不给表格记录或普通工具堆叠阴影。
- 属性表采用同一组件主题，所有分页、排序、选择、编辑、滚动、草稿与撤销行为均按真实数据回归；视觉校准不能用弱化断言换取通过。

## 3. 窗口、弹层与焦点

- 三行 Ribbon、完整地图视口及左右/底部/浮动 Docking 保持既定交互；控件迁移不改成固定侧栏。
- 新建/打开项目、导入配置等事务使用 Modal；完整对象属性仍按固定对象 ID 的非模态窗口实现，不能因使用组件库而改变产品要求。
- 检查 Select、菜单、Tooltip 与 Docking/Modal 的层级和滚动裁切；关闭弹层恢复触发控件焦点。
- IME 组合中的 Enter 不提交；输入、搜索、菜单/弹窗快捷键不落到地图。Esc 按当前弹层、当前输入/手势、地图工具的顺序处理，不一次取消多个层级。
- Busy 阻止遮罩/Esc 意外退出；关闭后不遗留背景禁用或焦点陷阱。焦点恢复和真实操作必须通过交互测试。

## 4. 数据与历史

- 表内字段计算修改原数据，处理工具箱计算输出新数据；提交前验证全部目标行，字段类型/空值/表达式错误或取消不能留下半成品。
- 字段管理考虑同一 Dataset 的全部引用图层，覆盖过滤、分类/分级样式、标注和弹窗字段。删除引用字段明确处理引用，重命名保留 ID、几何和值；一步撤销恢复数据和配置。
- 合并/分割使用真实几何算法，合并提供明确属性冲突策略。多要素操作、文件夹重组、批量样式等用户操作使用原子历史项。
- 表格 Tab、列顺序/宽度/显示、搜索/排序/分页/滚动、Docking 是会话/本机状态；过滤、属性/样式和场景内容是项目状态。浏览树不改变固定目标。
- 锁定、只读服务、隐藏祖先和草稿保护统一检查，组件替换不得绕过能力限制或让历史覆盖未应用草稿。

## 5. 资源、保存与恢复

- 本地模型/Tileset 使用项目相对引用，另存时重算；缺失保留节点及配置，支持父目录重定位与重试，不偷偷内嵌资源。
- 保存写临时文件并原子替换；仅保存版本仍为当前版本时清 dirty。保存期间继续编辑/换项目的竞态有专门测试。
- 恢复草稿按项目隔离，提供恢复/舍弃；恢复文件不伪装正式保存，浏览器下载不代替 Windows 原生验收。

## 6. 三维效果与性能

### 三维场景语义与公开 API（2026-10-14 追加）

- 三维产品及公开 API 面向通用三维场景，覆盖模型、3D Tiles、地形、影像、GeoJSON 和 Graphic；城市只是可选示例，不是场景能力或数据契约的前提。
- 原方案 M3 的 `City*` UI 命名迁移扩展到公开 API。新增及重构后的主接口、类型、示例和文档采用 Scene/CesiumScene 语义；与已有 `SceneDocument` 等名称冲突时明确职责，不机械替换名称。
- 旧 `City*` 导出作为兼容入口保留并标记弃用，内部复用同一实现；新文档和调用入口优先使用通用名称。名称迁移独立提交，审计包导出、Desktop 调用、示例和测试，避免一次无边界改名。
- 旧 CityScene v1/v2 与既有项目字段继续读取，保持对象 ID、引用和保存重开等价；API 改名不直接改写持久化协议。新协议的变更另设版本与迁移器。
- 2026-10-14 已完成主 API 与 Desktop/Viewer 主流程迁移：公开能力采用 `CesiumScene*`、`Scene*`、`SceneWorkspace` 和 `scene3d` 路径；旧 `City*` 符号只从独立 `compat-city` 模块以 `@deprecated` 别名导出。旧 `project.city`、`activeView: 'city'` 与 CityScene v1/v2 文件继续作为持久化兼容边界，不再扩散到产品组件和新 API。
- 本轮验证覆盖兼容别名真实调用、22 个 workspace 项目的完整单测和生产构建、Desktop 四种视口的浏览器交互，以及 Windows Tauri 本地资源保存恢复。原生报告与截图保存在 `evidence/native-scene-api-report.json` 和 `evidence/native-scene-api-restored.png`。

- Graphic 是独立对象，共享池只复用运行时资源，不向用户暴露人工 GraphicLayer。连续 POI 每次单击独立提交并保持工具，Esc 或“结束放置”释放输入；500 个独立 Graphic 实测只使用一个 Cesium `CustomDataSource`。搜索、10 对象多选/批量显隐、Undo/Redo、保存重开均有 E2E 断言，证据见 `evidence/browser-scene3d-graphic-scale-report.json`、`browser-scene3d-continuous-points.png` 和 `browser-scene3d-500-poi.png`。
- 裁剪/基础压平绑定目标 Tileset，明确局部坐标与高度语义，处理空间变换和 LOD。参考 cesium-demo 算法思路，不将实验效果或 UI 模拟当作生产能力。
- 至少两套不同空间变换、含 LOD 的真实 Tileset 验证效果、恢复/撤销、GPU 资源清理。诊断使用引擎实际指标，不显示编造性能值。

### M8 当前实施状态（2026-10-15）

- 已新增独立 `@desktop-webgis/cesium-tileset-effects` 包，并在 `TilesetNode.effects` 中持久化多边形裁剪。实现使用 Cesium 原生 `ClippingPolygonCollection`，每个 Tileset 独立安装，移除、替换场景及销毁时恢复宿主原集合。
- 已实现多范围、统一的保留内部/外部模式、坐标控制点编辑、重新绘制、启停、删除及项目历史撤销；三维瓦片页使用 Ant Design 的 Button、Select、Switch 和 Input.TextArea。相同配置就地复用原生集合，裁剪更新不重新下载 Tileset。
- 协议校验覆盖效果 ID、类型、启用状态、模式和至少三个不同有效坐标；运行时在提交替换场景前检查 WebGL 裁剪能力，能力不足时显式报错，不静默降级。
- 浏览器交互验收使用真实示例 Tileset，完成绘制、停用、撤销、删除、恢复及持久化断言，并确认 `tileset.json` 只请求一次。截图见 `evidence/browser-tileset-clipping.png`。
- 已实现局部 ENU 遮罩压平：每个范围可配置 WGS84 椭球目标高程，Shader 将世界坐标经 Tileset 模型变换正确换算到局部空间；支持多范围和重叠优先级。范围跨度限制为 5 km，遮罩限制为 2048 像素并同时遵守 GPU 最大纹理尺寸，超限时返回明确诊断。
- 压平纹理、`CustomShader` 和宿主状态按 Tileset 隔离并由管理器确定性释放；调用方已有自定义 Shader 时显式拒绝覆盖。单元测试覆盖双实例隔离、不同高度、超限、冲突和销毁恢复。
- 浏览器 GPU 路径使用真实示例 Tileset 验收压平、关闭恢复、项目保存重开，以及两个分别平移 -180 m / +180 m 的 Tileset 独立启停。12 项（3 场景 × 4 视口）全部通过，像素差异断言证明运行时几何发生改变而非只更新 UI。证据见 `evidence/browser-tileset-flatten-report.json`、`browser-tileset-flattened.png`、`browser-tileset-flatten-restored.png` 和 `browser-tileset-flatten-reopened.png`。
- Windows Tauri/WebView2 原生验收在 `ANGLE (NVIDIA GeForce RTX 5070, Direct3D 11)` 上通过，明确排除了 SwiftShader。真实 Tileset 在压平期间完成相机缩放、屏幕误差 16→4、关闭恢复和原生保存；压平前后变化 169984 像素，关闭效果变化 5071 像素。Shader 销毁及宿主状态恢复另有单元测试覆盖。证据见 `evidence/native-tileset-flatten-report.json` 和 `native-tileset-flattened.png`。
- 已对照 `cesium-demo` 的 `draw-util` 和 `model-editor`：裁剪/压平绘制采用其“优先深度拾取、失败回退地表”的有效思路；Gizmo 补齐 XY、XZ、YZ 三个平面拖动。生产实现继续保留独立会话所有权、Esc 回滚、相机输入恢复、ENU 射线平面约束、项目历史和完整销毁，不复制 demo 中全局 `removeAll`、私有字段访问或固定相机比例算法。
- 已新增独立 `@desktop-webgis/cesium-measure` 包，完成空间距离、贴地距离、水平面积和带正负号高度差。贴地距离沿 WGS84 测地线按 30 m 加密，有地形可用性时采样真实地形，交互采样总数限制为 4096；面积在局部 ENU 平面计算，避免直接使用经纬度面积。
- 测量完成后先挂载运行时专用临时 `GraphicLayer`，不修改 Project、Dirty 或历史；用户通过 Ant Design 结果卡选择“保留测量”后，结果才作为含测量元数据和 Popup 的独立 Graphic 写入项目。临时层在替换、清除、项目切换和 Runtime 销毁时确定性释放。
- 四种测量在 1440×900、1024×680、1366×768、1920×1080 共 4 项浏览器 E2E 全部通过，覆盖临时隔离、清除、保留、Undo/Redo 和保存文件断言。证据见 `evidence/browser-scene3d-measurement-report.json`、`browser-scene3d-measurement-transient.png` 和 `browser-scene3d-measurement-retained.png`。
- M8 计划内功能实现已闭环；验收矩阵 E08 仍因 Gizmo 真实指针拖动 E2E 保持“部分”，不由测量子项替代。

## 7. 每批验证与最终 PR

- 每批记录变更、SHA、构建/单测/交互命令及结果；适用尺寸 1366×768、1440×900、1920×1080 检查入口和数据区域。
- 迁移回归包含选择/搜索、值类型、Disabled/Busy、表格编辑/滚动/草稿、Tab 关闭、Esc/Tab/焦点恢复，DOM 改变不能成为删掉业务断言的理由。
- 浏览器、Windows Tauri、125% 缩放、物理 GPU、CI 是不同证据；未覆盖的路径保持未签收。
- M0–M9 与 E01–E20 保持完整范围，逐条绑定真实数据、操作、结果。全量 Gate 达成后提交独立 PR，附迁移兼容说明、原生控件审计和运行/验收文档。
- 保留无关 `apps/desktop/src-tauri/Cargo.toml` 改动，不重新开始工程或清理他人工作。

接入依据：[官方 React 介绍](https://ant.design/docs/react/introduce/)、[ConfigProvider](https://ant.design/components/config-provider/)、[Modal](https://ant.design/components/modal/)。

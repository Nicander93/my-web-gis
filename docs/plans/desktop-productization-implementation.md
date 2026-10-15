# Desktop 产品化实施记录

执行依据：[2026-10-13 交付包](../design/desktop-productization/webgis-agent-delivery/README.md)。包内 HTML 和截图是交互参考，不能作为 GIS 或 GPU 算法验收证据。

2026-10-13 追加要求：[实施补充细则](../design/desktop-productization/implementation-addendum.md)。明确采用 Ant Design 通用组件，保持既定原型，组件迁移与 M0–M9 功能开发一起推进。

## 基线与边界

- 2026-10-13 fetch 后，`origin/main` 为 `015774120577546514baadd30cc22b1c79d9dbe4`。
- 原工作分支 HEAD 为 `6f79c708c2e5aab61343790bb698e8d53348b639`，与该 main 的文件内容一致。
- 实施分支：`codex/desktop-productization-v1`，从上述 main 创建。
- 开始时 `apps/desktop/src-tauri/Cargo.toml` 已被修改；本阶段保留，不纳入提交。
- 继续使用 React / Zustand / Tauri / OpenLayers / Cesium；二维、三维项目保持独立。
- M1 未修改 ProjectSnapshot、CityScene v1/v2、SceneDocument v3 的序列化格式。M2/M3 的文件夹批次随后增加兼容的可选层级字段，保留旧版本读取与原有 ID。

基线命令：

```powershell
rtk pnpm install --frozen-lockfile
rtk pnpm build
rtk pnpm test
rtk pnpm --filter @desktop-webgis/desktop test:e2e --project=desktop
```

冻结依赖安装、全仓构建和测试通过。Desktop 单测 211 通过、5 跳过；主尺寸 Desktop E2E 39 通过。跳过项为原有原生凭据/宿主相关项目，浏览器测试不能代替原生验收。构建保留原有大 chunk / 动静态 import 警告。

受限 Windows 沙箱中的 Node `realpath` 返回 EPERM；验证通过正常执行权限运行，没有更改依赖版本或放宽产品权限。

## M1 首批：Shell 与窗口系统

代码入口：

- `apps/desktop/src/app/docking/`：窗口定义、布局校验、屏幕边界约束、停靠/浮动、拖动、缩放、最大化、关闭及焦点层级。
- `apps/desktop/src/stores/docking.store.ts`：仅保存本机窗口位置，不参与项目、dirty 或撤销历史。
- `app/{LeftPanel,RightPanel,BottomPanel}.tsx`：窗口容器不导入业务功能。
- `app/Workspace.tsx`、`features/map/MapCanvas.tsx`、`features/city/CityWorkspace.tsx`：画布完整铺底；面板覆盖，不为左右/底部窗口留空。
- `app/Header.tsx`、`app/header/`、`features/city/CityRibbon.tsx`：文件/窗口/设置/帮助，二维四个任务页签、三维五个任务页签。

真实行为：

1. 默认左树打开、右检查器和底部属性表关闭。底部属性表横跨完整工作区。
2. 标题栏拖动转为浮动；下拉选择左/右/底/浮动。可关闭、恢复、缩放、最大化和重置。
3. 关闭后没有边缘恢复按钮；用“窗口”菜单打开。窗口设置即时保存到本机，重新打开和重启后恢复。
4. 聚焦浮窗标题栏后方向键移动，Shift 加速；聚焦调整大小控件后方向键缩放。拖动中 Esc 回滚未提交的窗口手势。
5. 显示/隐藏窗口保持地图和 Cesium 实例；专注模式保留窗口业务内容及未应用的样式草稿。
6. 原有二维导入、服务、导出、编辑、属性表、统计、处理入口保留。原有低频菜单收敛到“设置”的数据/图层/编辑分类，常用操作仍在 Ribbon 与右键菜单。
7. 三维未接入的测量/分析明确显示未接入，不执行模拟操作。

新增测试 `docking-layout.test.ts` 覆盖损坏布局、不同屏幕边界、独立序列化。`e2e/docking.e2e.ts` 验证画布矩形、窗口拖动取消、键盘缩放、重启恢复、项目快照/dirty/undo 不变及 Cesium canvas 身份不变。

旧 E2E 调整理由：菜单名称变化；覆盖窗口允许遮挡地图，所以鼠标输入用例通过实际菜单先关闭树；表格整宽后横向可滚动范围改变，以实际滚动值验证恢复，不硬编码 200 像素。保留原数据/历史/算法断言，没有跳过失败用例。

## 功能审计与后续阶段

### M2/M3 文件夹与兼容批次

实现文件：`packages/gis-core/src/layer-tree.ts`、`packages/cesium-scene-schema/src/{index,groups}.ts`、`packages/scene-schema/src/document.ts`、Desktop 的 `LayerPanel`、`CitySceneTree`、树命令与 `project-scene-document` 桥。

- 二维 `LayerGroup` 增加可选 `parentId/locked/childOrder`；旧 `layerIds/rootOrder` 继续读取。嵌套层级与混合兄弟顺序参与实际渲染顺序。
- 三维 `CityGroup` 增加可选 `parentId`，沿用 CityScene v2 并继续读取 v1/v2。JSON Schema 同步记录该字段。
- 两种树都可创建子文件夹、拖动跨父目录、搜索深层对象并展示父路径；循环、缺失父级、重复 ID 和不支持的树对象在提交前报错。
- 父级显隐/锁定只参与有效状态计算；不写入子对象自己的设置。二维锁定禁止进入几何编辑、表格属性修改和样式应用，并取消受影响的活动地图编辑工具。
- 二维重命名、移动、显隐、锁定、解散和子树删除接入单次撤销命令；子树删除保存全部数据快照，撤销一次即可恢复。删除不会清理无关的未使用数据集。
- 解散文件夹保留后代，在原位置提升直接子项；隐藏文件夹解散后仍保留原实际显隐。
- SceneDocument v3 导入/导出保留二维和三维嵌套关系；三维命名空间与二维发生 ID 冲突时，父引用与节点引用一起重映射。
- 二维树双击图层改为定位；重命名仍通过右键菜单显式进入。

验证：

```powershell
rtk pnpm build
rtk pnpm test
rtk pnpm --filter @desktop-webgis/desktop test:e2e --project=desktop
rtk pnpm --filter @desktop-webgis/desktop test:e2e folders.e2e.ts --project=desktop --project=laptop --project=wide
```

全仓构建和测试通过；Desktop 216 通过、5 个原有环境项跳过；gis-core 73、cesium-scene-schema 19、scene-schema 26 个测试通过。完整 Desktop 主尺寸 E2E 44 通过；文件夹专项三个尺寸 6 通过。运行中源码热更新曾使两项浏览器用例异常重载，冻结源码重新执行后全部通过，没有跳过失败用例。

截图：[二维嵌套文件夹](../design/desktop-productization/evidence/laptop-nested-2d.png)、[三维嵌套文件夹](../design/desktop-productization/evidence/laptop-nested-3d.png)。本批只完成文件夹层级与对应兼容链路；三维对象/文件夹混排、固定 ID 的完整属性窗口、CRS 命令、拓扑编辑等仍按总目标继续实施。

| 阶段 | 已有可保留能力 | 本方案仍需实现/签收 |
|---|---|---|
| M0 | 构建/单测/E2E 基线；旧项目和公开 SceneDocument 转换测试 | 原生截图、完整依赖/能力审计仍须随阶段补齐 |
| M1 | 首批三行 Shell、两引擎覆盖式窗口、布局恢复 | 全局工具会话协调；工具箱/日志/诊断独立窗口随后续阶段接入 |
| M2 | 点线面编辑、捕捉、选择、CRS/导出；已接入嵌套 Folder 与原子树命令 | 明确 CRS 赋值工作流及复杂拓扑编辑、专业选择能力 |
| M3 | 模型/Tileset 选择、整体 Gizmo、专业 Inspector、旧 CityScene 兼容；已接入嵌套 Folder | 文件夹/对象混排；完整属性窗的二维/文件夹接入、全部专业参数与预览（首批三维窗口及检查器固定已实现） |
| M4 | 分页、搜索、过滤、统计、属性单元格、处理算法/取消；多图层 Tab、原子字段计算、字段管理、面合并/分割、列显示/排序/宽度和 antd Table | 完整空间运算验收及处理工具控件迁移 |
| M5 | point/polyline/polygon Graphic、几何编辑、对象独立样式、共享原生渲染池、连续 POI 与 Esc、500 对象搜索/多选/批量显隐/保存重开 | Billboard、rectangle、ellipse 等扩展标绘类型 |
| M6 | 本地二维文件、多 GeoJSON 批次、原子导入/Undo/Redo、读取取消与工程归属保护；WMS/WMTS/WFS、三维资源加载、失败重试 | 混合格式配置队列、服务导入历史、大文件 Worker；二三维添加数据壳、基于项目路径的资源引用/另存重算、父目录重定位 |
| M7 | 原生原子替换、串行保存/版本与工程会话保护、格式校验及草稿保护；独立恢复缓存、启动恢复/舍弃、容量/保留期与保存清理；Tauri 二维属性/三维 GLB 强制退出恢复 | 系统文件选择窗口、原生完整本地资源组合与 Windows 125% 缩放验收 |
| M8 | 独立 Gizmo（轴向与 XY/XZ/YZ 平面）、Tileset 原生裁剪、局部 ENU 压平、多变换隔离、项目保存重开与物理 GPU/LOD 验收；空间距离、贴地距离、面积和高度差，临时结果与保留 Graphic 分离 | 功能实现与 E08 浏览器真实指针验收已闭环 |
| M9 | 本阶段窗口 E2E 与已有真实 GIS E2E | 真实指标诊断、任务日志、全量 20 项矩阵、原生和 GPU 综合验收 |

本记录不表示 M0–M9 全量完成。恢复草稿已实现，Windows 文件层、浏览器与 Tauri 二维属性/三维 GLB 恢复证据见后文 M7 批次；系统文件选择仍待专项签收。M8 的 Tileset 裁剪/压平已完成两套不同变换实例、保存重开、LOD 和 NVIDIA 物理 GPU 验收，四类基础三维测量已完成四视口浏览器验收；E08 的 GLB/Tileset Gizmo 真实指针拖动 E2E 已通过。

## 后续执行顺序（2026-10-15 用户确认）

1. 属性与窗口：固定对象的完整属性、Apply/OK/Cancel、检查器固定。
2. 二维专业编辑：源 CRS 赋值、复杂拓扑、多要素顶点编辑。
3. 标绘：Billboard、矩形、椭圆。
4. 数据管理：混合格式队列、大文件 Worker、本地资源重定位。
5. 产品配套：诊断、任务日志、全局工具会话协调。
6. 最终交付：原生文件选择、125% 缩放、完整验收与独立 PR。

首批已接入三维对象右键“完整属性”：独立可移动/调整尺寸的非模态窗口，固定对象 ID，分类与字段/API 名称搜索，模型地理位置与变换、Graphic 样式/结构化数据属性、Popup 字段、Tileset 精度/缓存、水面数值草稿；Apply 原子提交并保留窗口，OK 提交关闭，Cancel 丢弃未应用草稿。检查器固定后浏览其他对象不会偷换修改目标。删除、继承锁定、并发修改及项目切换均有保护。二维图层/文件夹完整窗口、裁剪压平专业页、全部参数覆盖与实时预览尚未闭环，E14 保留“部分”。

## 验证记录

M0 资料/基线提交：`41a57e0`。

M1 首批验证：

```powershell
rtk pnpm --filter @desktop-webgis/desktop build
rtk pnpm --filter @desktop-webgis/desktop test
rtk pnpm --filter @desktop-webgis/desktop test:e2e --project=desktop --project=laptop --project=wide
rtk pnpm --filter @desktop-webgis/desktop test:e2e docking.e2e.ts --project=desktop --project=compact --project=laptop --project=wide
```

- Desktop 生产构建成功；单测 214 通过、5 个原有宿主/凭据环境项跳过。
- Desktop 全量 E2E：1440×900 / 1366×768 / 1920×1080 三个尺寸共 126 通过。
- 首批窗口专测：1024×680 / 1366×768 / 1440×900 / 1920×1080 共 12 通过。后续增加三维专注模式快捷键后，三个主尺寸已随 126 项回归验证。
- 最后补跑 compact 窗口专测 3 通过，覆盖三维专注模式快捷键。最终源码生产构建再次成功。
- `git diff --check` 通过。
- 原有导入、服务、二维选择/绘制/Undo/Redo、字段/主题样式、空间处理、项目保存重开、三维真实 GLB/资源失败重试仍由这些 E2E 覆盖。

浏览器运行截图（1366×768）：[窗口浮动](../design/desktop-productization/evidence/laptop-docking-2d.png)、[二维数据/属性工作流](../design/desktop-productization/evidence/laptop-workbench.png)、[三维窗口](../design/desktop-productization/evidence/laptop-docking-3d.png)、[GLB 资源故障恢复后的实际模型](../design/desktop-productization/evidence/laptop-city-resource-recovered.png)。模型截图来自真实 GLB 测试，不是城市效果、裁剪或压平验收。

原生 Tauri 文件选择/保存、Windows 125% 缩放及物理 GPU 压平不由浏览器矩形测试签收。未建立最终 PR，因为全量 M0–M9 Gate 尚未满足。

## 原型视觉校准（2026-10-14）

用户指出运行截图的弹窗、按钮细节弱于确认原型。本批直接以原型 CSS 为依据校准，保留 Ant Design 的交互能力：

- 浅色主题恢复原型的绿色文字、边框、选中状态与浅绿遮罩，清理旧 Button CSS 与 antd 默认主题的冲突。
- 共享 Modal 使用 620px 宽度、7px 圆角、41px 独立标题栏、原型的边框和阴影；字段与拓扑表单操作区具有独立分隔线、8px 操作间距，弹窗按钮高度 31px。
- 添加数据恢复顶部来源页签与浅绿虚线拖放区域，现有按钮全部迁移为共享 antd Button；导入步骤、坐标配置与真实文件读取继续保留。
- 尚未将所有旧窗口和三维控件的视觉一致性签收。后续功能批次继续迁移，并以原型对照截图校验。

验证：全仓构建与测试通过，Desktop 231 通过、5 个环境项跳过。1366×768 全量浏览器回归 48 项通过，覆盖 CSV 首字段聚焦、Tab/Shift+Tab 边界、关闭返回入口、真实导入、编辑和保存。合并/分割与取消专项在 1366×768 和 1920×1080 共 4 项通过；取消后重新聚焦可用的提交按钮。原生窗口和物理 GPU 不由这些浏览器检查签收。

运行截图：[添加数据](../design/desktop-productization/evidence/laptop-prototype-aligned-add-data.png)、[合并面弹窗](../design/desktop-productization/evidence/laptop-prototype-aligned-merge-dialog.png)。合并/分割属于正在开发的下一功能批次，本节仅记录其共享 UI 校准与已运行测试。

## M2/M4 原图层面拓扑批次（2026-10-14）

- 编辑 Ribbon 的合并面/分割面绑定当前编辑图层和所选面；打开后固定目标 ID，取消未完成地图工具。
- 合并调用 spatial-analysis 的 JTS 联合算法，支持相邻、重叠和离散面，保留洞。提供指定要素属性、数值求和、冲突设空三种显式策略；字段类型、有限数值与非空约束在计算前校验。
- 分割可使用已有线要素或 WGS84 LineString/MultiLineString GeoJSON。边界与切割线节点化后多边形化，保留洞和面积，不使用缓冲带制造缝隙；最大分片保留原 ID，新增分片继承属性并产生唯一 ID。
- Worker 独占计算资源，成功、失败和取消均终止线程并移除监听。只在全部计算完成后提交一条 SetDatasetContentCommand；不成立的切割、非法几何、取消不会修改原数据或新增历史项。
- 提交前再次检查工程、编辑目标、数据集及所有共享图层的祖先锁。期间原数据变化会拒绝旧结果，保留新编辑。Undo/Redo 恢复 schema、属性和几何，图层过滤仍参与可见结果。
- 目前明确支持有效二维经纬度几何；Z/M 和跨日期变更线输入会报错，避免静默丢失信息。临时绘制切割线与更完整空间处理矩阵继续实施，不把本批当作 M2/M4 整体完成。

验证：全仓构建/测试通过后追加边界测试，Desktop 单元测试 233 通过、5 个原有环境项跳过；最终 Desktop 生产构建通过。spatial-analysis 41 项含 8 项真实拓扑单测。原有全量笔记本 E2E 48 通过；最新拓扑专项三个尺寸共 12 项通过，覆盖属性求和、面积、唯一 ID、一步撤销/重做、项目保存重开、真实 Worker 取消、异步旧结果拒绝、无效/无效力切割不写入。[运行中的分割结果](../design/desktop-productization/evidence/laptop-polygon-topology.png)。

## M4 属性表与字段计算批次

- 一个属性表窗口可打开多个图层 Tab。关闭当前 Tab 自动选择相邻项；删除图层会清理对应项。Tab 按图层 ID 绑定，浏览场景树不改变表格目标。
- 各表组件保留未应用的过滤草稿和计算草稿，搜索、分页、排序、统计字段、列隐藏/顺序、双向滚动保存在图层会话中。关闭窗口与专注模式不卸载这些组件。窗口重新打开和 Tab 切换已有实际交互测试。
- 表内字段计算可选择全部记录、图层过滤后或选中记录。表内文本搜索不改变计算范围。仅当前编辑目标的本地矢量图层可写入，文件夹锁与只读服务仍生效。
- 使用现有安全表达式编译器，在提交前计算并校验全部目标行。字段名、引用字段、有限数值、布尔/文本/JSON 类型与非空约束有检查；失败不会写入任何字段或记录。部分范围新增字段时其余行填 null，非空约束不允许这种部分计算。
- `SetDatasetContentCommand` 在同一历史项中提交字段定义与记录，保持 Feature ID 和几何。Undo/Redo 同时恢复 schema 和属性，不清空表格会话。处理工具箱的字段计算继续生成新的结果层。
- 单元格编辑按照字段定义解析，文本字段保留前导零，非法类型显示错误并保留原值。列显示调整是会话设置，不写入项目历史。
- 过滤、统计、计算器和字段列表互斥展开，保留草稿但给表格数据行留下空间。字段新增/重命名/删除管理与面合并策略尚待下一批，未将 M4 整体标为完成。

验证：全仓 `rtk pnpm build` 与 `rtk pnpm test` 通过，Desktop 221 通过、5 个原有环境项跳过。新增计算/Tab 回归与专注模式会话恢复在 1440×900、1366×768、1920×1080 三个尺寸共 6 项通过。旧会话 E2E 的选择器更新为当前可见 Tab，保留原来的数据、滚动和草稿断言。最终源码的全量 Desktop 主尺寸回归 45 项全部通过。[1366×768 字段显示与计算结果](../design/desktop-productization/evidence/laptop-table-fields.png)。

## Ant Design 组件迁移 A 批次（2026-10-14）

- 用户明确要求统一采用 Ant Design；补充细则和工程约定已更新。`antd 6.6.6` 已加入 Desktop，lockfile 保留精确依赖。
- 全局 `DesktopUiProvider` 提供中文、small 尺寸、原型对应的绿色/浅灰 token，关闭双汉字按钮自动空格。库的中文排版行为不会改变既定操作名称。
- 共享 Button 与 EditorDialog 改用 antd Button/Modal；属性表的多 Tab、图层选择和字段计算器使用 Tabs、Select、AutoComplete、Input、Checkbox 与 Button。
- Modal 保留 Busy/Esc/遮罩边界，并处理条件卸载时触发控件的焦点恢复；补充边界 Tab/Shift+Tab 循环，避免浏览器把焦点移到 body。实际 CSV 回归保留首字段聚焦、前后向循环、关闭返回入口的断言。
- antd 6 的 Tabs 使用实际 body-holder/body/content 容器约束高度；表格仍在窗口内双向滚动，切换 Tab/专注模式保留搜索、滚动和草稿。
- 既有 Ribbon、菜单、导入/导出表单、属性表数据区、检查器及三维表单仍有手写控件，继续按 B/C/D 迁移；本批不表示全库控件已经统一，也不表示 M0–M9 完成。

当前证据：Desktop 单测 221 通过、5 个原有环境项跳过；最终源码构建通过，Desktop 主尺寸全量 E2E 45 项通过，1366×768 与 1920×1080 的样式/计算/CSV 焦点/会话专项 8 项通过。Tab/Shift+Tab 循环、触发控件焦点恢复、分页栏留在窗口内、表格滚动/草稿恢复的断言全部保留。[1366×768 Ant Design 字段计算器](../design/desktop-productization/evidence/laptop-antd-field-calculator.png)。

## M4 字段管理批次（2026-10-14）

- 字段列表与新增/重命名/删除事务使用 Ant Design Checkbox/Button/Form/Input/InputNumber/Select/Alert/Modal；只读状态禁用入口。新增字段可指定类型、空值约束及全部记录的默认值，文本前导零不会丢失。
- 重命名覆盖同一 Dataset 的所有图层过滤、分类/分级样式、标注和弹窗字段。Feature ID、几何、metadata 与字段值保持不变，弹窗格式与用户标签保留。
- 删除仍被引用的字段默认失败；勾选清理引用后才移除相关配置及过滤草稿。分类/分级样式回退为已有 fallback 符号，不凭空生成新的样式。数据、字段定义和配置用一个命令提交，Undo/Redo 一起恢复。
- 表格过滤草稿改为按图层会话保存；字段重命名同步草稿、排序/统计字段和列显示/顺序。字段删除暂时停用不存在字段的排序/统计，保留其会话偏好，撤销删除后可继续使用。搜索、滚动与 Tab 不因字段编辑而清空。
- 共享数据集的任一引用图层被锁定时阻止字段编辑；未应用样式草稿阻止重命名/删除及其历史恢复。目标图层已被重新绑定其他数据集时，核心命令在写入前拒绝，避免半成品。
- 六个 Desktop 单测覆盖类型/默认值、冲突、共享引用、撤销/重做、草稿和祖先锁；gis-core 补充目标重绑定前置校验。真实浏览器用例从文件导入，经字段管理、过滤、撤销到保存重开，保留了实际文件数据和 schema 断言。

当前全仓构建/单测通过，Desktop 227 通过、5 个原有环境项跳过；gis-core 74 项通过。最终源码 Desktop 构建追加通过，桌面全量 E2E 46 项通过，字段管理专项三种尺寸共 3 项通过。截图：[Ant Design 重命名事务](../design/desktop-productization/evidence/laptop-field-rename.png)、[保存重开后的字段与文本值](../design/desktop-productization/evidence/laptop-field-schema-roundtrip.png)。面合并/分割与 Table 控件迁移仍在后续范围，未将 M4 整体标为完成。

## M4 属性表组件与一致 UI 批次（2026-10-14）

用户明确原型是初版方向，产品优先遵循一致 UI 规则。补充细则记录统一的密度、字号、控件与窗口圆角、分区、主次按钮和状态，不要求逐像素复制。

- 属性表正文使用 antd Table；搜索/单元格输入、选择框、过滤/统计字段选择、选择菜单均使用 antd。AttributeTable.tsx 已不包含手写 input/select/button/table/details 通用控件。
- 表头、记录行、边框、悬停、选择、数值排版与编辑控件由共享主题和 workbench 样式提供。保留真实 Feature ID、点击选择、Ctrl 多选、双击/Enter 编辑或定位，以及 100 行分页的业务范围。
- 表格仍使用现有外部滚动容器，保持各图层横纵滚动的会话恢复；列宽明确限制在 80–600px，可拖动、方向键微调、Home/End 设置边界、双击重置。Esc 回滚当前拖动，不污染项目历史。
- 宽度与列显示/顺序、排序和草稿一起按图层会话隔离；字段重命名同步迁移宽度，Undo 恢复字段与宽度，删除字段保留宽度 tombstone 以支持 Undo。重置列显示同时清空宽度。
- 选择菜单回归保留匹配范围、关闭和 Esc 返回入口的断言。过滤测试因 Select 迁移改用可见下拉选项与具名控件，保留原过滤值、草稿、schema 和保存数据断言。

验证：最终 Desktop 生产构建通过，233 个单元测试通过、5 个原有环境项跳过；1366×768 全量 E2E 51 项通过。列宽专项在 1440×900、1366×768、1920×1080 共 3 项通过，包括实际列矩形变宽、键盘/取消、跨表隔离、无项目/历史修改和字段重命名/Undo。最新源码追加 1440×900、1920×1080 的 Tab/字段管理/列宽专项 6 项全部通过。全量浏览器复跑包含真实 GLB 像素/资源重试，原生及物理 GPU 仍未签收。[统一属性表运行截图](../design/desktop-productization/evidence/laptop-consistent-attribute-table.png)。

## M6 本地矢量导入事务批次（2026-10-14）

- GeoJSON/SHP ZIP/DXF/CSV 的确认导入共用一个同项目内容命令，一次所选图层形成一条历史记录。全部名称、记录 ID 和属性对象先验证/克隆，批次出错不会留下第一个图层的半成品；Redo 复用原数据集、图层和 Feature ID。
- 浏览器选择/拖放支持多个 GeoJSON 文件，逐一按各自声明或显式源 CRS 读取，统一预览和确认；其中任何文件失败即拒绝整批。Tauri 接入多选文件 API，但本批未签收 Windows 原生选择。混合 SHP/DXF/CSV 的多文件配置队列仍需实施，当前这些格式按各自配置流程逐次选择；一个 SHP ZIP 的多个所选图层已经是原子批次。
- 内容命令只处理变化项，保留已有编辑目标、选择和表格会话；导入 Undo 清理被移除图层的会话/任务，恢复之前浏览的图层。未受影响的样式草稿不阻止导入；导入图层自己的未应用草稿会阻止其 Undo。
- 读取期间可取消，并以递增读取代次和打开时工程 ID 丢弃旧结果。换工程、取消后继续选择文件或关闭窗口，都不会让迟到结果进入当前项目。底层 File.text/native 读取 Promise 不被强行中断；大文件解析 Worker 与强制计算取消尚未签收。
- 提交错误保留预览并显示信息，不以页面异常关闭窗口；读取未结束时禁止确认。快照校验/克隆移到会话清理之前，拒绝无效内容不会先清掉已有会话。
- Windows 源路径统一取文件名作为图层名，传给实际读取适配器的原路径保持完整；保留源 CRS、Source ID、前导零、字段、属性和几何。原文件不参与项目快照写入。

验证：最终 Desktop 构建通过，238 个单元测试通过、5 个原有环境项跳过。新增四个事务单测覆盖多层一步恢复、已有会话、输入别名、坏层整批拒绝和草稿保护；原有导入测试补原生路径参数/名称验证。1366×768 全量浏览器 E2E 55 项通过，包含 SHP 多图层一次 Undo/Redo，以及导入历史接入后的拓扑取消、错误和列宽无历史断言。导入事务专项在 1440×900、1366×768、1920×1080 共 12 项通过，验证真实 File 读取后的旧结果、工程替换、坏文件、地图运行时、稳定 ID 和真实保存文件重开。

保存回归逐项比较实时地图视图与写入文件，重开后比较整份快照；没有把引擎初始缩放约束当成导入数据变化，也没有删去地图状态、数据或 ID 断言。[多文件预览截图](../design/desktop-productization/evidence/laptop-multi-geojson-preview.png)。本批不代表 M6 的三维本地资源、相对路径、重定位或原生文件流程已签收。

## M7 安全保存与会话归属批次（2026-10-14）

- 原生 text/binary 写入共用 `atomic_file`：同目录 create_new 创建唯一临时文件，写完整字节并 sync_all、关闭句柄后 rename 替换。写入/flush/替换失败保持旧目标，未提交临时文件尽力清理。成功后解除临时路径清理责任。不增加或改写 Cargo.toml 依赖。
- 保存/另存使用串行队列，同一工程会话/模式的排队请求合并；启动时捕获最新内容，避免旧写入晚于新写入。期间编辑不覆盖当前模型，也不清除新修改的 dirty。
- 新建/打开增加内存工程会话代次，同 ID 文件重开也是新会话。文件路径由成功的当前会话提交，不由读取/写入适配器提前修改。普通内容命令与 Undo/Redo 保留工作文件关联。选择/表格/Docking 不增加文档版本，会话代次与版本不写入项目协议。
- 保存捕获已归属当前工程/预设的真实地图或三维相机，不借用旧工程视口。确认严格检查文档版本；只对 Cesium 约 1e-13 度分解噪声容忍极小视图误差，不舍入文件数值，不忽略真实相机移动或显式文档编辑。
- 打开后复查会话与版本；选择/读取期间新编辑或新样式草稿会保留当前内容。无效加载先验证/克隆，再清理会话与历史，失败不会先丢掉原 Undo。
- 新建/打开处理未应用样式，取消保留草稿，明确放弃才清理。应用草稿后新建需成功保存当前版本；保存失败/换工程不能继续新建。保存确认返回布尔值，避免新工程恰好 dirty=false 时错误地继续。
- 二维/三维保存入口显示真实 pending/Busy，相关操作按钮采用共享 Ant Design。磁盘恢复草稿仍待下一批，本批失败保留当前内存文档，不能宣称已经建立磁盘恢复保障。

验证：Desktop 构建通过，251 单测通过、5 个原有环境项跳过。保存事务 11 项覆盖旧保存/新编辑、同 ID 重开、排队合并/顺序、取消/失败/重试、另存路径、会话 UI、完整场景 Undo 工作文件、微小角度噪声/真实相机移动、无效加载保留会话与历史；地图/相机归属另有回归。

Windows 上独立编译原生文件模块 4 项通过；最终 Tauri `rtk cargo test --lib --locked` 7 项通过，其中包含这 4 项：完整 UTF-8/二进制替换、部分临时数据后的故障、非法目标、真实 share_mode(0) 占用下旧内容与清理。证明文件层，不代替 Tauri 文件选择窗口、进程突然终止、恢复草稿或断电保障。

最终 1366×768 全量浏览器回归 57 项通过；1440×900、1366×768、1920×1080 的打开保护与二维/三维文件夹保存重开专项 12 项通过。新用例用真实单元格编辑和文件选择证明迟到读取不覆盖当前内容；新建/打开取消草稿后保留数据与样式，明确放弃后继续。三维保存保留 dirty=false 断言，没有绕过未保存提示。

## 属性表 UI 状态一致性补充（2026-10-14）

按统一 UI 规则调整共享按钮：自定义实心/普通配色仅应用于可操作状态，禁用时保留 antd 禁用颜色；键盘焦点边框覆盖属性表、工具栏和弹窗。字段计算器使用共享按钮，提示文字统一 11px 与次级文字颜色，错误使用危险色。计算器布局选择器限定直接子元素，避免影响 antd 内部 combobox、Checkbox 等控件。

Desktop build 通过；`attribute-tabs.e2e.ts`、`field-schema.e2e.ts` 在 1366×768、1440×900、1920×1080 共 6 项通过，覆盖 Tab 草稿、字段计算失败回滚、字段管理、过滤、Undo/Redo 与保存重开。[最终属性表截图](../design/desktop-productization/evidence/laptop-unified-table-controls.png)。这是浏览器证据，未替代 Windows 原生或 125% 缩放验收；其余界面继续按同一规则分批迁移。

## M7 恢复草稿批次（2026-10-14）

接入应用数据目录原子缓存与浏览器 IndexedDB，按项目 ID 隔离，提供启动恢复/舍弃/暂不处理和失败重查。修改空闲 5 秒、持续编辑每 120 秒写入已应用快照；每项 32 MiB、总量 128 MiB、20 个项目、30 天保留。损坏/未知版本不加载且保留到明确舍弃；Windows 文件版本戳与条件删除保护迟到操作，独占句柄保护同机其他应用进程。

恢复为未保存副本，保持数据、图层、对象 ID，保存时明确选择位置。成功保存只清理对应会话的草稿；保存与清理期间的新编辑/换项目仍不确认旧版本。明确放弃后实际替换才清理；取消选择保留草稿。详细操作和边界见 [项目恢复草稿](../engineering/project-recovery.md)。

最终 Desktop build、261 项单测（5 项既有环境跳过）、15 项 Rust 测试通过。Rust 父测试实际运行两个默认 ignored 的退出探针，分别验证临时写入中退出不损坏旧文件、缓存提交后退出仍可重读。1366×768 完整浏览器回归 60 项通过；1440×900 与 1920×1080 恢复专项再通过 6 项，三个尺寸合计 9 项恢复交互。新交互先确认最新属性/光照修改进入真实缓存，再关闭页面和恢复，比较完整图层/数据与三维分组、光照、效果、节点/资源，最后保存并检查缓存清理。[恢复启动截图](../design/desktop-productization/evidence/laptop-recovery-startup.png)。原生 Tauri 界面、125% 缩放与完整资源组合仍待专项签收，E18 保持“部分”。

## M7 Tauri 原生恢复专项（2026-10-14）

通过 `native-recovery-acceptance.mjs` 启动独立标识的真实 Tauri/WebView2，检查原生桥/应用标识/应用数据目录，对二维属性计算与三维真实 GLB 缩放分别执行强制结束进程树、重启、启动恢复、原生保存和草稿清理。完整数据及 ID 保持，旧正式文件字节不变；GLB 显隐对照像素由 51,355 降至 14,806，再恢复至 51,348。测试实际 viewport 1037×648、DPR 约 1.39；保存工作路径预先绑定，系统文件选择与 Windows 125% 未覆盖。

最终脚本运行退出码 0；隔离及普通 debug 原生构建均通过，仅有现有 linker 信息警告；正常 debug 配置已恢复，测试应用/服务均结束。代码范围为验收脚本和证据文档，不修改生产功能或无关 Cargo.toml。[原生报告](../design/desktop-productization/evidence/native-recovery-report.json)、[启动截图](../design/desktop-productization/evidence/native-recovery-startup.png)、[GLB 恢复截图](../design/desktop-productization/evidence/native-city-recovery.png)。E18 增加原生核心流程证据，完整组合继续保持部分签收。

## M6 受控本地资源协议批次（2026-10-14）

新增原生 `webgis-resource` 协议与按目录授权/撤销接口，提供稳定层级的 base URL，支持 GLTF 外部 buffer/纹理及 JSON 子资源。每次读取检查 canonical 路径，拒绝编码遍历和实际 Windows junction 越界；随机 token、来源限制、MIME、单段 Range/HEAD/If-Range、响应大小与授权数量保护均有单测。

21 项 Rust 测试通过；最终真实 Tauri 验收脚本退出码 0，外部几何/UV buffer 字节、1×1 PNG 实际解码、Range/HEAD/MIME、缺失/越界/撤销状态通过，二维/三维原生恢复与模型像素回归仍通过。没有修改 Cargo.toml；普通 debug 配置已恢复。[原生协议报告](../design/desktop-productization/evidence/native-local-resource-protocol-report.json)、[接口及边界](../engineering/local-resource-protocol.md)。

本批为 M6 的原生读资源基础层；产品持久引用、另存重算、父目录重定位与统一添加数据尚未接入，不将其标记为已实现。

## 20 项验收矩阵的当前证据

“部分”表示已有自动化覆盖部分行为，不等于该条完整签收。

| ID | 当前状态 | 证据/未完成项 |
|---|---|---|
| E01 | 浏览器通过 | 多 GeoJSON 统一预览/原子提交、真实地图数据源与属性表、一步 Undo/Redo、保存重开；SHP 多图层及 CSV/DXF 配置仍有真实回归 |
| E02 | 部分 | 绘制、取消、Undo/Redo E2E 通过；多要素顶点编辑完整矩阵待补 |
| E03 | 浏览器通过 | 原图层面合并、显式属性策略、一条命令 Undo/Redo、有效几何与保存重开；见拓扑批次 |
| E04 | 浏览器通过 | 点击选中、双击定位/编辑、IME/输入历史与焦点隔离；antd Table、多 Tab、列宽/显示/排序、字段管理与共享引用迁移回归通过 |
| E05 | 浏览器通过 | 表内字段计算原子写入原数据；逐行错误、类型、空值约束提前校验；一个 Undo/Redo 恢复字段定义与记录 |
| E06 | 部分 | 真实缓冲结果层及处理算法单测通过；四组空间处理专项矩阵待补 |
| E07 | 部分 | 国内地图投影、导出 CRS、历史一致性通过；源 CRS 赋值工作流待接入 |
| E08 | 浏览器通过 | 实际 GLB 与 Tileset 真实指针轴向拖动、单次历史提交、撤销；Tileset 重做与 Esc 手势回滚通过；XY/XZ/YZ 射线约束另有单测。见 browser-scene3d-gizmo-pointer-report.json |
| E09 | 浏览器通过 | 连续单击创建 3 个独立 Graphic，每次独立进入历史；Esc 后点击不再创建，Undo/Redo 通过 |
| E10 | 浏览器通过 | 500 Graphic 仅使用 1 个原生 CustomDataSource；搜索、10 对象多选与批量显隐范围、保存重开 ID/样式/位置通过 |
| E11 | 通过 | 目标 Tileset 原生裁剪、多范围、撤销/恢复、保存重开及双变换实例隔离通过 |
| E12 | 通过 | 局部 ENU、动态椭球高程、多高度遮罩、模型变换、LOD、关闭恢复和 Shader 销毁通过；Tauri 在 NVIDIA D3D11 物理 GPU 上验收 |
| E13 | 浏览器通过 | `docking.e2e.ts` 验证画布不变、整宽属性表 |
| E14 | 部分 | 三维对象固定 ID 非模态窗口、草稿 Apply/OK/Cancel、检查器固定及并发冲突保护已实现；二维图层、文件夹和全部类型专业参数/预览仍待补齐 |
| E15 | 部分 | 新建/打开/场景导入草稿保护、文件选择期间新编辑保护、三维相机与保存重开浏览器回归通过；完整原生组合待补 |
| E16 | 部分 | GLB URL 失效、保留节点和修改地址重试通过；本地路径重定位未签收 |
| E17 | 浏览器通过 | 浮动位置、可见性、重启与重置的本机布局回归 |
| E18 | 部分 | 恢复/舍弃与缓存保护浏览器/文件层通过；真实 Tauri 二维属性/三维 GLB 强制退出、重启恢复、原生保存清理通过；系统文件选择、125% 与完整本地资源组合待补 |
| E19 | 部分 | IME/表内输入/地图 Esc/窗口手势取消通过；所有三维工具完整焦点矩阵待补 |
| E20 | 待实现 | 引擎实际指标诊断与空闲状态 |

## M8 Tileset 裁剪、局部压平与工具审计（2026-10-15）

- `TilesetNode.effects` 已支持原生多边形裁剪和局部压平，两类效果按目标 Tileset 隔离，支持多范围、坐标编辑、重绘、启停、删除、Undo/Redo 和项目保存重开。
- 压平使用局部 ENU 高程遮罩和 `CustomShader`，支持不同目标椭球高程、模型变换、5 km 范围限制、2048 内部纹理上限及实际 GPU 上限；宿主已有 Shader 时显式拒绝覆盖。
- 真实示例 Tileset 的三项场景在 1440×900、1024×680、1366×768、1920×1080 共 12 项 E2E 通过，包含两个分别平移 -180 m / +180 m 的实例隔离。
- Tauri/WebView2 在 `ANGLE (NVIDIA GeForce RTX 5070, Direct3D 11)` 物理 GPU 上通过压平、相机缩放、LOD 16→4、关闭恢复和原生保存。报告及截图：`native-tileset-flatten-report.json`、`native-tileset-flattened.png`。
- 对照 `cesium-demo` 后，裁剪/压平绘制改为优先深度拾取并回退地表，Gizmo 补齐 XY/XZ/YZ 平面。沿用独立会话、Esc 回滚、相机输入恢复、项目历史和销毁生命周期，不复制 demo 的全局清理及私有字段访问。
- 新增 `@desktop-webgis/cesium-measure`，实现空间距离、贴地距离、局部 ENU 水平面积及带正负号高度差；贴地路径有地形时使用 Cesium 真实地形采样，并以 30 m 加密、4096 点上限控制交互成本。
- 测量结果先进入运行时临时 GraphicLayer，不写项目；“保留测量”后才作为独立 Graphic 进入历史与持久化。四种测量在 1440×900、1024×680、1366×768、1920×1080 四视口 E2E 全部通过，包含清除、保留、Undo/Redo 和保存断言。报告及截图：`browser-scene3d-measurement-report.json`、`browser-scene3d-measurement-transient.png`、`browser-scene3d-measurement-retained.png`。
- M8 功能实现已闭环；E08 已补齐 GLB 与 Tileset 的真实指针拖动浏览器验收，见 `evidence/browser-scene3d-gizmo-pointer-report.json`。移动操纵柄放在对象包围中心并伸出对象范围，避免被地理锚点附近的地面及模型遮挡。

## M6 批次：持久资源引用与项目路径（2026-10-14）

- 新增 `ResourceReference` 与语义校验，旧 URL 契约继续兼容。模型、Tileset、三维 GeoJSON 的本地身份贯穿旧场景迁移、v3 文档、Desktop 桥和运行时投影，不把引用丢弃或写成页面相对 URL。
- 原生项目打开时固定工作引用的绝对位置，保存/另存只重算磁盘副本；目录内相对引用、目录外/跨盘绝对引用，保留 ID、编辑状态与历史。另存对话框之前捕获来源路径，切换项目不会重定向旧快照资源。
- 单测覆盖 Windows/UNC/中文及字面 `%/#` 路径、越界/ADS 拒绝、跨盘与同目录另存、保存重开、未改动原对象、临时授权 URL 拒绝和对话框竞态。全仓构建/单测及最终 Desktop 构建通过，Desktop 268 项通过、5 项既有环境项跳过；laptop 全量 E2E 60 项通过（4.2 分钟）。
- 本批未连接本地引用到产品目录授权与加载生命周期，未签收本地 GLTF/Tileset 的真实渲染、另存重开和父目录重定位，M6/E16 仍为部分完成。详细边界见 [本地资源协议](../engineering/local-resource-protocol.md)。
- 用户新增的通用 Scene 公开 API 命名要求已独立提交 `f006b33`；后续实现保留旧导出兼容，不能以目录改名代替迁移验证。

## M6/M7 批次：本地引用运行时与原生恢复（2026-10-14）

- Cesium 文档运行时新增宿主引用解析回调，仅在渲染副本使用临时协议 URL，原始文档/项目/草稿保持路径身份；异步解析取消、更新序号与既有准备替换保证过期内容不发布。
- Desktop 挂载会话复用项目目录授权、拒绝未授权的外部目录，销毁时撤销全部授权，包含稍后返回的授权。三维工作区按项目 epoch 隔离，重新打开同 ID 项目也不复用旧会话。
- 恢复副本保留资源基准但仍无正式保存路径，项目切换后基准失效；正式文件与草稿比较识别磁盘相对引用和工作绝对引用的等价。
- 原生 Tauri/WebView2 实测本地 Unicode/空格/`#/%` GLB 引用、相对路径正式保存、强制退出、草稿恢复、模型显隐像素与再次原生保存。报告/截图见 [本地引用原生证据](../design/desktop-productization/evidence/native-local-reference-report.json)，正常 debug 配置已恢复，自有测试进程已结束。
- 全仓构建/单测通过，Desktop 271 项通过、5 项既有环境项跳过；laptop 浏览器 E2E 60 项通过。原生文件选择器、正式重开/跨目录另存、GLTF/Tileset/GeoJSON 本地渲染组合、显式外部目录授权 UI、父目录重定位仍待签收，M6/E16 保持部分完成。

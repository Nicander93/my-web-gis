# Desktop 产品化实施记录

执行依据：[2026-10-13 交付包](../design/desktop-productization/webgis-agent-delivery/README.md)。包内 HTML 和截图是交互参考，不能作为 GIS 或 GPU 算法验收证据。

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
| M3 | 模型/Tileset 选择、整体 Gizmo、专业 Inspector、旧 CityScene 兼容；已接入嵌套 Folder | 文件夹/对象混排；固定 ID 的独立 Apply/OK/Cancel 属性窗；检查器固定 |
| M4 | 分页、搜索、过滤、统计、属性单元格、处理算法/取消；新增多图层 Tab、表内原子字段计算、字段类型校验与列显示/排序 | 字段新增/重命名/删除管理、面合并属性策略及完整空间运算验收 |
| M5 | point/polyline/polygon Graphic、几何编辑、对象独立样式 | 共享 Graphic 渲染池、连续 POI、Billboard/Label/rectangle/ellipse 等及 500 对象验收 |
| M6 | 本地二维文件、WMS/WMTS/WFS、三维资源加载、失败重试 | 二三维添加数据壳、基于项目路径的资源引用/另存重算、父目录重定位 |
| M7 | 项目保存/另存/脏状态保护 | 原子保存、保存期间编辑/换项目竞态、恢复草稿缓存和恢复/舍弃流程 |
| M8 | 独立 cesium-tileset-edit Gizmo 与可用样例模型 | Tileset 独立裁剪、坐标正确的局部压平、多变换/LOD/GPU 清理；基础测量 |
| M9 | 本阶段窗口 E2E 与已有真实 GIS E2E | 真实指标诊断、任务日志、全量 20 项矩阵、原生和 GPU 综合验收 |

本记录不表示 M0–M9 全量完成，也不表示压平/恢复草稿已经实现。M8 未实施前不得给它标记“GPU 验收通过”。现有样例 `examples/city-3d/city-sample` 可用，但不能代替两套空间变换不同、含 LOD 的完整效果测试。

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

## M4 属性表与字段计算批次

- 一个属性表窗口可打开多个图层 Tab。关闭当前 Tab 自动选择相邻项；删除图层会清理对应项。Tab 按图层 ID 绑定，浏览场景树不改变表格目标。
- 各表组件保留未应用的过滤草稿和计算草稿，搜索、分页、排序、统计字段、列隐藏/顺序、双向滚动保存在图层会话中。关闭窗口与专注模式不卸载这些组件。窗口重新打开和 Tab 切换已有实际交互测试。
- 表内字段计算可选择全部记录、图层过滤后或选中记录。表内文本搜索不改变计算范围。仅当前编辑目标的本地矢量图层可写入，文件夹锁与只读服务仍生效。
- 使用现有安全表达式编译器，在提交前计算并校验全部目标行。字段名、引用字段、有限数值、布尔/文本/JSON 类型与非空约束有检查；失败不会写入任何字段或记录。部分范围新增字段时其余行填 null，非空约束不允许这种部分计算。
- `SetDatasetContentCommand` 在同一历史项中提交字段定义与记录，保持 Feature ID 和几何。Undo/Redo 同时恢复 schema 和属性，不清空表格会话。处理工具箱的字段计算继续生成新的结果层。
- 单元格编辑按照字段定义解析，文本字段保留前导零，非法类型显示错误并保留原值。列显示调整是会话设置，不写入项目历史。
- 过滤、统计、计算器和字段列表互斥展开，保留草稿但给表格数据行留下空间。字段新增/重命名/删除管理与面合并策略尚待下一批，未将 M4 整体标为完成。

验证：全仓 `rtk pnpm build` 与 `rtk pnpm test` 通过，Desktop 221 通过、5 个原有环境项跳过。新增计算/Tab 回归与专注模式会话恢复在 1440×900、1366×768、1920×1080 三个尺寸共 6 项通过。旧会话 E2E 的选择器更新为当前可见 Tab，保留原来的数据、滚动和草稿断言。最终源码的全量 Desktop 主尺寸回归 45 项全部通过。[1366×768 字段显示与计算结果](../design/desktop-productization/evidence/laptop-table-fields.png)。

## 20 项验收矩阵的当前证据

“部分”表示已有自动化覆盖部分行为，不等于该条完整签收。

| ID | 当前状态 | 证据/未完成项 |
|---|---|---|
| E01 | 部分 | 真实 GeoJSON、CSV、SHP、DXF 导入 E2E 通过；本方案完整多图层配置闭环待签收 |
| E02 | 部分 | 绘制、取消、Undo/Redo E2E 通过；多要素顶点编辑完整矩阵待补 |
| E03 | 待实现 | 面合并的原图层原子命令及属性策略 |
| E04 | 部分 | 表格选择/定位/键盘/单元格编辑已有回归；已加入多 Tab 独立草稿、搜索和滚动会话；完整字段管理仍待补 |
| E05 | 浏览器通过 | 表内字段计算原子写入原数据；逐行错误、类型、空值约束提前校验；一个 Undo/Redo 恢复字段定义与记录 |
| E06 | 部分 | 真实缓冲结果层及处理算法单测通过；四组空间处理专项矩阵待补 |
| E07 | 部分 | 国内地图投影、导出 CRS、历史一致性通过；源 CRS 赋值工作流待接入 |
| E08 | 部分 | 实际 GLB 像素、变换、撤销、导出、资源重试通过；Tileset Gizmo 原生签收待补 |
| E09 | 待实现 | 连续 POI 放置与 Esc |
| E10 | 待实现 | 500 Graphic 共享渲染池及批量编辑 |
| E11 | 待实现 | 目标 Tileset 独立裁剪与恢复 |
| E12 | 待实现 | 正确坐标/高度/LOD 的局部压平及 GPU 清理 |
| E13 | 浏览器通过 | `docking.e2e.ts` 验证画布不变、整宽属性表 |
| E14 | 待实现 | 固定对象 ID 的非模态完整属性窗口 |
| E15 | 部分 | 导入场景草稿/项目替换保护回归通过；新建/打开完整原生组合待补 |
| E16 | 部分 | GLB URL 失效、保留节点和修改地址重试通过；本地路径重定位未签收 |
| E17 | 浏览器通过 | 浮动位置、可见性、重启与重置的本机布局回归 |
| E18 | 待实现 | 崩溃恢复草稿 |
| E19 | 部分 | IME/表内输入/地图 Esc/窗口手势取消通过；所有三维工具完整焦点矩阵待补 |
| E20 | 待实现 | 引擎实际指标诊断与空闲状态 |

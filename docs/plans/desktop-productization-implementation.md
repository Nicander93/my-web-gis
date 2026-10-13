# Desktop 产品化实施记录

执行依据：[2026-10-13 交付包](../design/desktop-productization/webgis-agent-delivery/README.md)。包内 HTML 和截图是交互参考，不能作为 GIS 或 GPU 算法验收证据。

## 基线与边界

- 2026-10-13 fetch 后，`origin/main` 为 `015774120577546514baadd30cc22b1c79d9dbe4`。
- 原工作分支 HEAD 为 `6f79c708c2e5aab61343790bb698e8d53348b639`，与该 main 的文件内容一致。
- 实施分支：`codex/desktop-productization-v1`，从上述 main 创建。
- 开始时 `apps/desktop/src-tauri/Cargo.toml` 已被修改；本阶段保留，不纳入提交。
- 继续使用 React / Zustand / Tauri / OpenLayers / Cesium；二维、三维项目保持独立。
- 未修改 ProjectSnapshot、CityScene v1/v2、SceneDocument v3 的序列化格式。

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

| 阶段 | 已有可保留能力 | 本方案仍需实现/签收 |
|---|---|---|
| M0 | 构建/单测/E2E 基线；旧项目和公开 SceneDocument 转换测试 | 原生截图、完整依赖/能力审计仍须随阶段补齐 |
| M1 | 首批三行 Shell、两引擎覆盖式窗口、布局恢复 | 全局工具会话协调；工具箱/日志/诊断独立窗口随后续阶段接入 |
| M2 | 点线面编辑、捕捉、选择、CRS/导出 | 任意深度二维 Folder、明确 CRS 赋值工作流及复杂拓扑编辑 |
| M3 | 模型/Tileset 选择、整体 Gizmo、专业 Inspector、旧 CityScene 兼容 | 嵌套三维 Folder；固定 ID 的独立 Apply/OK/Cancel 属性窗；检查器固定 |
| M4 | 分页、搜索、过滤、统计、属性单元格、处理算法/取消 | 多数据集 Tab、表内原子字段计算器、面合并属性策略 |
| M5 | point/polyline/polygon Graphic、几何编辑、对象独立样式 | 共享 Graphic 渲染池、连续 POI、Billboard/Label/rectangle/ellipse 等及 500 对象验收 |
| M6 | 本地二维文件、WMS/WMTS/WFS、三维资源加载、失败重试 | 二三维添加数据壳、基于项目路径的资源引用/另存重算、父目录重定位 |
| M7 | 项目保存/另存/脏状态保护 | 原子保存、保存期间编辑/换项目竞态、恢复草稿缓存和恢复/舍弃流程 |
| M8 | 独立 cesium-tileset-edit Gizmo 与可用样例模型 | Tileset 独立裁剪、坐标正确的局部压平、多变换/LOD/GPU 清理；基础测量 |
| M9 | 本阶段窗口 E2E 与已有真实 GIS E2E | 真实指标诊断、任务日志、全量 20 项矩阵、原生和 GPU 综合验收 |

本记录不表示 M0–M9 全量完成，也不表示压平/恢复草稿已经实现。M8 未实施前不得给它标记“GPU 验收通过”。现有样例 `examples/city-3d/city-sample` 可用，但不能代替两套空间变换不同、含 LOD 的完整效果测试。

## 验证记录

本阶段测试结果和截图在完成后补充。原生 Tauri 文件选择/保存、Windows 125% 缩放及物理 GPU 压平不由浏览器矩形测试签收。

# my-web-gis · 三维场景编辑器技术设计 V1

> 状态：**设计收敛稿，尚未实施**  
> 形成日期：2026-10-23  
> 仓库：[`Nicander93/my-web-gis`](https://github.com/Nicander93/my-web-gis)  
> 核验基线：`main@619fb3ca3b0b5aab94f7095d35595acc8509811e`（2026-10-23 08:30 +08:00）  
> 审查方式：读取主分支关键源码、文档、测试入口；**未在本轮拉起应用或执行自动化测试**。下文“已有”指源码中可确认的实现入口，不代表完成本轮运行验收。

## 0. 决策摘要

1. **产品定位**：三维是 CesiumJS 场景编辑器；二维是 GIS 制图及数据工作台。统一桌面工作体验，**不统一两者业务模型、符号标准和数据编辑能力**。
2. **以既有代码增量演进**：不新建第二套三维场景系统、不重构 Cesium Runtime 包边界、不复制新的 SceneDocument/Undo 系统。
3. **产品体验统一**：复用 Desktop 的 Header/WorkbenchRibbon、DockWindow、PropertyWindow/PropertyFields、Design Tokens、Ant Design 与快捷键策略。三维 UI 延续紧凑、克制、地图优先的视觉密度。
4. **场景树**：管理可选择的业务对象、分组和资源；**不设置“场景基础”专属分组**。地形、底图可从场景设置访问，不伪造具有通用编辑语义的普通图层。
5. **属性检查器**：原生 Cesium API 名称为主，按功能折叠，支持中英文检索；通用参数用 Schema 渲染，复杂项用专用编辑器。仅公开、在锁定 Cesium 版本下验证的 API 才显示为可编辑。
6. **数据编辑**：保留既有三维点线面/标绘与 GLB/3D Tiles 整体变换能力；3D Tiles 源网格不做破坏性修改，裁剪、压平、样式等只保存项目配置。
7. **工程与资源**：保留现有 ProjectSnapshot 和 v3 SceneDocument 投影架构；工程只保存外部资源引用，不新增资源打包工作流；已存在的独立归档能力不要求本轮删除。
8. **复用出口**：项目保存、场景 JSON 与原生 CesiumJS 代码导出分开设计；代码导出不能隐式依赖自研 SDK，未覆盖能力必须显式报告。

## 1. 当前代码审查：已有与缺口

| 领域 | 已确认的当前实现 | V1 目标 / 注意事项 |
|---|---|---|
| 桌面基础 | React 19、Ant Design 6.6.6、Zustand、Tauri 2；`DesktopUiProvider` 消费 `tokens.css` | 不引入 lil-gui、Tweakpane、Leva，不单独搭建三维 UI 主题 |
| 工作台 | 二维 `Workspace.tsx`、三维 `SceneWorkspace.tsx`；双方已有 `LeftPanel`/`RightPanel`/`BottomPanel` 复用与 Ribbon | 保留独立业务视图，但统一窗口布局、工具栏密度、右侧入口和状态反馈 |
| 二维 UX 重构 | `docs/design/desktop-design-system-v1.md`、`PropertyWindow`、`DockWindow`、右侧工作工具栏、固定目标与属性草稿 | 作为三维 UX 基准，不倒退成原型式大卡片和长表单 |
| 场景管理 | `SceneTree`：分组、拖拽排序、多选、显隐、锁定、右键与加载状态 | 复用现有对象树，无需另建 Layer/SceneItem 通用框架 |
| 场景属性 | `SceneInspector`：基本属性、质量、Transform、裁剪、压平、标绘、Popup；`ScenePropertyWindow`：草稿/应用/预览 | 增加 API 参数描述与专业样式入口，复用现有 PropertyWindow；保留固定目标、冲突保护 |
| 几何与空间编辑 | `useSceneDrawing`、`useSceneGraphicEditing`、Cesium layer Draw/Edit sessions、TilesetEditor Gizmo | 不重写。关注工具互斥、可撤销提交、草稿退出与真实地理坐标精度 |
| 场景协议 | `project.city` 的 `CesiumScene` v2；`scene-schema` 的 SceneDocument v3 以及项目投影适配 | **不要并行发明新的场景 JSON 结构**；新字段必须设计迁移和 schema/投影映射 |
| 运行时 | `cesium-scene-runtime` 支持文档投影、更新、异步资源恢复、预览与诊断 | 扩展既有 Adapter；不要在 React 组件散写 Cesium setter |
| 3D Tiles | `TilesetLayer` 有加载、显隐、质量/缓存、整体 Transform；Effects 包有裁剪与压平 | 当前 `TilesetNode` 只有部分配置字段；**缺少正式持久化原生 3D Tiles Style/条件规则和高覆盖参数 Schema** |
| 样式和导出 | 现有场景 `.scene.json` 导出、所选对象导出；`scene-codegen` 当前面向 **OpenLayers** | **Cesium 原生代码生成不是现成的已完成能力**，需独立落地并验证；不要把场景 JSON 导出混同于原生 JS 代码导出 |
| 资源路径 | `local-resource-session`、`project-resource-references`、资源重定位、原生本地资源桥接 | 引用模式已经有基础，覆盖目录权限、Tileset 子 URI、迁移后的可重定位性 |
| 撤销历史 | `updateScene()` 通过既有 `SetCesiumSceneCommand` 接入 `project.store` | 优先扩展手势合并/草稿提交策略，**不引入第二个三维 History 系统** |

### 1.1 对之前设计讨论的修正

- **取消**“新建 `SceneDocument` 作为唯一权威状态”的独立实施计划。当前 Desktop 以 `ProjectSnapshot.project.city` 维护编辑数据，使用 `createProjectSceneProjection()` 生成 v3 文档供 Runtime 消费。可逐步调整权威模型，但只能作为后续单独迁移项目，不能在场景编辑器 V1 中顺手替换。
- **取消**“三维右侧 Inspector 默认强制展开”的建议。尊重当前 Workspace 持久化偏好，默认左开右关；用户显式打开属性/样式时才展开右面板，选择对象不强制弹出。
- **取消**为了模仿 V2 HTML 原型而引入另一套浮动/扩展面板。优先复用现有 `PropertyWindow`（非模态、固定对象、草稿、校验、应用/取消）。
- **纠正**参数层的事实判断：`apps/desktop/package.json` 声明 `cesium: ^1.145.0`，真实安装版须由 `pnpm-lock.yaml` 锁定结果确认。以前整理的 1.146 参数候选表**不能直接当作仓库可用 API 或已支持覆盖率**。

## 2. 产品工作区与交互统一规范

### 2.1 框架保持一致

```text
Desktop Application（公用）
├─ WindowBar / MenuBar / Project Identity / Dirty
├─ Workbench Ribbon（共用外壳、命令各自实现）
├─ Workspace（共用 Dock / Panel 容器）
│  ├─ Left: 2D Layer Tree  /  3D Scene Tree
│  ├─ Center: OpenLayers   /  Cesium
│  ├─ Right: Context Inspector / Scene settings
│  ├─ Bottom: Attribute Table / Task & Diagnostics（有需求时）
│  └─ Workrail: 显式切换右侧任务
└─ Status Bar / Feedback
```

2D 与 3D 不强制使用相同 Ribbon 功能分类，但**标题栏、按钮尺寸、工具禁用提示、快捷键冲突保护、窗口折叠和恢复行为一致**。

### 2.2 三维交互规则

- 场景树沿用当前的文件夹、多选、可见、锁定、重命名、资源故障状态和对象右键菜单。
- 单击选择只改变对象选择态及可用命令；显式执行“属性”“样式”“场景设置”才打开 Inspector。
- 左侧“场景对象”按内容呈现；没有“场景基础”分组。`terrain` / `basemap` 保留为场景环境配置，不硬塞到可任意排序的对象列表。未来若支持多个地形源，单独做“来源切换”，不能假装存在多地形叠加。
- 区分**当前选择、编辑目标、固定属性目标**。避免用户浏览别的对象时误写正在编辑的对象；适当复用现有 pinned 机制。
- 右侧第一层：对象 / 场景；第二层（对象）：配置、样式、属性、源；诊断作为按需的只读视图。复杂项由“完整属性”或专用编辑器承载；避免横向挤压地图。
- 默认使用现有尺寸 Token：UI 字号 12px、控件 28px、参数行 28–32px；右侧宽度随当前 Workspace 260–420px 限制。需要宽界面时使用可移动非模态完整属性窗，不重新写一套窗口系统。
- **英文 API 名称优先**，如 `maximumScreenSpaceError`、`cacheBytes`；中文功能组和帮助描述；参数检索匹配 API、别名及描述。
- 状态栏用于“正在编辑、已提交、加载失败、需重建”反馈；正常滑块操作不频繁 Toast。
- 预览模式保留已实现的关闭工具与面板、恢复布局逻辑；不强制把预览模式和编辑器草稿混为一个状态。

## 3. 能力边界

| 对象 | 既有基础 | 本轮拟补齐 | 明确不做 |
|---|---|---|---|
| 3D Tiles | 资源引用、定位、整体变换、LOD/cache、裁剪、压平、要素拾取 | 原生 style/属性条件规则、更多稳定 API、参数复位、兼容提示、导出 | 网格修改、瓦片重写、任意构件逐个持久化修改（需稳定标识验证） |
| GLB/Model | 模型加载、移动旋转缩放、精确位置 | 原生 Model 常用公开参数描述与参数编辑 | 模型网格/贴图制作 |
| Graphic | 点线面/矩形椭圆、Billboard、顶点编辑、字段和样式 | 复用更一致的属性编辑控件、复杂参数入口 | 完整 CAD 建模功能 |
| GeoJSON | 载入、颜色、拾取属性 | 合理扩展其可配置外观；需要几何回写时单独定义模式 | 默认将外部海量矢量全部转成可编辑 Graphic |
| Imagery | XYZ 影像显示与 opacity | 亮度/对比度等 Cesium 公开属性（依运行机制分组） | 影像像素重采样、影像数据加工 |
| Terrain | 来源和场景影响配置 | 相关可配置参数完整化，明确 Globe/Provider 边界 | 多地形任意叠加或源网格修改 |
| Scene/Camera | 摄像机保存、光照时间、雾/辉光、质量偏好 | 公开参数分组、参数解释与可复用配置导出 | 自定义渲染引擎 |

设计不按“对象一个个重做”，而按**参数配置、空间交互、样式编辑、运行时诊断**四类机制实现。对不同对象做能力声明/校验。

## 4. Parameter Schema：薄适配而不是第二套 Cesium

### 4.1 建议的描述契约（示意）

```ts
interface ParameterDescriptor<T = unknown> {
  id: string;                         // e.g. 'tileset.maximumScreenSpaceError'
  owner: 'tileset' | 'model' | 'imagery' | 'globe' | 'scene' | 'camera';
  apiName: string;                    // 原生名称，不另造映射词典
  group: string;                      // UI 分组
  kind: 'boolean' | 'number' | 'enum' | 'color' | 'vector' | 'json' | 'custom';
  lifecycle: 'runtime' | 'recreate' | 'readonly' | 'action';
  editor?: string;                    // 专用组件注册名
  supportedSince?: string;
  validate(value: unknown): value is T;
  // 具体序列化/适用条件/Runtime 应用在 Adapter 定义中显式配置。
}
```

**Schema 仅负责描述、校验和驱动 UI**，绝不自动对任意 Cesium 原生对象执行 `obj[key] = value`。Runtime Adapter 负责类型转换、重建生命周期、错误报告和回滚。

先手工完成 `Cesium3DTileset` 的小规模端到端验证，再扩展到 Imagery、Model、Scene。复杂样式/矩阵/裁剪仍使用既有专用编辑会话。

### 4.2 参数状态四分法

- **运行时可改**：直接调用现有 Runtime Adapter，成功后提交工程配置。
- **创建时确定**：Inspector 标明“需重新加载”，编辑草稿批量应用；加载失败保留上次成功运行实例和错误提示。
- **只读诊断**：如 BoundingSphere、瓦片/内存统计，不进入项目 JSON 和 Undo。
- **方法/事件**：如缓存清理、加载进度；呈现为动作或诊断，而非持久化配置。

### 4.3 参数覆盖追踪

锁定**pnpm 实际解析的 CesiumJS 版本**。逐项记录：API 可用性、配置域、类型、默认值来源、UI 控件、适用对象、应用方式、保存与导出、是否已通过测试。参数总量统计仅包含目标版本公开可配置项，不能混入只读/事件凑“覆盖率”。

## 5. 3D Tiles 样式与选择

- 使用 Cesium 原生 `Cesium3DTileStyle` JSON 为语义权威，支持基础色、属性条件规则与原生 JSON 编辑模式。
- 场景工程存**可序列化的 Style 定义**，而非 Cesium 实例；不与二维 MapLibre / SLD 共用样式 AST。
- 简单条件可以表单化；复杂表达式直接写原生表达式。视觉模式不认识的合法配置必须保留，不做破坏性降级。
- 按条件着色前必须读取当前数据实际提供的 Feature 元数据；数据无稳定要素属性时，给予清晰提示。
- **选择高亮与持久样式分离**：现有 `TilesetLayer.setHighlighted()` 会临时替换 `tileset.style`。引入持久样式后必须保障样式修改、选择切换、瓦片加载以及取消高亮不会错误恢复过期的旧 style。
- 原生 `Style JSON` 编辑采用 草稿 → 校验 → 预览 → 应用/取消；非法 JSON 或失败执行不覆盖最近成功生效的样式。

## 6. 工程保存与资源引用

### 6.1 保留当前权威链

```text
Desktop ProjectSnapshot（已保存工程的业务权威）
  └─ project.city: CesiumScene v2（编辑器当前三维数据）
        ├─ Scene Commands / EditHistory
        └─ createProjectSceneProjection(snapshot)
              └─ SceneDocument v3（运行时/跨消费者投影）
                    └─ createCesiumDocumentRuntime()
                          └─ Cesium Viewer / Layers / Graphics
```

新增参数先明确其最终工程归属。需要延伸 `CesiumScene` 时，提供解析、验证、迁移及 v3 投影映射，不让 UI 直接修改 v3 投影结果。任何全面以 v3 作为唯一工程真源的工作另立迁移设计和回归范围。

### 6.2 引用模式 A（已确定）

- 不复制 3D Tiles、GLB、GeoJSON、影像、地形等外部资源到项目工程。
- 本地路径在保存时按项目位置进行相对化；通过已有 `local-resource-session` 与资源重定位实现加载。
- 3D Tiles 子瓦片 URI 必须相对其自身引用文件正确解析；不能只加载 `tileset.json` 即声称支持本地 Tileset。
- 不将访问 Token 或密钥存入工程；已有外部凭据注入机制继续保留。
- 用户自己绘制的 Graphic 几何、样式与小规模必要元数据是工程内容，不算打包外部文件。
- 仓库当前存在场景归档相关服务。**本轮不新增资源打包功能，但不为了选择 A 删除已有兼容代码**。

## 7. 编辑事务、Undo/Redo、生命周期

- 保留 `project.store` + `SetCesiumSceneCommand`；不新建单独 `SceneEditManager` 和历史堆栈。
- **离散操作**（开关/选择器/分组/添加删除）：成功后一次 Command。
- **连续编辑**（Slider、拖动 Gizmo、节点移动）：运行时临时预览；鼠标释放/完成时提交**一条历史**。取消、失焦异常和工程切换撤销临时状态。
- **完整属性窗**：复用现有草稿、固定对象、工程 epoch、原值冲突检查和“重新载入”，`applyScenePropertyDraft` 负责原子更新。
- **异步创建/重建**：不得因为后续失败而让项目参数和已显示对象不一致；用当前 `createCesiumDocumentRuntime` 的候选资源准备及成功替换机制，不承诺其无法保证的任意 setter 完整回滚。
- 工程保存只更改 dirty baseline，不清空 History；窗口位置/大小、临时拾取、诊断指标、仅本机性能偏好不进入工程或历史。
- 特别关注现有 `SceneRenderSettings` 在 Zustand 本地 persist，而不是工程配置：**设备质量偏好（DPI/MSAA）与想导出复现的场景视觉参数必须分清**。需要复用的视觉参数应进入项目文档；设备特定选项默认不导出。

## 8. 开发复用与导出

**现状**：已经具备完整场景/所选对象 `.scene.json` 输出；`packages/scene-codegen` 当前实现是 `generateOpenLayersModule`，遇到 `scene.city` 明确拒绝。这不是 Cesium 原生代码导出的已实现证据。

**目标**：

1. **Project JSON**：继续编辑的桌面工程，用现有保存命令。
2. **Scene JSON**：引用资源、可供现有 Scene Consumer/Viewer 恢复的配置，用当前协议，新增能力必须接通该消费者。
3. **Native CesiumJS 代码**：新增功能，显式生成合法的 Cesium 初始化/对象赋值表达式。颜色、矩阵、样式与枚举用对应构造器生成，不隐式依赖本项目 SDK。未支持能力必须报告并可选择阻止导出，不能静默遗漏。

本轮不承诺浏览器/显卡/版本之间的像素级一致；导出必须标记 Cesium 目标版本、资源不可达风险和运行时凭据依赖。

## 9. 建议实施路径（逐步交付、每步可回退）

| 阶段 | 工作 | 可验收结果 | 应避免 |
|---|---|---|---|
| P0 代码审计与 UI 对齐 | 对照最新二维 Design Tokens、Dock、PropertyWindow 与 SceneWorkspace；确认当前 Cesium 锁版本与 Schema gaps | 提交差异表、无功能回归 | 重写三维 Workspace/统一二三维 MapEngine |
| P1 三维体验统一 | 属性/场景入口、右侧工作栏、紧凑参数行、提示、搜索与固定目标统一；复用现有 Window | 2D/3D 在相同分辨率下交互一致，编辑对象不误写 | 引入第二套 UI 库 / 第二套面板 |
| P2 3D Tiles 原生样式闭环 | `TilesetNode` 版本化新增 Style 定义、运行时应用、JSON/可视规则编辑、选择高亮并存 | 设置 → 预览 → 保存 → 重开 → 撤销/重做 → Viewer 还原 | 单构件颜色强行持久化 |
| P3 参数 Schema 试点 | 先补 Tileset 可写公开参数，支持 runtime/recreate/readonly/action，再分批应用到 Imagery/Model/Scene | 参数覆盖表有独立代码测试与 UI 证据；未支持项明示 | 一口气自动暴露全部属性 |
| P4 编辑与导出一致性 | 扩展已存在的空间编辑/画质参数保存边界，并新增原生 CesiumJS 代码导出 | 3D Tiles + GLB + Graphic + 场景环境的配置、场景 JSON 和 JS 输出往返测试 | 另起 SceneDocument 协议、资源全量打包 |
| P5 产品验收 | 真实倾斜摄影、模型、影像、地形，Windows/Tauri 本地引用与大数据验证 | 1440×900、1024×680；真实 GPU 与文件资源回归；缺失资源可重连 | 仅凭模拟 Canvas 或 Playwright 截图宣称 Cesium 真机已验收 |

## 10. 关键验收条款

1. **一致性**：二维和三维使用同一全局主题/字号/控件密度、窗口行为、右键操作原则、错误提示和保存/Undo 快捷键；各自 Ribbon 允许差异化。
2. **无倒退**：二维制图、图层编辑、属性表、GeoServer 发布相关既有测试不因三维修改失败。
3. **编辑安全**：被锁定、删除、切换工程或异步重建中的对象不能被过期草稿静默覆盖；撤销一次手势只需一次 Undo。
4. **资源可移植**：工程移动目录时本地相对路径可恢复或显示重定位；大 Tileset 不复制数据；无凭据泄露。
5. **样式正确**：规则条件在有元数据的 Tileset 生效；高亮不破坏持久样式；未知复杂 Style 不丢失。
6. **输出诚实**：场景 JSON 和原生 JS 明确标识支持范围，缺能力发出阻断或降级报告；生成代码可以在独立 Cesium 项目验证。
7. **测试等级**：单元测试 + 集成测试 + 浏览器 E2E + Tauri/WebView2 实际资源验收分别报告，不混淆证据。

## 11. 主要代码路径（供 Agent 落地时核验）

- 桌面设计系统：[`docs/design/desktop-design-system-v1.md`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/docs/design/desktop-design-system-v1.md)
- 当前三维工作区：[`SceneWorkspace.tsx`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/apps/desktop/src/features/scene3d/SceneWorkspace.tsx)
- 当前三维属性侧栏与完整窗：[`SceneInspector.tsx`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/apps/desktop/src/features/scene3d/SceneInspector.tsx)、[`ScenePropertyWindow.tsx`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/apps/desktop/src/features/scene3d/ScenePropertyWindow.tsx)
- 公共完整属性窗口：[`PropertyWindow.tsx`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/apps/desktop/src/components/ui/PropertyWindow.tsx)
- Scene Schema：[`cesium-scene-schema/src/index.ts`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/packages/cesium-scene-schema/src/index.ts)
- Runtime：[`cesium-scene-runtime/src/index.ts`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/packages/cesium-scene-runtime/src/index.ts)
- 项目投影适配：[`project-scene-document.ts`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/apps/desktop/src/features/scene/project-scene-document.ts)
- 当前编辑历史入口：[`scene3d-commands.ts`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/apps/desktop/src/features/scene3d/scene3d-commands.ts)
- 既有资源绑定：[`project-io.ts`](https://github.com/Nicander93/my-web-gis/blob/619fb3ca3b0b5aab94f7095d35595acc8509811e/apps/desktop/src/services/project-io.ts)

---

**实施总原则**：先让现有三维编辑器在产品体验上追平近期二维重构，再以真实 Cesium API 的可配置能力和持久化一致性为增量目标；每阶段保持二维、三维都可使用，**不因设计收敛启动大规模代码架构重写**。

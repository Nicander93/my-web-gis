# 代码分层与包边界整理计划

本文档交给执行者按阶段实施。目标是让 Desktop 的目录结构直接体现分层，新代码能按规则找到位置；同时理清 `packages/` 中哪些包可以独立发布，哪些只给本仓库使用。

本计划只调整代码位置、依赖方向和包元数据，**不改变产品行为**。地图同步、快照命令等运行路径优化另立计划，见文末“不在本计划内”。

## 已确认的决定

- 场景文档套件（`scene-schema`、`scene-core`、`scene-publisher`、`scene-codegen`、`ol-scene-runtime`、`cesium-scene-runtime`）暂时只在仓库内部使用。
- `gis-core` 改名为 `@desktop-webgis/project`，目录改为 `packages/project`。它装的是本应用的工程：工程配置、要素数据、编辑命令和历史，不是通用 GIS 库。
- 不使用“领域层”“Domain”之类的说法，目录和文档直接用职责命名。
- 删除 `packages/style-assistant`，并从 Desktop 依赖中移除。
- `stores/session.store.ts` 改名为 `view-state/layer-view.store.ts`，hook `useSessionStore` 改名为 `useLayerViewStore`。这个 store 存的是当前图层的选择集、属性表与检查器状态、地图范围，名字要和 `session/` 目录区分开。

## 执行约束

- 工作区已有未提交改动，全部保留。**不提交、不推送**，不执行 `git add`、`git mv`、`git stash`、`git reset`、`git clean`、`git checkout`，不修改 Git index。移动文件用文件系统操作。
- 根目录下的 `.codex-*.log`、`.artifacts-*.log`、`debug.log` 等不属于本任务，不动。
- `docs/archive/` 不动。分层规则见 [layers.md](layers.md)，架构总览见 [README.md](README.md)。
- 移动阶段只改文件位置和 import 路径，不顺手改逻辑、命名或格式。需要改逻辑的点集中在阶段 5 和阶段 6。
- 每个阶段结束都运行该阶段列出的验证命令。失败时先修复再进入下一阶段，并把结果如实写进本文档末尾的“执行记录”。
- 遵循 `AGENTS.md` 与 `docs/engineering/code-preferences.md`：中文沟通，注释适量，不写解释“为什么这样改”的注释。

## 目标结构：Desktop

```text
apps/desktop/src/
  shell/        外壳与整体布局：App、Workspace、SceneWorkspace、Header、面板、docking、StatusBar
  features/     各功能界面（按功能分子目录，保持现状）
  commands/     用户操作入口：一个函数对应一次完整的用户操作
  runtime/      地图与三维引擎宿主：创建引擎、把工程和数据交给引擎、收集引擎诊断
  exchange/     外部格式与外部服务：导入、导出、WFS/GeoServer、场景文档/归档、代码导出
  view-state/   界面状态：选择、属性表、检查器、工具、布局、任务记录；关掉工程即可丢弃
  session/      工程会话：当前工程配置、单一编辑历史、工程保存、数据保存与放弃、恢复草稿
  data/         要素数据运行时：Provider/Buffer 的持有者、要素订阅 hook、数据文件读写
  platform/     运行环境：Tauri 与浏览器差异、文件与对话框、凭据、HTTP、资源路径、状态消息
  ui/           通用组件与样式，不认识工程和要素
  __tests__/    跨层集成测试（保持现状）
```

`cartography-spike/`、`cartography-visual-baseline/`、`cartography-webgl/` 是独立 HTML 入口，本计划不动，依赖检查也不覆盖它们。

### 依赖方向

从上到下排列，每层只能依赖排在它下面的层：

```text
shell
features
commands
runtime
exchange
view-state
session
data
platform
```

`ui` 不在这条链上：`shell` 和 `features` 可以用它；它自己只能依赖 `view-state`（读取界面密度、字号等偏好）和 `platform`。所有层都可以依赖 `packages/` 中的包。

几条容易混淆的规则：

- `features` 可以订阅 `session`、`data`、`view-state` 的状态，但修改工程或数据要通过 `commands`。
- `session` 不认识 `view-state`。工程被替换、图层被删除后需要清理选择或属性表时，由 `session` 发出通知，`view-state` 或 `shell` 订阅后自己清理。
- `data` 不认识 `session`。数据提交后改写历史属于 `session` 的职责。
- `runtime` 不调用 `commands`，也不决定何时执行编辑；它把用户在地图上的操作交给上层回调。

### 新代码放在哪里

按顺序判断，第一个符合的就是答案：

1. 只是一个可复用的界面控件，不知道工程是什么：`ui/`。
2. 只在桌面端和浏览器端有差别，或直接调用 Tauri：`platform/`。
3. 读写要素行、Provider/Buffer：`data/`。
4. 涉及工程配置、编辑历史、工程或数据的保存与恢复：`session/`。
5. 关掉工程就可以丢弃的界面状态：`view-state/`。
6. 处理外部文件格式或外部服务：`exchange/`。
7. 创建或驱动 OpenLayers/Cesium 实例：`runtime/`。
8. 用户能触发的一次完整操作：`commands/`。
9. 某个功能的界面：`features/<功能>/`。
10. 布局、面板、菜单栏这些把功能组合起来的部分：`shell/`。

不跨层的纯计算函数放在使用它的层里；被多层用到且不依赖应用状态时，考虑放进对应的包。

## 目标结构：packages

### 可发布包与内部包

规则：**可发布包只能依赖可发布包**；内部包可以依赖任何包；任何包都不能依赖 `apps/`。是否可发布以 `package.json` 中有没有 `"private": true` 为准。

可发布（本计划只要求达到可发布状态，不执行 `npm publish`）：

- `ol-style`：已具备发布配置。
- `ol-selection`：viewer 和 `ol-runtime` 共用，已有 consumer 验证。
- `vector-io`：需要先去掉对 `scene-schema` 的依赖（阶段 6）。
- `ogc-io`：目前是 private，需要补发布配置（阶段 6）。
- Cesium 套件：`cesium-scene-schema`、`cesium-layer`、`cesium-popup`、`cesium-measure`、`cesium-effects`、`cesium-tileset-edit`、`cesium-tileset-effects`。

内部：

- `project`（原 `gis-core`）、`ol-runtime`、`spatial-analysis`。
- 场景文档套件：`scene-schema`、`scene-core`、`scene-publisher`、`scene-codegen`、`ol-scene-runtime`、`cesium-scene-runtime`。阶段 6 给它们加上 `"private": true`。

`style-assistant` 没有被源码使用，阶段 6 删除整个包。

### `project` 包的内部目录

```text
packages/project/src/
  clone.ts, id.ts   基础工具，不依赖其它文件
  data/             要素与数据集：GisFeature/Geometry/DatasetField 等类型、Provider/Buffer、
                    MemoryFeatureStore、数据集字段与校验、GeoJSON 解析、字段身份、过滤、排序、统计
  config/           工程配置：Project/Layer/Dataset 等类型、工程创建与格式迁移、图层树、样式、
                    制图、字段引用重定位、数据源能力、工程分享
  history/          编辑历史与命令：EditHistory、配置命令、三维命令、编辑目标与锁定
  index.ts          对外导出保持不变
```

依赖方向：`history → config → data → 基础工具`。`data` 不能 import `config` 或 `history`。

## 阶段 0：准备与基线

1. 阅读 `AGENTS.md`、`docs/engineering/code-preferences.md`、[架构总览](README.md)、[分层规则](layers.md) 和本文档。
2. 记录 `git status --short` 的条目数和清单（保存到 `%TEMP%`，不要放进仓库），用于最后核对只增加了本计划相关的改动。
3. 运行并记录基线结果：
   - `pnpm --filter @desktop-webgis/desktop exec tsc --noEmit`
   - `pnpm --filter @desktop-webgis/desktop test`（上次结果：571 passed / 5 skipped）
   - `pnpm -r build`
   - `pnpm -r test`
4. 基线中已经失败的项目记录下来，后续阶段只要求不新增失败。

## 阶段 1：分层文档（已完成）

`docs/architecture/layers.md`、`docs/architecture/README.md`（含架构图）、`docs/README.md`、`AGENTS.md` 的分层入口、`docs/engineering/code-preferences.md` 的指向均已就绪。本阶段无需再做。

## 阶段 2：`gis-core` 改名为 `project` 并分目录

### 2a 改名

1. 把 `packages/gis-core` 目录改名为 `packages/project`，`package.json` 的 `name` 改为 `@desktop-webgis/project`。
2. 全仓库替换 `@desktop-webgis/gis-core` 为 `@desktop-webgis/project`。范围包括 `apps/`、`packages/` 的源码与测试、`apps/desktop/tsconfig.json` 的 `paths`、`apps/desktop/vite.config.ts` 的 `resolve.alias`、`packages/ol-runtime/package.json`、`apps/desktop/package.json`，以及 e2e 文件。历史文档不替换。
3. 运行 `pnpm install --offline`（失败再去掉 `--offline`）更新 workspace 链接和 `pnpm-lock.yaml`。

### 2b 分目录

按“`project` 包的内部目录”一节移动文件：

- `data/`：`feature-provider`、`featureStore`、`dataset-schema`、`dataset-file`、`geojson`、`field-identities`、`filter`、`sort`、`stats`，以及新拆出的 `data/types.ts`。
- `config/`：`types`、`project`、`project-content`、`project-format`、`project-share`、`layer-tree`、`layer-style`、`cartography`、`field-references`、`capabilities`、`compat-city`。
- `history/`：`editHistory`、`configCommands`、`scene3dCommands`、`edit-targets`。
- `processing.ts` 暂放 `data/`，阶段 6 再决定去向。
- `clone.ts`、`id.ts`、`jsts-topology.d.ts`、`index.ts` 留在 `src/` 根目录。

为满足 `data` 不依赖 `config`，需要做两处类型调整：

- 从 `types.ts` 中把 `GisFeature`、`Geometry`、`Position` 及各几何类型、`DatasetField`、`LayerStyleKind` 移到 `data/types.ts`，`config/types.ts` 再从 `data/types.ts` re-export，保证外部 import 不变。
- `field-identities.ts` 只用到 `field-references.ts` 的 `FieldNameMap` 类型。把这个类型定义移到 `data/field-identities.ts`，`field-references.ts` 改为从那里 import 并继续导出。
- `config/types.ts` 对 `processing.ts` 的 `ProcessingRecord` 类型引用暂时保留，记为已知例外，阶段 6 处理。

`index.ts` 的导出列表不变（只改路径），`package.json` 的子路径导出（`./geojson`、`./id`、`./dataset-file`）同步改为新的 `dist` 路径，`apps/desktop/vite.config.ts` 中对应的 alias 也要更新。

验证：

- `pnpm --filter @desktop-webgis/project build` 与 `test`
- `pnpm --filter @desktop-webgis/ol-runtime build` 与 `test`
- `pnpm --filter @desktop-webgis/desktop exec tsc --noEmit` 与 `test`
- `rg "from '\.\./(config|history)/" packages/project/src/data` 没有结果

## 阶段 3：Desktop 目录迁移

只移动文件、改 import，不改逻辑。建议先在 `%TEMP%` 写一个一次性的 Node 脚本，输入“旧路径 → 新路径”映射，完成三件事：移动文件（同名测试文件一起移动）；改写 `apps/desktop/src` 与 `apps/desktop/e2e` 中所有引用，包括 `@/...` 路径、相对路径、`vi.mock(...)`、动态 `import(...)`、`new URL('./x.worker.ts', import.meta.url)`；输出改动清单。跨层引用统一写成 `@/<层>/...`，同层内保持相对路径。脚本不放进仓库。

分三批执行，每批结束跑一次验证。

### 3a 底层：`platform`、`ui`、`view-state`

`platform/`：

- `services/files.ts`、`browser-project-files.ts`、`native-http.ts`、`credentials.ts`、`resource-paths.ts`、`local-resource-session.ts`
- `app/commands/status.ts` → `platform/command-status.ts`

`ui/`：

- `components/ui/*` → `ui/*`
- `styles/*` → `ui/styles/*`（同步修改 `main.tsx` 等处的 CSS import）
- `app/header/menus/MenuItem.tsx`、`MenuSeparator.tsx`、`app/header/WorkbenchRibbon.tsx` → `ui/`（`features` 正在使用它们）
- `services/pending-property-edits.ts` → `ui/pending-property-edits.ts`（无依赖的登记表，`PropertyWindow` 使用）

`view-state/`：

- `stores/session.store.ts` → `view-state/layer-view.store.ts`，hook `useSessionStore` 改为 `useLayerViewStore`，所有引用一并替换
- `stores/` 下其余除 `project.store.ts`、`save.store.ts` 之外的 store：`workbench.store`、`workspace.store`、`docking.store`、`information.store`、`snapping.store`、`preferences.store`、`activity-panel.store`、`task-log.store`
- `app/docking/docking-layout.ts` → `view-state/docking-layout.ts`（`docking.store` 和 `ModelessWindow` 都用它）
- `services/task-log.ts`
- `features/layers/layer-filter-request.ts`、`features/inspector/property-window-request.ts`（打开窗口的请求，`commands` 会用到）

### 3b 中间：`data`、`session`

`data/`：

- `services/feature-data.ts`、`feature-data-runtime.ts`、`geojson-data-writer.ts`、`dataset-reference-load.ts`

`session/`：

- `stores/project.store.ts`、`stores/save.store.ts`
- `services/project-session.ts`、`project-edits.ts`、`project-configuration.ts`、`project-save.ts`、`project-io.ts`、`project-recovery.ts`、`recovery-cache.ts`、`recovery-tracking.ts`、`unsaved-work.ts`、`project-type.ts`、`project-resource-references.ts`、`resource-relocation.ts`、`dataset-storage.ts`、`data-save.ts`、`feature-query.ts`、`layer-configuration-query.ts`
- `features/inspector/style-interaction.ts`（样式拖动合并成一步撤销，属于历史）
- `features/inspector/scene-draft-guard.ts`

`dataset-storage.ts` 和 `data-save.ts` 需要读取工程配置中的绑定信息，所以放在 `session`，不放 `data`。

### 3c 上层：`exchange`、`runtime`、`commands`、`shell`

`exchange/`：

- `services/import.ts`、`import.worker.ts`、`import-worker.ts`、`import-parser.ts`、`service-connect.ts`、`geoserver-connections.ts`、`geoserver-transport.ts`、`wfs-load.ts`、`scene-document-io.ts`、`scene-archive-io.ts`、`scene3d-export.ts`、`cesium-code-export.ts`
- `features/scene/project-scene-document.ts`、`features/scene/compile-project.ts`

`runtime/`：

- `features/map/map-runtime-host.ts`、`features/map/map-projections.ts`
- `features/scene3d/scene3d-runtime-host.ts`
- `features/scene/project-scene-controller.ts`
- `services/diagnostics.ts`（它收集两个引擎宿主的诊断，供 `shell`、`commands`、`features` 使用）

`commands/`：

- `app/commands/*` → `commands/*`
- `services/wfs-commands.ts` → `commands/wfs.commands.ts`
- `services/processing.ts` → `commands/processing-run.ts`（它调用 `layer-content.commands` 添加结果图层）
- `features/scene/scene-document.commands.ts` → `commands/scene-document.commands.ts`

`shell/`：

- `app/*.tsx`（`App`、`Workspace`、`Header`、`LeftPanel`、`RightPanel`、`BottomPanel`、`StatusBar`）
- `app/header/*`（除去已移到 `ui/` 的三个组件）、`app/docking/*`（除去 `docking-layout.ts`）
- `features/scene3d/SceneWorkspace.tsx` → `shell/SceneWorkspace.tsx`（它组合左右下面板，和 `Workspace.tsx` 同类）

迁移完成后，`app/`、`services/`、`stores/`、`components/`、`styles/`、`features/scene/` 应该为空并删除。如有映射表没有覆盖的文件，按“新代码放在哪里”判断位置，并写进执行记录。

每批验证：

- `pnpm --filter @desktop-webgis/desktop exec tsc --noEmit`
- `pnpm --filter @desktop-webgis/desktop test`

全部完成后再跑：

- `pnpm --filter @desktop-webgis/desktop build`
- `rg "@/(app|services|stores|components|styles)/" apps/desktop` 没有结果
- e2e 冒烟：`$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE='C:\Program Files\Google\Chrome\Application\chrome.exe'; pnpm --filter @desktop-webgis/desktop exec playwright test e2e/dataset-save-discard.e2e.ts`

## 阶段 4：依赖检查脚本

新增根目录脚本 `scripts/check-architecture.mjs`，只用 Node 内置模块，不引入 ESLint 插件或 dependency-cruiser。根 `package.json` 增加 `"check:architecture": "node scripts/check-architecture.mjs"`。

脚本检查三件事：

1. **Desktop 分层**：扫描 `apps/desktop/src` 下非测试的 `.ts/.tsx` 文件，以第一级目录作为层，解析 `@/...` 和相对路径的 import，按“依赖方向”判断是否违规。`__tests__` 和 `*.test.*` 不检查。
2. **`project` 包内部方向**：`packages/project/src/data` 不能 import `config/`、`history/`；`config/` 不能 import `history/`。
3. **包依赖**：读取每个 `packages/*/package.json`，非 private 包的 `dependencies` 和 `peerDependencies` 中出现的 `@desktop-webgis/*` 必须都是非 private 包；任何包都不能依赖 `apps/` 下的应用。

已知违规写在脚本顶部的数组里，每条带一句原因，例如 `'session/project-edits.ts -> view-state/layer-view.store.ts'`。脚本发现两类问题都会失败：新的违规；已知违规列表中已经不再出现的条目（提醒删掉）。这样列表只会越来越短。

阶段 4 结束时，已知违规列表应该只包含以下几类，执行者按实际结果填写：

- `session` 依赖 `view-state`：`project-session.ts`、`project-edits.ts` 重置或清理 `layer-view.store`、`workbench.store`。
- `runtime` 依赖 `exchange`：`map-runtime-host.ts` 通过 `project-scene-document.ts` 把工程转成 SceneDocument 再交给地图。这是另立计划要解决的问题，本计划保留为例外。
- `project` 包：`config/types.ts` 引用 `data/processing.ts`。
- 场景文档套件还没标 private 之前产生的包依赖问题（阶段 6 消除）。

验证：`pnpm check:architecture` 通过。

## 阶段 5：消除 Desktop 中可以小改动解决的违规

### 5a 会话不再直接操作界面状态

`project-session.ts` 在加载工程时、`project-edits.ts` 在撤销重做或删除图层时，会直接调用 `useLayerViewStore`、`useWorkbenchStore` 清理选择、属性表和工具状态。改法：

1. 在 `session/` 中提供订阅函数，例如 `onProjectReplaced(listener)` 和 `onLayersRemoved(listener)`，在原来清理界面状态的位置改为发出通知。
2. 原来的清理代码原样移到 `view-state/` 中的一个函数里，并订阅这两个通知。订阅在应用启动时完成：在 `main.tsx` 或 `shell/App.tsx` 中 import 一次即可。
3. 清理必须保持同步执行，时序和现在一致。测试中依赖这些清理行为的用例要继续通过，必要时在测试 setup 中同样完成订阅。

完成后，从已知违规列表中删除对应条目。

### 5b 其它残留

阶段 4 的列表里如果还有其它 `features → shell`、`ui → session` 之类的问题，优先通过移动文件解决，不行再做最小的代码调整。每处改动记入执行记录。

验证：`pnpm check:architecture`、Desktop `tsc --noEmit`、Desktop `test`，以及阶段 3 的 e2e 冒烟。

## 阶段 6：包边界

### 6a 场景文档套件标为内部

给 `scene-schema`、`scene-core`、`scene-publisher`、`scene-codegen`、`ol-scene-runtime`、`cesium-scene-runtime` 的 `package.json` 加上 `"private": true`。其它字段不动，以后决定发布时再恢复。

### 6b `vector-io` 去掉对 `scene-schema` 的依赖

`vector-io` 只用到 `scene-schema` 的 `GeoJsonFeatureCollection`、`GeoJsonFeature`、`GeoJsonGeometry`、`JsonValue` 类型。在 `vector-io/src/types.ts` 中自己定义这几个类型（与 `scene-schema/src/types.ts` 中的定义结构一致），替换所有 import，并从 `package.json` 删除 `@desktop-webgis/scene-schema`。调用方依赖结构类型兼容，不需要改。

验证：`pnpm --filter @desktop-webgis/vector-io build`、`test`、`test:consumer`，以及 Desktop `tsc --noEmit`。

### 6c `ogc-io` 达到可发布状态

`exports` 已经覆盖了 `sld-export`、`sld-package`、`mbstyle-export`、`geoserver-client` 四个子路径。参照 `ol-style/package.json`：去掉 `private`，补 `files`、`sideEffects`、`description`、`license`；`ol` 等宿主依赖放进 `peerDependencies`。确认 `build` 能产出 `dist`，`pnpm pack` 成功。Desktop 现在通过 alias 直接使用 `src`，保持不变。

### 6d `project` 包去掉对 `scene-schema` 的依赖

`config/types.ts` 用到了 `scene-schema` 的 `LayerInteraction`、`SceneDocument['metadata']`、`SceneDocument` 的 `widgets/theme/presentation`、`SceneDocumentView` 中二维视图的 `extent/minZoom/maxZoom`。这些类型都不大（`scene-schema/src/types.ts` 约 298–340 行）。在 `config/` 中定义工程自己的同构类型，替换 import，并从 `packages/project/package.json` 删除 `@desktop-webgis/scene-schema`。`exchange/project-scene-document.ts` 负责在两套类型之间转换；如果结构一致，直接赋值即可。

对 `ol-style`（样式模型）和 `cesium-scene-schema`（三维工程内容）的依赖保留：工程文件本来就保存样式和三维场景。

### 6e `processing.ts` 的去向

`processing.ts` 依赖 turf 和 jsts，做的是缓冲区、叠加分析等几何处理，和 `spatial-analysis` 是同类。尝试把它移到 `spatial-analysis`，输入输出使用 `geojson` 的 Feature 类型或与 `GisFeature` 结构兼容的本地类型；`ProcessingRecord` 类型留在 `project/config`。同时把 turf 和 jsts 依赖从 `project` 移到 `spatial-analysis`。

如果移动后需要 `spatial-analysis` 依赖 `project`，或者调用方需要大量类型转换，就停止移动，保留在 `project/src/data/processing.ts`，并在执行记录中说明原因。

### 6f 删除 `style-assistant`

删除 `packages/style-assistant` 目录，从 `apps/desktop/package.json` 去掉 `@desktop-webgis/style-assistant` 依赖，运行 `pnpm install --offline`（失败再去掉 `--offline`）。仓库里如果还有 README 提到这个包，一并删掉那一行。

验证：`pnpm -r build`、`pnpm -r test`、`pnpm check:architecture`，以及 viewer 构建 `pnpm --filter @desktop-webgis/viewer build`。

## 阶段 7：收尾

1. 更新 [layers.md](layers.md) 中的包列表，标明每个包是可发布还是内部、依赖了谁；去掉“当前仍叫 gis-core”这类过时说明。
2. [架构总览](README.md) 去掉图中的“现 gis-core”标注，并把数据与编辑的代码入口改为迁移后的路径。
3. 完整验证：`pnpm -r build`、`pnpm -r test`、`pnpm check:architecture`、Desktop e2e 冒烟。
4. 对照阶段 0 记录的 `git status`，确认新增改动都属于本计划，原有的未提交改动都还在。
5. 在下面的“执行记录”中写明：每个阶段做了什么、验证结果、偏离计划的地方和原因、剩下的已知违规。

## 不在本计划内

以下问题会改变运行路径或编辑行为，另立计划处理。本计划完成后，它们在目录上会更容易定位：

- 编辑器二维地图仍经过 SceneDocument 全量同步（`runtime → exchange` 的例外就是它），每次编辑都会深拷贝全部要素。
- 快照式编辑命令把整个工程和全部要素存进历史。
- `RuntimeFeatureData` 继承全量行缓存，应改为组合，并逐步减少 35 处全量读取。
- `project-edits.ts` 同时负责执行、预检和历史改写，可以拆出历史改写模块。
- 字段重定位的复杂度，以及是否把字段结构提交作为该数据源的历史边界。

## 执行记录

基线 `git status` 567 条，保存在 `%TEMP%\layering-before.txt`。未提交改动全部保留；未执行 git add/mv/stash/reset/clean/checkout。`docs/archive/`、根目录日志未动。

基线失败已在收尾后修掉：

- Desktop `tsc`：`project-recovery.test.ts` 坐标改为 `[number, number]` 元组。
- `ol-runtime` `tsc`：`getFeatureById` 结果断言为 `Feature<Geometry>`。

### 阶段 0–1

文档在更早一轮已完成。本轮未再改阶段 1 范围。

### 阶段 2

`packages/gis-core` 改为 `packages/project`，包名 `@desktop-webgis/project`。全仓库源码/测试/alias 中的 `@desktop-webgis/gis-core` 已替换；历史文档未改。`pnpm install --offline` 更新了 lockfile。

包内按 `data/config/history` 拆分。`GisFeature`/`Geometry`/`DatasetField` 放到 `data/types.ts`；`FieldNameMap` 放到 `data/field-identities.ts`。后续删除了 `compat-city` 旧名导出；三维统一用 scene 命名。

验证：project test 当时 156 passed（含 processing）；ol-runtime test 33 passed；`data/` 生产代码不 import `config/` 或 `history/`。测试文件 `data/feature-provider.test.ts` 仍 import `history`（检查脚本跳过测试）。

### 阶段 3

Desktop 按映射表用文件系统搬迁，跨层 import 改为 `@/<层>/...`。旧目录 `app/`、`services/`、`stores/`、`components/`、`styles/`、`features/scene/` 已删除。

映射表未写、按职责补上的文件：

- `ToolbarButton.tsx` → `ui/`（`features` 在用，不能留在 `shell`）
- `map-service-requests.ts`、`geometry-edit-validation.ts` → `runtime/`（地图宿主在用）
- 若干 store 测试随对应 store 移动

CSS 与无 `from` 的 `import '...'`、e2e/scripts 字符串路径事后用一次性脚本补改。`SceneWorkspace.tsx` 迁到 `shell/` 后，`scene3d-editor.css` 仍留在 `features/scene3d/`，改为 `@/features/scene3d/scene3d-editor.css`。WFS fixture、`map-canvas-runtime.test.ts` 的运行时源码路径、若干 e2e 的 examples 相对路径一并修好。

验证：Desktop test 571 passed / 5 skipped；`rg "@/(app|services|stores|components|styles)/" apps/desktop` 无结果；`vite build` 通过。`pnpm --filter desktop build` 仍因基线 tsc 失败。e2e 冒烟见阶段 7。

### 阶段 4

新增 `scripts/check-architecture.mjs` 与根脚本 `pnpm check:architecture`。Desktop 按第一级目录分层；测试文件跳过。`runtime → exchange` 是向下依赖，不记违规。阶段 4 结束时的 session/view-state、processing 位置、场景套件 private 问题在阶段 5–6 清掉。当前 `KNOWN_VIOLATIONS` 为空。

### 阶段 5

`session/session-events.ts` 发出工程替换、图层删除、字段改名、快照应用、选择过滤通知。原清理逻辑原样迁到 `view-state/session-view-sync.ts`，`shell/App.tsx` 与 vitest `setupFiles` 加载时订阅，保持同步时序。

另外两处最小调整：`runtime/map-runtime-host.ts` 不再 import `commands/selection.commands`，选择应用改在 runtime 内完成；`exchange/geoserver-transport.ts` 凭据改为 `@/platform/credentials`。

### 阶段 6

- 场景文档 6 包加上 `"private": true`。
- `vector-io` 自建 GeoJSON 类型，去掉 `scene-schema`。test 49、build、`test:consumer` 通过。
- `ogc-io` 去掉 private，补 license/files/description；build、pack、test 53 passed / 1 skipped。
- `project` 在 `config/types.ts` 自建 `LayerInteraction`、`SceneDisplay` 等，去掉 `scene-schema`；三维内容仍用 `cesium-scene-schema`。
- `processing.ts` 迁到 `spatial-analysis`，自带 Geometry/GisFeature；`ProcessingRecord` 留在 `project/config`。turf/jsts 随迁。`spatial-analysis` 不依赖 `project`。`project/index.ts` 继续 re-export `processFeatures` 等。esbuild 加 `--main-fields=module,main`，否则 `@turf/jsts` 在 `platform=neutral` 下解析失败。spatial-analysis test 65 passed。
- 删除 `packages/style-assistant`，Desktop 依赖去掉后 `pnpm install --offline`。workspace 现 24 个项目（23 个有 test/build 脚本）。
- `ol-selection` 去掉 `"private": true`，与计划中的可发布名单一致（原本已有 files/license/peer）。

### 阶段 7

`layers.md`、`architecture/README.md`、`docs/README.md`、`data-and-editing.md` 改为现行目录和包名。源码/现行 README 里残留的 `gis-core` 字样已改；`docs/archive/` 未动。

完整验证：

- `pnpm check:architecture`：通过，已知违规 0 条。
- `pnpm -r test`：通过。project 132、spatial-analysis 65、vector-io 49、ogc-io 53+1 skipped、ol-runtime 33、Desktop 571+5 skipped；其余包均通过。
- `pnpm -r build`：在 `ol-runtime` tsc（基线）处停下。其余已构建的包通过。viewer、city-3d consumer、Desktop `vite build` 另行通过。
- e2e `dataset-save-discard.e2e.ts`：4 个视口全部通过。

`git status` 现 711 条。增量来自未用 `git mv` 造成的旧路径 `D` + 新路径 `??`，以及本计划新增的 `packages/project/`、`scripts/check-architecture.mjs`、processing 迁入文件。基线里的未跟踪项（`docs/archive/`、`docs/product/`、若干 e2e）和已有修改（如 `src-tauri/src/atomic_file.rs`）都还在。

### 偏离与剩余

- `runtime → exchange`（地图仍经 SceneDocument 全量同步）按分层方向合法，不进已知违规；产品路径未改，见文末“不在本计划内”。
- 旧工程 / SceneManifest v2 的 JSON 字段名仍是 `city`（只用于读旧格式与交换文档）；运行时与应用代码用 `scene`。`examples/city-3d`、`city-sample` 示例路径未改。
- 已知违规：无。
- 收尾补修：删除各包 `compat-city` 别名；本地 `city` 变量改为 `scene`/`isScene`；Desktop 与 ol-runtime `tsc` 现已通过。

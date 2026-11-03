# my-web-gis 架构重构实施方案 V1.0

> **用途**：交给 Coding Agent 分阶段实施。本文是重构的目标设计和验收合同，不是要求机械照抄的目录结构。
>
> **代码基线**：`Nicander93/my-web-gis`，`main`，已核对提交 `2cf4a724aadb041ac030350079851494c37802d3`（2026-10-23）。执行前先拉取仓库、核实最新 HEAD，并重新确认本文引用的代码路径与行为；如果代码有变化，以最新代码为事实，记录差异后按目标架构实施。
>
> **优先级**：架构清晰、数据安全、功能完整、性能可扩展。**不以最小改动量为目标**，但每个阶段必须可验证，禁止一次性无验收的大重写。

## 0. 给执行 Agent 的任务指令

你要重构的是现有桌面 WebGIS 的**数据与编辑架构**，不是重新设计 UI，也不是以代码搬家代替架构改造。

请先审查现有代码、测试、项目序列化格式及二维/三维交互调用链，然后依照下面的目标模型实施。允许改变旧接口、数据结构与模块边界，**但必须保留既有功能并提供旧项目迁移**。不要引入新的 `Document` 领域对象、全局 EventBus、通用 ChangeSet 框架、多个泛化的 Manager/Runtime 层。

建议按照 **阶段 0 → 阶段 1 → 阶段 2 → 阶段 3 → 阶段 4 → 阶段 5** 执行；每阶段输出修改文件、设计说明、测试证据、遗留风险。不要用“编译通过”替代交互、持久化与性能验收。除非用户另行授权，**不得自动提交、推送或覆盖用户本地改动**。

## 1. 已确认的设计决策（不得擅自推翻）

1. **一个 Project 只属于一种工作区**：`map2d` 或 `scene3d`，不允许同时持有可编辑的二三维内容；不做跨工作区联合操作或 Undo。
2. **Project 只负责工程组织与配置**：外层只有 `metadata` 和 `content`；二维或三维的具体字段封装在 `content` 下一层，不在 Project 顶层散列 `layers/city/mapState` 等字段。
3. **Project 与 ProjectStore 不同**：Project 是可序列化的领域数据；ProjectStore 是当前工程的响应式状态容器，负责受控提交、订阅和工程配置 dirty 状态，**不是所有 GIS 业务逻辑的集中处理器**。
4. **Dataset 是数据身份与来源；Layer 是表现方式**：同一 Dataset 可被多个二维 Layer 引用；Feature 属于 Dataset，不属于 Layer。
5. **考虑大规模数据**：禁止将“全部 Feature 常驻 Zustand / Project JSON / OL VectorSource”作为基础架构假设。大规模要素由 Provider 按需访问；内存仅保存需要的窗口、缓存或编辑变更。
6. **要素编辑先进入 EditBuffer**：编辑时可预览、撤销/重做，用户明确保存编辑后才写回可写数据源；编辑失败或取消不破坏原始文件。
7. **工程配置修改和要素数据编辑独立**：图层显隐、样式、顺序属于工程配置；几何、属性、新增、删除 Feature 属于数据编辑。两者的 dirty / 保存语义不同。
8. **UI 克制**：工程未保存沿用标题标识；数据编辑状态体现在图层编辑图标、编辑工具栏及结束编辑/关闭工程时的保护性确认，**不新增全局“有 N 条数据未提交”的醒目提示条**。
9. **保留 OpenLayers / Cesium 专属能力**：二维与三维各有领域逻辑和适配器；不建泛化的二三维联合 GIS 引擎。
10. **不依赖 EventBus / 完整 ChangeSet 才能实现增量更新**：优先局部状态更新、稳定 ID、结构共享、受控订阅；大型要素编辑允许用局部、类型明确的变更通知传递受影响 ID。
11. **工程配置建议使用 Zustand + Immer** 隐藏冗长的展开运算符；这是实现选择，不应让领域模型依赖 Zustand。**不把 Immer Draft、OL Feature、Cesium 对象持久化到 Project**。
12. **原有 UI / UX 形态保持**：本方案不涉及 Ribbon、工作区布局、Logo、视觉设计的重构。

### 明确不做

- 不引入“Document / MapDocument / SceneDocument”作为新的应用权威状态容器；现有 `SceneDocument` **格式/Runtime 接口**若因场景交换或兼容必需，可保留，但不得与 Project 的权威模型混淆。
- 不做跨二维/三维共享 Dataset、联合事务、联合 Undo。
- 不为了架构整齐一次性重写所有 `packages/`，不强制合并或拆分已有包。
- 不将项目配置修改也写进 Feature EditBuffer。
- 不默认修改数据时立即写磁盘，不以项目保存替代数据编辑提交。
- 不为了演示增量更新而每次扫描或序列化百万个 Feature。

## 2. 现有代码的真实情况（核对依据）

本节为基于上述 Git 提交的**已确认代码事实**，不是目标设计：

| 位置 | 当前状态 | 重构关注点 |
|---|---|---|
| `packages/gis-core/src/types.ts` | `Project` 顶层含 `id/version/name/crs/datasets/layers/groups/rootOrder/mapState/basemap/settings`，并有可选 `city`（3D）与 `cartography`；`ProjectSnapshot={project,featuresByDataset}` | 工程内容扁平；二三维边界不清；项目快照耦合全量要素 |
| `apps/desktop/src/services/project-type.ts` | 使用 `settings.workspaceType`，并根据 `city` 回退推断 3D | 工作区类型未由 Project 内容类型强约束 |
| `packages/gis-core/src/project.ts` | `createProject` 创建二维字段；`parseProjectSnapshot/serializeProjectSnapshot` 兼容快照与旧版；旧版本迁移逻辑存在 | 需显式格式升级与非破坏式迁移 |
| `apps/desktop/src/stores/project.store.ts` | 单一 Store 含 Project、`featuresByDataset`、selection、编辑命令、Undo 等；`setLayerVisible` 直接不可变更新；`setLayerStyle` 通过 `SetLayerStyleCommand` | 项目配置、运行期选择、要素数据及编辑历史耦合；写入路径不一致 |
| `packages/gis-core/src/configCommands.ts` | `SetLayerStyleCommand` 调 `replaceProject()`；`replaceLayer` 用 `...project` 和 `layers.map` | 业务命令可以保留，但不要把技术状态替换暴露为业务语义 |
| `packages/gis-core/src/featureStore.ts`、`editHistory.ts` | `MemoryFeatureStore` 复制要素；EditHistory 负责可撤销操作 | 明确与 DataProvider / EditBuffer 的职责；废止全量同步路径 |
| `project.store.ts` 的 `executeEditCommand` | 先 `syncStoreFromState(featuresByDataset)`，执行历史，再 `editedFeatures()` 并重建快照；单次样式编辑也可能经过要素复制链 | **优先切断“配置变化 → 所有 Feature 快照”的错误依赖** |
| `apps/desktop/src/features/map/MapCanvas.tsx` | 任意 `project` 或 `featuresByDataset` 引用变化都触发 `syncMapFromProject()` | 局部操作被提升为整图同步 |
| `apps/desktop/src/features/map/map-runtime-host.ts` | 由 ProjectSnapshot 生成 `SceneDocument` 再同步 OL；工具完成编辑后还存在显式同步调用 | 去除重复同步；建立项目配置同步与 Feature 变化同步两个入口 |
| `packages/ol-runtime/src/map/OlMapRuntime.ts` | `syncDocument` 复用条件依赖 `features` 数组引用；同时存在旧 `syncLayers` 路径 | 有可复用基础，但数组替换仍可能重建整层 Source；收敛真实调用方后再移除旧路径 |
| `apps/desktop/src/features/scene/project-scene-document.ts` | 扫描/映射 `featuresByDataset` 形成 `SceneDocument` | 场景交换与地图日常同步需解耦，勿每次编辑都转换全部要素 |
| `apps/desktop/src/features/scene3d/SceneWorkspace.tsx`、`scene3d-commands.ts` | 通过 `project.city` 读取/写入三维场景，并与项目快照集成 | 迁至 `project.content.kind==='scene3d'`，保留现有 Cesium 行为 |
| `apps/desktop/src/services/project-io.ts`、`project-save.ts` | 项目保存的是包括 `featuresByDataset` 的快照，包含异步保存并发防护、资源引用与凭据保护 | 分离工程配置保存与数据编辑提交；**保留**原有并发/资源/凭据/恢复安全能力 |
| `apps/desktop/src/stores/session.store.ts` | 已承载属性表视图状态、WFS 请求取消/世代信息等会话内容 | 合理保留会话类状态，不重复创建第二套全局 Session |

**已有组件不是全错**：尤其 OL 图层复用、事务命令、项目保存队列、数据源凭据分离、WFS 请求取消、原生交互与样式预览都需要尽量复用并以现有测试保护，不能为了新目录结构丢掉已有能力。

**历史文档说明**：仓库外提供的 V0.1 PRD / 技术架构文档描述较早的 Vue/Pinia、2D-first 方案，与当前 React/Zustand + Cesium 实际代码不同。它们是产品初衷与设计原则的参考，**不应覆盖当前事实**；本方案以最新代码与本轮已确认决策为准。

## 3. 目标架构

```text
                 ┌────────── UI / Commands ────────────┐
                 │                │                     │
                 ▼                ▼                     ▼
         ProjectStore       FeatureEditor          Workspace
         工程配置状态      编辑缓冲 + Undo         交互、选择、预览
                 │                │                     │
                 ▼                ▼                     │
          Project 数据      FeatureProvider               │
        metadata + content  读取/查询/持久化              │
                 │                │                     │
                 └────────────────┼─────────────────────┘
                                  ▼
                   Map/Scene 同步与 Adapter
                           │             │
                       OpenLayers      Cesium
```

此图表示**职责**，不是要求为每个框建立类、Store、Manager、接口各一份。当前 Project 属于 2D 或 3D，因此运行期仅启动该类型的编辑器与地图引擎。

### 3.1 Project：持久化工程配置

```ts
interface ProjectMetadata {
  id: string;
  name: string;
  formatVersion: number;
  description?: string;
}

type Project = {
  metadata: ProjectMetadata;
  content: MapContent | SceneContent;
};

interface MapContent {
  kind: 'map2d';
  crs: string;
  datasets: DatasetDefinition[]; // 身份、字段、来源、能力/引用；非全部 Feature
  layers: MapLayer[];            // 样式、可见性、筛选、datasetId
  groups: LayerGroup[];
  rootOrder: LayerTreeEntry[];
  cartography: CartographyState; // 保留现有标准制图相关内容
  basemap: BasemapConfig;
  initialView: MapViewState;
}

interface SceneContent {
  kind: 'scene3d';
  scene: CesiumScene;            // 现有成熟三维 schema 可复用
  // 其他三维工程配置，仅在必要时扩展
}
```

约束：

- `content.kind` 是唯一判别依据；拒绝不一致的组合；不要再靠 `settings.workspaceType` 或 `city` 是否存在推断新项目类型。
- Project 不持有 DataProvider 实例、`ol/Feature`、Cesium Primitive、AbortController、EditBuffer、完整大型 Feature 数组。
- 可保存的 `DatasetDefinition` 保留数据源 URI、表/图层名、CRS、schema 等**必要元信息**。沿用既有“源 CRS 与缓存几何坐标”规范，不在迁移中暗改坐标语义。
- 数据源凭据只存安全引用，不将实际密钥写入项目。
- 当前地图视角属于运行时，`initialView` 是可保存的工程配置；明确“设为初始视角”才修改该配置。对旧项目保留原有打开视角语义的迁移处理。
- **数据引用不是数据本身**：可移植工程可以打包工程文件+数据文件，也可为小型内存数据提供嵌入式/打包方案；不可因改用引用而使原来可以保存的 GeoJSON 编辑结果丢失。

### 3.2 ProjectStore：运行时持有 Project，不重新发明 GIS 领域层

```ts
interface ProjectState {
  project: Project | null;
  projectDirty: boolean;
  projectEpoch: number;    // 切换工程时递增；异步结果防串工程
  configRevision: number;  // 工程配置变更版本；不是 Feature 数据版本
}
```

- **只持有一份当前 Project**；不在其他 Store 再存一份完整 Project 副本。
- `open/close/save/commitConfig` 由受控 Application API 调用；组件不得直接 `setState({...project...})` 或深层突变。
- ProjectStore 不含 `featuresByDataset` 全量数据，不承载 GIS 编辑历史及 OpenLayers/Cesium 实例。
- 工程配置更新推荐用 Zustand + Immer（需检查依赖、引入并锁定版本），更新时保留无关分支引用；修改一次样式不能扫描所有 Feature。
- 领域操作使用普通函数与明确业务 API；Immer Draft 只在受控事务内部使用。
- `projectDirty` 只代表工程配置自上次成功保存后有变化。保存期间若发生新配置修改，不能错误清除 dirty；延续现有 `projectEpoch`/版本和保存队列语义。

概念伪代码：

```ts
// Command / Application 层；不允许 UI 任意传 draft 修改工程
function setLayerStyle(layerId: string, style: LayerStyle): void {
  projectStore.commitConfig('设置图层样式', draft => {
    if (draft.content.kind !== 'map2d') throw new Error('当前项目不是二维');
    const layer = findLayer(draft.content, layerId);
    assertLayerEditableForStyle(draft.content, layerId);
    layer.style = normalizeStyle(style); // Immer Draft 中的直观赋值
  });
}

// commitConfig 内部在一次事务中执行校验、结构共享更新、
// 配置 Undo 记录和单次 Store 发布；无变化则不增加历史/版本。
```

`commitConfig` 是内部能力，不是允许 UI 绕过 Command 的任意写入后门。是否使用 Immer patches 实现配置 Undo，取决于实测复杂度；不要同时维护 patches、JSON 全快照和多套命令历史。

### 3.3 FeatureProvider：大数据访问边界

```ts
interface FeatureProvider {
  readonly datasetId: string;
  readonly capabilities: {
    read: boolean;
    write: boolean;
    transactions: boolean;
  };
  getById(id: string, signal?: AbortSignal): Promise<GisFeature | null>;
  query(options: {
    extent?: Extent;
    offset?: number;
    limit?: number;
    filter?: FilterExpression;
    signal?: AbortSignal;
  }): Promise<{ features: GisFeature[]; hasMore?: boolean }>;
}

interface WritableFeatureProvider extends FeatureProvider {
  commit(batch: FeatureEditBatch, options?: {
    signal?: AbortSignal;
    expectedVersions?: Record<string, string>;
  }): Promise<CommitResult>;
}
```

这是**职责参考接口**，正式实现应沿用现有数据源差异、服务端过滤/分页等约束，不强迫 WMS/WMTS/WFS 都支持要素编辑：

- `DatasetDefinition` 是 Project 内的配置记录；`FeatureProvider` 是运行时访问实现。
- `Provider` 的生命周期属于打开的 Project 会话；可在 Workspace 未挂载时继续处理数据编辑。
- GeoJSON/内存、Shapefile、WFS、GeoPackage、PostGIS 等根据实际能力支持，不虚构现有仓库已经实现 GeoPackage/PostGIS 写入。
- WMS/WMTS 为图像/瓦片服务，不必硬套 `FeatureProvider`；可以复用当前服务图层加载方式并定义独立的源能力。
- 大数据优先按范围、分页、索引或瓦片加载；属性表分页/排序过滤需要一致的 Provider 能力约定。
- 保留 WFS 目前的 `maxFeatures`、完整性/截断、分页、取消与凭据规则；不能把截断窗口伪装成全数据集。
- 对不支持回写的格式，明确只读、编辑副本或导出新数据集等产品流程，不能承诺会原地提交。

### 3.4 FeatureEditor：编辑缓冲区 + 当前编辑会话历史

最小对外接口，不要求拆出单独的 EditSession/HistoryManager 等类：

```ts
interface FeatureEditor {
  begin(datasetId: string): Promise<void>;
  getById(id: string): Promise<GisFeature | null>; // 原始数据 + 编辑缓冲有效视图
  updateGeometry(id: string, geometry: Geometry): Promise<void>;
  updateProperties(id: string, properties: Record<string, unknown>): Promise<void>;
  add(feature: GisFeature): Promise<void>;
  remove(id: string): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  save(): Promise<void>;      // 成功写回 Provider 后清理缓冲
  discard(): Promise<void>;   // 丢弃缓冲
  hasPendingChanges(): boolean;
  subscribe(listener: (change: { datasetId: string; featureIds: string[]; revision: number }) => void): () => void;
}
```

- **一个 Dataset 一个逻辑上的编辑缓冲所有权**；多个 Layer 引用它时共享同一编辑结果和刷新通知。可以由一个 FeatureEditor 管多个 Dataset，重点是所有权不按 Layer 复制。
- 编辑结果用 `insert/update/delete` overlay 保存**变化项**，不复制整个数据集；Undo 只记录必要的前后状态。需支持无效变更抵消（A→B→A 可归零）。
- 查询结果统一是 **Provider 原始数据 + EditBuffer overlay 的有效视图**，不是直接从 Provider 给地图、从 Buffer 给属性表。
- 特别处理**变更导致要素进入/移出查询范围**、删除、插入、过滤、排序、重复 ID；不允许只覆盖原来返回的 Feature 而漏掉从范围外移动进来的编辑要素。
- 编辑期间的临时拖动、悬停和草稿仅由 Workspace/OL Interaction 维护；`modifyend` 后校验并原子写 EditBuffer。失败则恢复原生对象；不要每一帧都提交 Undo。
- 成功 `save()` 后清理本次数据编辑 Undo，并保留工程配置的 Undo；提交失败保持 Buffer 与当前有效视图不变，允许重试。
- Provider 保存必须保证可支持时的事务原子性，并考虑外部修改版本冲突、取消、文件写入中断；不支持事务的源必须明确失败恢复策略，不能假称原子。
- 正在进行的数据编辑不能因地图组件卸载、属性表切换而丢失；切换/关闭工程前必须经过保存/放弃/取消流程。
- 程序崩溃恢复另行利用现有 recovery 机制扩展：**不能因为 Project 文件不再内嵌要素，就导致未提交编辑变更无法恢复**；实现前先审查当前 recovery 的持久化语义。

### 3.5 Undo / Redo 的明确作用域

- **仅一个当前 Project 类型**，因此无需二三维跨工作区 Undo 协调。
- 工程配置 Undo 与当前 Dataset 编辑缓冲的 Undo **内部各自有正确的提交边界**。外部快捷键只有一个 `undo()` 入口：当前处于要素编辑模式时优先撤销编辑操作，否则撤销工程配置操作。明确编辑模式中项目配置修改的行为并在界面测试验证；禁止出现“按一次 Undo 不知道撤销哪项”的情况。
- 如果评估发现上述路由影响既有产品习惯，应在单阶段内统一为**一个具备不同提交边界的操作历史**，而非产生两套都响应 Ctrl+Z 的监听器；关键是交互一致性和数据提交语义。
- 项目配置 Save 不应隐式提交数据编辑；数据编辑 Save 不应清除工程配置 Undo。
- 不对地图平移、临时预览、Hover 等增加工程 Undo。

### 3.6 Workspace / Renderer 的职责

```text
配置 Command
    → ProjectStore.commitConfig
    → 配置引用 / revision 变化
    → 对应 OL Layer.setVisible / setStyle / setOpacity ...

要素编辑 Command
    → FeatureEditor 写入 EditBuffer
    → 局部要素变更通知（datasetId + featureIds）
    → 受影响 OL Feature/Source + 属性表缓存/空间查询失效

临时交互
    → OL Draw / Modify / overlay 预览
    → 结束手势后提交上述 FeatureEditor

定位图层、普通平移缩放
    → Workspace 直接操作 OL Map
    → 不改变 ProjectStore；仅按需更新 Session 当前视图
```

- **MapSync 是可描述的职责，不必须是一个新 class**。在当前 `map-runtime-host.ts` / `OlMapRuntime.ts` 的基础上，确定一个唯一的订阅/调度入口；不可 MapCanvas 订阅一次、ToolCallback 又额外同步一次。
- 首次打开工程、引擎重挂载、投影整体变更、未知错误恢复时允许全量 `reconcile()`；日常单 Layer 样式/显隐及单 Feature 修改必须走增量路径。
- 对相同 Dataset 的多个 Layer 更新一致性；如果图层样式、筛选、分组显隐变化，只修改对应渲染属性，尽量保留原有 OL Source、Feature 和编辑交互引用。
- 一次局部编辑不允许经 `createProjectSceneDocument(snapshot)` 对全部数据做 GeoJSON 转换。
- 3D 继续使用现有 Cesium schema 和交互能力，统一从 `content.scene` 读取；不要将 2D FeatureEditor 强套到 3D 模型节点。
- 异步加载使用 `projectEpoch`、dataset revision 和 AbortController 识别过期结果；保存失败、快速切换工程和重挂载不应产生旧数据覆盖新项目。
- selection / 当前工具 / 属性表分页 / 当前地图视角属于会话状态；可以继续复用 `session.store.ts`、`workbench.store.ts`，不要再建第三份 Session 全局状态。

## 4. 三个操作的完整伪代码与时序

### A. 修改图层颜色（仅工程配置）

```ts
// UI
commands.map.setLayerStyle('river-layer', redStyle);

// Application -> ProjectStore（统一事务）
projectStore.commitConfig('修改图层样式', draft => {
  if (draft.content.kind !== 'map2d') throw new Error('不是二维工程');
  const layer = findLayer(draft.content, 'river-layer');
  layer.style = redStyle;
});

// Sync 内部订阅：只更新对应样式
onProjectConfigChanged((before, after) => {
  for (const layerId of findChangedLayersByReference(before, after)) {
    adapter.updateLayerPresentation(layerId, getLayer(after, layerId));
  }
});
```

结果：`projectDirty=true`；Provider、EditBuffer、Feature 不变；Undo 记录一次配置修改；保存工程才持久化。

### B. 拖动 `river-100` 顶点（仅数据编辑）

```ts
// Workspace：拖动中只更新临时 OL 几何 / overlay
olModify.on('modifyend', async ({ id, geometry }) => {
  try {
    await featureEditor.updateGeometry(id, toDomainGeometry(geometry));
  } catch (e) {
    restoreNativeGeometry(id); // 失败回滚临时预览
    showError(e);
  }
});

// FeatureEditor 内部：示意，不是完整实现
async function updateGeometry(id: string, geometry: Geometry) {
  const before = await effectiveView.getById(id); // Provider + Buffer
  const after = validateAndReplaceGeometry(before, geometry);
  if (sameGeometry(before.geometry, after.geometry)) return;
  editBuffer.apply({ type: 'update', before, after });
  editHistory.record({ before, after });
  publishLocalChange({ datasetId, featureIds: [id], revision: ++revision });
}

// 地图、属性表都从统一有效视图读取；不触碰 ProjectStore
```

结果：Project/`projectDirty` 不变；原始文件不变；EditBuffer 中一条变化；可 Undo/Redo；地图即时看到有效结果；用户明确保存数据时才 `provider.commit()`。

### C. 修改一个要素后点击保存

```ts
async function saveDataEdits() {
  const batch = editBuffer.pendingBatch();
  if (batch.isEmpty()) return;

  const expected = editBuffer.baseVersions();
  const result = await provider.commit(batch, { expectedVersions: expected });
  // 只有成功才把新版本和 ID 映射写回编辑会话并清空待提交记录
  editBuffer.acceptCommit(result);
  editHistory.clearDataEdits();
  publishLocalChange({ datasetId, featureIds: batch.ids(), revision: ++revision });
}
```

注意：`Ctrl+S` 是否只保存工程按当前产品交互约定保持一致；默认**不偷偷提交 EditBuffer**。结束编辑/关闭工程时遇到未提交数据，提供保存、放弃、取消三选一。

## 5. 分阶段实施（完成一个阶段、验证后再开始下一个）

### 阶段 0：代码盘点、保护基线、验证工具链

**任务**：

1. 拉取最新代码，列出 Project 类型、二三维创建/切换、`ProjectSnapshot`、项目 Save/Open/Recovery、Store 的全部写入调用点。
2. 列出 `syncMapFromProject`、`OlMapRuntime.syncDocument/syncLayers`、`createProjectSceneDocument` 的真实调用图及是否存在重复触发。
3. 枚举数据源类别：GeoJSON/内存、Shapefile/DXF、WFS、WMS/WMTS、3D Tiles/模型；逐项确认现状、保存能力、是否已有后端或 Tauri API。
4. 记录旧项目文件样本（2D、3D、历史版本、含数据编辑和服务凭据引用），用基线测试锁定重新打开的语义；提前建立自动化回归样本。
5. 测量当前图层显隐、样式、单要素编辑涉及的全量克隆与同步次数，生成基线（本地可重复的脚本或测试）。

**交付**：`docs/architecture/refactor-inventory.md`（事实、入口、依赖图、迁移风险）及必要的基线测试。**不要在此阶段大改功能。**

### 阶段 1：项目领域结构与持久化迁移

**任务**：

1. 在 `gis-core` 设计并测试 `Project = metadata + content` discriminated union。
2. 二维内容迁移 `layers/datasets/groups/rootOrder/cartography/crs/mapState/basemap`；三维迁移 `city` 内数据为 `content.scene`；保留现有 Cesium schema 及制图样式语义。
3. 重写项目创建、解析、序列化与老版本迁移；更新 `project-type.ts`，新项目只根据 `content.kind` 判断类型。
4. 保存时写新格式，旧格式读入后迁移到新格式；**不能静默丢弃**遗留 `city`、二维要素、资源引用、样式、标注、字段、筛选、分组顺序或 `featuresByDataset`。
5. 若旧文件同时包含非空的二维和三维内容，迁移必须显式选择/保留策略：优先尊重已声明的旧 `workspaceType`，对不可无损处理的附加内容给出导出/备份或拒绝并提示，**禁止静默覆盖**。
6. 保留并验证凭据去敏、相对路径、资源重定位、撤销/恢复保护、异步保存版本判断。

**验收**：新建/打开/保存/另存/关闭/重新打开均正确；旧 2D/3D 项目样本迁移；每个 Project 恰有一个 `content.kind`；凭据未泄露；历史数据不丢失。

### 阶段 2：ProjectStore 收敛 + 配置操作统一

**任务**：

1. ProjectStore 收敛为工程配置状态/提交/dirty/revision/epoch；剥离 `featuresByDataset`、selection、要素编辑方法和引擎控制职责。
2. 使用 Zustand + Immer（如确认适合）实现单次受控配置事务；选定**一套**配置 Undo 机制。
3. 图层显隐、样式、透明度、排序、重命名、分组、过滤配置、二维初始视角、三维节点/场景配置，都通过受控 Application 命令修改相应 `content`。
4. 统一防锁定、参数校验、无变化跳过、Undo 合并（连续滑块/样式拖动的一次用户手势归为一次 Undo）、状态发布。
5. 非业务临时状态迁移到既有 Session/Workspace；不要求短期内删除所有旧包装函数，但新调用路径不能绕过统一写入边界。

**验收**：单次图层显隐/样式修改不执行任何全量要素克隆、`editedFeatures()` 或 `syncStoreFromState()`；配置 Undo/Redo、保存 dirty 正确；原有业务锁定/过滤/制图行为不退化。

### 阶段 3：Provider 与 EditBuffer（必须有一条完整垂直切片）

**任务**：

1. 明确 `DatasetDefinition` 与运行时 Provider 的边界；设计 Provider 读取、按 ID、按范围、分页、写入能力、错误契约与生命周期。
2. 优先选择**现有可编辑数据源**（建议内存/本地 GeoJSON）实现完整垂直切片：打开 → 选中 → 编辑几何/属性 → Undo/Redo → 数据保存 → 重新打开。若底层文件格式不可安全原位更新，采用临时文件 + 原子替换/明确导出流程。
3. EditBuffer 用 `insert/update/delete` overlay；开发统一 EffectiveFeatureView，地图/属性表/查询使用同一有效视图。
4. 对同 Dataset 两个 Layer 的变化统一同步；支持跨范围移动、筛选后新增/删除、排序、分页、稳定 ID、属性模式与几何编辑。
5. 编辑模式和提交行为参考既有 QGIS 风格预期；明确 unsupported/read-only 服务的反馈；不得简单将 WFS 等远端数据默认为可写。
6. 保证旧 `ProjectSnapshot.featuresByDataset` 导入不丢数据：先从 legacy embedded 还原到对应可持久数据源；**不能只存 `source` 引用就丢掉原先快照中的本地修改**。
7. 设计未提交编辑的工程关闭确认、异常恢复与数据提交失败处理。

**验收**：项目配置 Save 不提交数据；数据 Save 不修改项目配置；编辑失败原数据不变；Buffer overlay 在地图、属性表、查询一致；两个 Layer 同步一致；完整的旧文件数据可恢复。

### 阶段 4：地图/场景增量同步与工具生命周期

**任务**：

1. 收敛 `MapCanvas` 与 `map-runtime-host` 的同步入口；删除重复 full sync，统一初始化和增量路由。
2. 配置变化只更新相关 OL Layer 表现，保留 Source；编辑变化只更新相关 OL Feature / 受影响空间分块，不替换整层 Source。
3. 在初始化、CRS 变更、源替换、故障恢复下保留 `full reconcile`；同步时避免两个版本异步交错。
4. 验证原生 Draw/Modify 工具仍然引用有效 Source；拖动预览/失败恢复/撤销不产生重复绘制或重复事件。
5. Cesium 场景从 `Project.content` 获取，仅在 3D 项目时挂载；保留相机、场景资产、变换、几何编辑、裁剪、资源导入、撤销与导出。
6. 核实 `syncLayers` 等旧路径所有消费者后决定删除，**不能仅因名字旧就删除**。

**验收**：修改可见性不换 Source；更新一条 Feature 不全量生成 GeoJSON/OL Features；选择/编辑交互对象引用正确；切换工程/关闭地图/快速重复操作无过期回写；3D 基本工作流不回退。

### 阶段 5：大数据验证、清理与最终文档

**任务**：

1. 用合成但结构真实的数据集开展 10 万、100 万 Feature 测试：工程打开、范围查询、移动视图、属性表分页、单要素修改/Undo/Save 的内存和耗时。
2. 测量并报告：存量 Project JSON 体积、打开工程耗时、一次样式修改期间读取的 Feature 数、要素转换数、Source 重建数、OL 对象数、EditBuffer 增量内存、保存/恢复耗时。
3. 验证空间范围/分页/过滤/排序、编辑 overlay 与大数据缓存一致性；无索引/格式能力不足的 Provider 应明确降级/提示，不可假称百万级编辑流畅。
4. 删除确证无消费者的旧 `featuresByDataset` 跨层复制路径、兼容性同步函数和冗余 Store 写入口；不要删除项目旧格式**读入兼容**。
5. 更新架构说明、数据模型、两类保存操作的交互规范与失败恢复说明，确保下一个开发者能用示例回答“Project/ProjectStore/Provider/EditBuffer 到底谁做什么”。

**验收**：有可复现的性能数据和对比，证明配置操作成本不随 Feature 总量线性增长；百万级数据不需要全部进入 ProjectStore；对无法达标的 Provider 记录约束和待办，不作虚假通过。

## 6. 必须保护的测试和产品场景

| 场景 | 必须验证的结果 |
|---|---|
| 新建 2D/3D 工程 | `content.kind` 精确且唯一，另一种内容不会混入 |
| 老项目打开与迁移 | 旧二维图层、字段、制图样式、三维节点和资产、资源路径等无损；旧嵌入 Feature 不丢失 |
| 图层样式/显隐/排序 | ProjectStore dirty + 配置 Undo 正确；没有 Feature 全量复制；OL Source 身份稳定 |
| 同 Dataset 两个图层 | 修改一个 Feature，两层显示/属性表一致 |
| 修改几何/属性、增删要素 | 数据仅入 Buffer，原始源直到数据 Save 才改变；Undo/Redo 正确 |
| 查询与空间范围 | Buffer 的新增/删除/跨范围移动/属性过滤和 Provider 的查询结果合并正确 |
| 保存工程 | 只保存工程配置；在写入过程中继续修改也不会错清 dirty |
| 保存数据 | 成功才清 Buffer；失败可重试；不改变项目 dirty；版本冲突不丢数据 |
| 关闭工程/退出/取消编辑 | 保存/放弃/取消按实际 dirty 保护，取消退出时所有对象和编辑保留 |
| 文件/源权限异常 | 不写坏源文件；错误可诊断；只读源不能假装已保存 |
| 地图工具生命周期 | 选择、捕捉、绘制、编辑预览、撤销、重挂载正常，无重复回调 |
| WFS/WMS/WMTS | 原有服务加载、凭据、截断与取消语义保持 |
| 三维编辑器 | Cesium 加载、资产引用、模型变换、编辑、裁剪、保存与 Undo 保持 |
| 100 万条要素 | 项目配置操作不遍历全量要素；范围/分页请求有边界和可复现内存数据 |

### 现有测试入口

根据仓库 `package.json`：

```bash
pnpm install
pnpm test
pnpm build
pnpm --filter @desktop-webgis/desktop test:e2e
```

必要时分别执行二维/三维的现有 Playwright 专项命令。**先检查当前环境与基线是否本来失败**；若测试需要凭据/原生资源/外部服务，记录隔离方式，不把环境失败伪装成重构失败。

关键现有测试文件可参考：

- `packages/gis-core/src/project.migration.test.ts`
- `packages/gis-core/src/project.service.test.ts`
- `packages/gis-core/src/editHistory.test.ts`
- `packages/gis-core/src/update-geometries.test.ts`
- `packages/ol-runtime/src/map/OlMapRuntime.document.test.ts`
- `packages/ol-scene-runtime/src/document-runtime.test.ts`
- `apps/desktop/src/app/commands/edit.commands.test.ts`
- `apps/desktop/src/app/commands/layer.style-commands.test.ts`
- `apps/desktop/src/app/commands/project.scene-commands.test.ts`

这些文件是**建议检查的现有测试位置**；应在最新分支再次确认存在与覆盖范围，补足缺失的 Provider/EditBuffer/迁移/性能测试。

## 7. 关键风险与防护

1. **项目格式升级造成数据丢失**：迁移要保留旧源文件与原始内容，写新格式前备份/可回滚；旧 `featuresByDataset` 必须有明确的落盘归宿。
2. **保存边界误判**：原先“保存项目”包含 Feature Snapshot；重构成只保存配置后，若用户此前依赖 Ctrl+S 保存编辑，必须在产品层显示迁移提示并进行兼容测试。禁止无提示改变成数据丢失行为。
3. **Web 与 Tauri 能力不同**：浏览器下载 Project JSON 不具备通用持久 sidecar 写权限；要么打包资源、要么使用兼容嵌入策略、要么显式提示限制；不能生成无法重新打开的工程。
4. **Provider 与 Buffer 双源不一致**：缓存、查询、属性表、空间分析须读取同一有效视图；编辑提交后的版本/ID 同步要原子。
5. **OL 修改对象被异步替换**：在手势结束前不得因配置变化无故替换 Source；旧请求必须按 epoch/revision 丢弃。
6. **3D 完整迁移**：`project.city` 包含的不止节点，不能简单 `content.scene = city` 就忽略 `sceneDisplay`、摄像机、外部资源解析或导入/导出格式。
7. **Undo 历史错乱**：配置与数据编辑生命周期不同；编辑保存后不得留下可撤销但无法合法重放的 EditBuffer 操作。
8. **性能假改善**：用数组引用比较代替 JSON 比较，不等于已实现单 Feature 更新。验收以实测 Source/Feature 重建数和查询规模为准。

## 8. 完成定义（Definition of Done）

同时满足以下条件，才能宣称“架构重构完成”：

- 新的 Project 类型确认为 `metadata + (map2d | scene3d)`，且相互排斥；旧项目可迁移。
- ProjectStore 不含整批 Feature，项目配置修改不再触发全量 Feature 处理。
- Feature 编辑具有真正的 Buffer/Undo/Provider 提交闭环，数据保存与项目保存独立且不丢数据。
- Map 同步能够局部更新图层与要素，拥有可靠全量恢复路径；三维行为稳定。
- 安全边界、相对资源、凭据、异步版本检查与恢复能力没有退化。
- 所有主要原有测试通过，新增关键场景测试通过；有可复现的性能对比。
- 代码中不存在两套并行的权威 Project 数据模型、两套活跃 MapSync 或未经验证的旧/新写入双路径。
- 提交最终 `docs/architecture/README.md` 或等价文档：职责图、时序、存储格式、保存语义、迁移说明、性能基准与未实现的 Provider 能力列表。

## 9. 阶段性交付报告格式（每阶段必交）

```text
阶段：
当前 HEAD / 基线：
本阶段目标与完成项：
修改文件（按领域分组）：
关键设计决策（仅记录偏离或新增）：
测试命令及结果：
保存/迁移/Undo/大数据风险：
未完成事项：
建议下一阶段工作：
```

**实施判断原则**：可以大幅调整旧代码，但每次改动都要能回答：这段状态究竟属于 Project、ProjectStore、FeatureProvider、FeatureEditor、Session 还是地图引擎？如果无法回答，不要再添加一层封装；先确定数据所有权与更新边界。

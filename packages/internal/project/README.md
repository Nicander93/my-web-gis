# @desktop-webgis/project

Desktop 的核心项目模型包（内部包），负责项目配置、内存中的要素数据 `Provider/Buffer`，以及统一的编辑命令和撤销历史。

## 内部架构图

`src/` 内部遵循严格的单向依赖：`history → config → data → 基础工具`，由 `pnpm check:architecture` 强制检查。

```mermaid
flowchart TB
  index["src/index.ts（对外的统一导出）"]

  subgraph history ["src/history/ 编辑历史与命令"]
    editHistory["editHistory.ts（EditHistory 的撤销与重做栈）"]
    configCmds["configCommands.ts（图层、样式、数据集和要素的编辑命令）"]
    scene3dCmds["scene3dCommands.ts（SetCesiumSceneCommand）"]
    editTargets["edit-targets.ts（编辑目标与锁定的计算）"]
  end

  subgraph config ["src/config/ 项目配置"]
    types["types.ts（Project / ProjectContent2D / ProjectContent3D / Layer / Dataset）"]
    proj["project.ts 与 project-content.ts 与 project-format.ts（创建、校验、序列化与版本迁移）"]
    tree["layer-tree.ts 与 cartography.ts 与 field-references.ts（图层树、制图同步、字段引用重定位）"]
    caps["capabilities.ts 与 project-share.ts（数据源能力矩阵与分享脱敏）"]
  end

  subgraph data ["src/data/ 要素与数据集"]
    dataTypes["types.ts（GisFeature / Geometry / DatasetField）"]
    provider["feature-provider.ts（MemoryFeatureProvider 与 FeatureEditBuffer）"]
    store["featureStore.ts（MemoryFeatureStore 的事务与快照）"]
    ops["geojson.ts / dataset-schema.ts / field-identities.ts / filter.ts / sort.ts / stats.ts"]
  end

  base["src/clone.ts 与 src/id.ts（深拷贝与 ID 生成）"]

  index --> history
  index --> config
  index --> data
  history --> config
  history --> data
  config --> data
  data --> base
```

## 验证

```bash
pnpm --filter @desktop-webgis/project build
pnpm --filter @desktop-webgis/project test
```

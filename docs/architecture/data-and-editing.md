# 数据与编辑架构

本文说明 Desktop WebGIS 的数据与编辑架构。当初的实施约定见[重构计划 V1.0](../archive/refactor-2026-11/refactor-plan-v1.md)，阶段记录见 `docs/archive/refactor-2026-11/refactor-stage-*.md` 和[交接记录](../archive/refactor-2026-11/refactor-handoff-2026-11-02.md)。

## 各部分负责什么

| 对象 | 职责 | 不负责 |
| --- | --- | --- |
| `Project` | 可序列化的项目配置：`metadata` 加 `content`（`map2d` 或 `scene3d`） | 存储要素行 |
| `ProjectStore` | 当前项目配置、`epoch`、`configRevision`，以及配置是否有未保存修改 | 全部要素、选中集、引擎控制 |
| `RuntimeFeatureData` | 每个数据源一个 `MemoryFeatureProvider` 加一个 `FeatureEditBuffer`，另有一份兼容用的行缓存 | 另开一套撤销历史 |
| `FeatureEditState` | 活动数据源的 pending/saving 计数；`retained` 与 `unsavedCount` 把历史中保留的数据源也算进去 | 再存一份行数据 |
| 项目保存 | 只写配置。已绑定的数据源写成 storage 引用，未绑定的数据源嵌入 **Provider 里的原始行** | 提交 Buffer，或写入编辑后的有效行 |
| 数据保存 | `commitDatasetEdits` / `saveBoundDataset`，成功后才清空 Buffer，不改变配置的未保存状态 | 等同于工程的 Ctrl+S |

## 两类保存

1. **Ctrl+S 保存项目**：走 `createConfigurationSnapshot`。已绑定的数据源不写 `featuresByDataset` 字段，打开时按引用重新读取；未绑定的数据源写入 Provider 中的原始行。Buffer 里的增量仍然保留，状态栏会提示“数据编辑尚未提交”。
2. **提交数据**：工具栏或图层菜单里的「保存数据」走 `requestDatasetSave`。已绑定的数据源直接调 `saveBoundDataset`，未绑定的先创建托管文件再提交。关闭项目时的确认框走 `requestUnsavedWorkSave`，它只提交已绑定的活动数据源。没有绑定文件的数据源，或只在历史里保留的数据源，其增量无法通过保存项目清掉。

「放弃数据」按数据源调用 `discardDatasetEdits`：先检查历史，再丢弃该数据源的 Buffer 和对应的数据命令，并还原字段声明。其它数据源和配置的撤销记录都保留。

标题栏上的“未保存”只表示配置有改动。数据有没有提交，要看图层编辑状态和 `unsavedCount`。

## 恢复草稿

- v1：保存编辑后的有效行快照，用于兼容旧版本。重新打开后有效行成为新基线，没有待提交的增量。
- v2：`dataSessions` 保存原始数据源加 `FeatureEditBatch`。重新打开时先恢复 Provider 基线，再回放未提交的增量。
- 恢复失败或被取消时不会覆盖当前项目。与已绑定文件的基线不一致时，数据保存仍然会拒绝覆盖。

## 地图同步

当投影没有变化时，`OlMapRuntime.syncDocument` 直接修改已有 `VectorSource` 里的要素，保留 Source 和 OL Feature 实例，绘制和修改工具手里的引用一直有效。坐标系变化、切换数据源和故障恢复仍然走整层重建。

## 性能数据与尚未支持的场景

| 依据 | 范围 | 结论 |
| --- | --- | --- |
| `architecture-baseline.test.ts` | 100 和 10 000 个要素 | 切换图层显隐或改样式都不会把要素复制进 Store；1 万个要素的场景投影约 70ms |
| 同上 | 100 000 个要素 | 显隐和单点几何仍然不复制进 Store（小于 1ms）；`captureActiveSessions` 会复制原始数据源，约 0.1 到 0.4 秒 |
| 同上 | 1 000 000 个要素 | `loadSnapshot` 约 15 到 19 秒；显隐加 edit-state 约 0.6ms。场景投影、范围查询和地图交互没有测 |
| 单要素 Source patch | OL 运行时测试 | 改一行的数据不换 Source，Feature 引用保持有效 |

尚未实现或无法保证的部分：WFS 默认可写、远端 CAS、百万级数据量的空间索引查询、浏览器端的通用本地 sidecar 写入。

## 延伸阅读

1. [重构计划 V1.0](../archive/refactor-2026-11/refactor-plan-v1.md)：目标与完成标准
2. [阶段 1](../archive/refactor-2026-11/refactor-stage-1.md) → [2](../archive/refactor-2026-11/refactor-stage-2.md) → [3](../archive/refactor-2026-11/refactor-stage-3.md)：实施记录
3. [项目恢复草稿](project-recovery.md)：恢复功能的产品说明
4. 代码入口：`project/project-session.ts`、`project/project-edits.ts`、`project/datasets/feature-data-runtime.ts`、`project/project-save.ts`、`project/unsaved-work.ts`、`project/dataset-storage.ts`

# 数据与编辑架构

本文档是 Desktop WebGIS **数据与编辑架构** 的说明。实施合同见 [重构计划 V1.0](../archive/refactor-2026-11/refactor-plan-v1.md)。阶段记录见 `docs/archive/refactor-2026-11/refactor-stage-*.md` 与 [交接记录](../archive/refactor-2026-11/refactor-handoff-2026-11-02.md)。

## 谁做什么

| 对象 | 职责 | 不是 |
| --- | --- | --- |
| `Project` | 可序列化的工程配置：`metadata + content(map2d\|scene3d)` | 要素行仓库 |
| `ProjectStore` | 当前工程配置状态、epoch、configRevision、配置 dirty | 全量 Feature / 选择 / 引擎控制 |
| `RuntimeFeatureData` | 每源 MemoryFeatureProvider + FeatureEditBuffer；兼容行缓存 | 第二套 Undo 历史 |
| `FeatureEditState` | 活动源 pending/saving；`retained`/`unsavedCount` 覆盖历史保留源 | 第二份行数据 |
| 工程 Save | 只写配置；已绑定源用 storage 引用；未绑定源嵌入 **原始 Provider** 行 | 提交 Buffer / 写入有效行快照 |
| 数据 Save | `commitDatasetEdits` / `saveBoundDataset`：成功才清 Buffer，不改配置 dirty | 工程 Ctrl+S |

## 两类保存

1. **Ctrl+S / 工程保存**：`createConfigurationSnapshot`。绑定源省略 `featuresByDataset` 键（打开时按引用加载）；未绑定源写入原始源。pending 仍留在 Buffer，状态栏可提示“数据编辑尚未提交”。
2. **数据提交**：工具栏/图层菜单的「保存数据」走 `requestDatasetSave`（已绑定则 `saveBoundDataset`，未绑定则先建托管文件再提交）。关闭确认里的 `requestUnsavedWorkSave` 仍只提交已绑定活动源。无绑定或仅历史保留源的 pending 不能靠工程保存清掉。

「放弃数据」按源 `discardDatasetEdits`：预检历史后丢掉该源 Buffer 与对应数据命令，还原字段声明，其它源和配置 Undo 保留。

标题“未保存”只反映配置 dirty。数据未提交看图层编辑状态和 `unsavedCount`。

## 恢复草稿

- v1：有效行快照（兼容）。重开后有效行成为新基线，无 pending。
- v2：`dataSessions` 保存原始源 + `FeatureEditBatch`。重开后恢复 Provider 基线并回放 pending。
- 失败/取消不覆盖当前工程；与已绑定文件基线不一致时数据保存仍拒绝覆盖。

## 地图同步

`OlMapRuntime.syncDocument` 在投影不变时 **原地 patch** 已有 `VectorSource` 的要素，保留 Source 与 OL Feature 实例，供 Draw/Modify 继续引用。坐标系变更、换源、故障恢复仍走重建路径。

## 性能与未完成 Provider

| 证据 | 范围 | 结论 |
| --- | --- | --- |
| `architecture-baseline.test.ts` | 100 / 10_000 要素 | 配置显隐/样式不复制要素进 Store；10k 场景投影约 70ms |
| 同上 | 100_000 要素 | 显隐/单点几何仍不拷进 Store（<1ms）；`captureActiveSessions` 会拷原始源，约 0.1–0.4s |
| 同上 | 1_000_000 要素 | `loadSnapshot` 约 15–19s；显隐 + edit-state 约 0.6ms。未测场景投影、范围查询、地图交互 |
| 单要素 Source patch | OL 运行时测试 | 改行不换 Source、保留 Feature 引用 |

未实现或不保证：WFS 默认可写、远端 CAS、空间索引百万级查询、浏览器本地 sidecar 通用写。

## 阅读顺序

1. [重构计划 V1.0](../archive/refactor-2026-11/refactor-plan-v1.md) — 目标与完成定义  
2. [阶段 1](../archive/refactor-2026-11/refactor-stage-1.md) → [2](../archive/refactor-2026-11/refactor-stage-2.md) → [3](../archive/refactor-2026-11/refactor-stage-3.md) — 实施记录  
3. [项目恢复草稿](project-recovery.md) — 恢复产品说明  
4. 代码入口：`session/project-session.ts`、`session/project-edits.ts`、`data/feature-data-runtime.ts`、`session/project-save.ts`、`session/unsaved-work.ts`、`session/dataset-storage.ts`

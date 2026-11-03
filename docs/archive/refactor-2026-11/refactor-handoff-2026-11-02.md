# 数据与编辑架构重构交接（2026-11-02）

## 接手结论

完整任务仍是 [refactor-plan-v1.md](refactor-plan-v1.md) 的阶段 **0–5**，不能缩成当前已通过的测试范围。阶段2/3进行中，阶段4/5未完成。已经接通内部的数据文件绑定、提交和原生进程重启重开；**默认工程 Save 尚未改成只保存配置，也没有开放用户数据保存按钮**。

本文件写于用户要求换 agent 接手时。最后一个业务改动批次起初是“独立编辑状态订阅与提交发布会话”。随后已补上活动源与保留源的未保存检查，见阶段 3 尾部 2026-11-02 记录。恢复协议仍未实施。

## 工作区与改动保护

- 唯一接手目录：`D:\my-code-repo\my-web-gis`；PowerShell；中文沟通。
- 分支 `main`；HEAD 和**本地 tracking ref** `origin/main` 均为 `2cf4a724aadb041ac030350079851494c37802d3`。未 fetch，不能据此声称实时远端同步。
- 写交接前 `git status --short` 有 **271 条**，包含大量已修改和未跟踪文件。不是所有改动都属于同一个批次，不能 reset/clean 或只拿 tracked diff。
- [初始盘点](refactor-inventory.md) 记录：开始前已有24个修改文件及未跟踪 `ui-density.test.ts`，涉及密度、停靠、面板、设置、原生脚本/E2E、设计系统文档；这些原有改动一直保留。
- 未提交、未推送，也未获此授权。当前 `.git` 为只读权限。
- 请在**同一个完整工作区**继续。只切到该 HEAD 的新 checkout 会丢失尚未提交的实现、测试和新文件。
- 本次交接另存文件名清单及 diff stat 到 `.artifacts/refactor/handoff-2026-11-02/`；这是辅助快照，实际 `git status` 和文件内容才是权威。

## 阅读顺序

1. 根 `AGENTS.md`、[代码偏好](../engineering/code-preferences.md)。
2. [完整计划与验收合同](refactor-plan-v1.md)，尤其阶段2–5、保护场景及完成定义。
3. [初始盘点](refactor-inventory.md)、[阶段1](refactor-stage-1.md)。
4. [阶段2](refactor-stage-2.md)、[阶段3](refactor-stage-3.md)。阶段3是追加记录，接手先看尾部最新批次，早期“尚不支持”的描述可能已被后文明确替代。
5. 准备修改关闭/恢复前，阅读 [恢复说明](../engineering/project-recovery.md) 和对应实际代码。

不要把历史日志中的中间失败当成最终结果，也不要把某个专项通过当成完整计划完成。

## 各阶段现状

| 阶段 | 当前状态 | 关键边界 |
| --- | --- | --- |
| 0 盘点/保护基线 | 已有记录与工具链 | 原始 dirty 和多类运行边界有记录 |
| 1 项目结构/迁移 | 主体已实施；最终全链路仍须复核 | Project v3 `{metadata, content}`，map2d/scene3d互斥，旧格式迁移/来源和凭据保护 |
| 2 Store/配置事务 | 进行中 | 唯一 Application 历史、配置上下文禁止 FeatureStore；dirty和默认保存语义未完成 |
| 3 Provider/Buffer | 进行中 | 内存 Provider/overlay、历史重基、受管文件、绑定/引用加载、原生5项已验证；关闭/恢复/UI未闭环 |
| 4 增量同步/工具生命周期 | 未完成 | 仍有全快照、全量投影与缓存路径，不能宣称单要素 O(1) |
| 5 大数据/清理/最终文档 | 未完成 | 100k/1m实测门槛、成本证据和完整交付审计未完成 |

## 已实施内容及主要入口

| 责任 | 主要文件 |
| --- | --- |
| Project结构/持久化 | `packages/gis-core/src/types.ts`、`project-content.ts`、`project.ts`、`project-format.ts` |
| Project配置状态 | `apps/desktop/src/stores/project.store.ts`：project、epoch、configRevision、dirty；没有把全量行重新放进Zustand |
| 唯一事务和历史 | `apps/desktop/src/services/project-edits.ts`；Core `editHistory.ts`、`configCommands.ts` |
| 原始源/编辑缓冲 | Core `feature-provider.ts`、`dataset-schema.ts`；Desktop `feature-data-runtime.ts`、`feature-data.ts` |
| 列身份与引用 | Core `field-identities.ts`、`field-references.ts`、`cartography.ts`；Desktop `field-schema-edits.ts` |
| 数据提交 | Desktop `data-save.ts`、`geojson-data-writer.ts`、`dataset-storage.ts` |
| 受管数据格式 | Core `dataset-file.ts`；独立包入口 `/dataset-file`；Desktop `import-parser.ts`、`vite.config.ts`具体别名 |
| 工程打开/资源引用 | Desktop `project-session.ts`、`project-io.ts`、`project-resource-references.ts`、`dataset-reference-load.ts` |
| 原生文件发布 | `apps/desktop/src-tauri/src/atomic_file.rs`、`lib.rs`；Desktop `files.ts` |
| 待迁移的保存/关闭/恢复 | `project-save.ts`、`recovery-tracking.ts`、`project-recovery.ts`、`app/App.tsx`、`app/header/native-window.ts`、`WindowControls.tsx`、`features/project/UnsavedProjectDialog.tsx` |

### Provider、历史与字段

- `RuntimeFeatureData` 是唯一实际 `featureData`；每源拥有原始 MemoryFeatureProvider 和 FeatureEditBuffer，兼容全行缓存仍存在。
- 修改先进入 overlay；写入失败、冲突、预写取消保留原始源和 pending；成功持久化确认后才发布源版本并清缓冲。
- 只有一套 Application EditHistory。支持数据/配置组合、锁定/源代次预检；配置上下文不能读取或改写 FeatureStore。
- 提交前预检，成功后以一次性 receipt 重基两条历史分支，保留独立配置和其他源数据；未知混合命令需显式契约。
- 已覆盖字段新增/计算/显式改名/删除、混合模式快照、创建/导入/删除、跨工程同 datasetId 的源隔离，以及批次中的资源帧保留。
- 列身份是运行时身份：显式改名保留，删除重加同名列获得新身份。普通结构快照不按值相似度猜测改名。
- 活动高级样式的字段删除仍严格检查；历史重基可退休依赖旧列的属性/过滤子句，分类保留fallback和独立几何条件；实际需要映射的动态字段名仍受保护。
- `runtimeResourceKeys`、schemaKey、source identity 各有用途；重建命令不能丢失原资源帧、导入选择回调或未提交源的模式帧。

### 数据文件和目标绑定

- 受管GeoJSON根标记 `webgis:dataset={version:1,coordinateCrs:'EPSG:4326'}`，字段沿用 `webgis:schema`，每要素 `webgis:metadata` 保留可移植来源信息；宿主scene映射不落盘。
- 严格读取全部成功或失败，不重生ID、不跳过坏行、不二次投影。写入拒绝JSON会省略/转换的数据值；普通GeoJSON导出接口未改成受管格式。
- VectorDataset.storage 是单独的本地目标引用，原 source/sourceCrs 保留。
- `createDatasetStorage`：先写**原始Provider**数据，再用配置历史绑定，pending不提交；已有文件拒绝覆盖。
- `bindExistingDatasetStorage`：只接纳与原始源一致的受管文件。
- `saveBoundDataset`：校验文件与原始源，再走提交编排；成功保持Project对象、configRevision和dirty不变。
- `loadDatasetReferences` 只加载**缺少**内嵌数据项的源；旧内嵌数据（含空数组）优先，避免静默丢弃旧编辑。native known-path open与picker共用加载路径；浏览器缺少本地引用时明确拒绝。
- 新文件：暂存/flush后hard-link到仍不存在的目标；不支持该发布方式的文件系统明确失败。更新仍走原atomic replace；expectedText写前比较**不是OS CAS**。

### 最新完成：独立编辑生命周期状态

- `getEditState/subscribeEdits/useFeatureEditState` 提供不可变的**活动源** pending/saving 元数据；没有第二份行或历史。
- 外层成功事务一次通知，回滚不发布，同计数编辑也有版本；未变数据集元数据引用复用。保存完成不依赖行缓存替换或全行读取。
- commit session 从写入延续到receipt消费/历史清理；之后才发布完成。完成回调新建的编辑保留为新的pending及Undo，已测。
- 数据执行/Undo/Redo在saving时预检；工具栏订阅元数据。状态/历史订阅异常不会让会话永久卡住。
- **旧数据编辑仍会设置统一dirty，关闭与恢复还没迁移。不要宣称dirty拆分完成。**

## 下一步建议（2026-11-02 晚间已推进）

### 1–4 数据生命周期与配置 Save（已实施）

见阶段 3 尾部。要点：`unsavedCount`/`retained`；v2 恢复草稿；配置 Save 嵌原始源/引用；关闭打开用 `hasUnsavedProjectWork` / `requestUnsavedWorkSave`。不要把 `pendingCount === 0` 当成全部干净。Ctrl+S 仍不提交数据。

### 5. 阶段4/5（主体已落地，门槛有边界）

阶段 4：OL Source 原地 patch。阶段 5：架构 [README.md](README.md)；10k 基线有数据；**100k/1m 未实测**。浏览器/原生全量、OS chooser、独立数据保存按钮产品化仍待签收。

## 最近验证（本次交接已复查日志）

| 验证 | 最终结果 | 证据 |
| --- | --- | --- |
| `pnpm test` | Desktop **554 passed / 5 skipped**；Core **155 passed**，其余workspace测试退出0 | `.codex-refactor-edit-lifecycle-workspace-test.log` |
| `pnpm build` | 退出0 | `.codex-refactor-edit-lifecycle-final-build.log` |
| 编辑状态/历史/目标专项 | 通过 | `.codex-refactor-edit-lifecycle-preflight-test.log` |
| 浏览器回归 | **13/13**，41.4s | `.codex-refactor-edit-lifecycle-browser.log` |
| 原生数据文件场景 | **5/5**，真实IPC/字节/进程重启/再次保存；错误字段为空 | `.codex-refactor-edit-lifecycle-native.log`；`.artifacts/native-resources-1793600193367/report.json` |
| 原子文件模块 | **8 passed / 1 ignored**（子进程测试入口） | `.codex-refactor-storage-create-native-test.log` |

证据边界：没有截图；浏览器行为不等于原生磁盘或视觉验收。最新native使用独立app/profile、自有路径和reference-only迁移样本；**OS picker、数据保存UI、125%缩放、GPU/视觉质量不在本批签收范围**。自有PID34660/34364与Vite13335/5196已停止，默认Rust构建配置恢复；交接时再次检查端口均无监听。

## 复验命令与操作约束

普通检查：

```powershell
pnpm test
pnpm build
git diff --check
```

浏览器先等构建完成、确认5196空闲，再自行启动并保留进程句柄：

```powershell
pnpm --filter @desktop-webgis/desktop dev --port 5196 --strictPort
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE='C:/Program Files/Google/Chrome/Application/chrome.exe'
pnpm --filter @desktop-webgis/desktop exec playwright test --config ../../.artifacts/refactor/playwright.runtime.config.mjs field-identity.e2e.ts history-preflight.e2e.ts field-schema.e2e.ts --grep 'field identities|typed empty|managed GeoJSON|field-add commit|toolbar undo|public root|projection control|project replacement|mixed snapshot|mixed schema|resource schema|historical advanced|public local'
```

该config为本地辅助文件，截图/trace关闭、单desktop项目、无自动webServer。不要误跑 `field-schema.e2e.ts` 的旧首项：有过期选择器和显式截图；上面的grep有意不选它。

原生：

```powershell
pnpm --filter @desktop-webgis/desktop test:native-dataset-storage
```

使用现有隔离harness，通常需允许访问本机Rust缓存；只清理自己的PID/端口/profile，保留用户进程。脚本最后恢复默认Rust配置，必须等终态和报告再继续构建/启动另一运行时。不要并行跑全量单测、构建和浏览器，已有CPU/模块加载争用导致假超时的历史。

根AGENTS的长任务约束仍适用：空 `write_stdin` 和 `functions.wait` 的等待不少于180000ms；outer `functions.exec` 至少比最长nested wait多30000ms。常用poll：outer210000/nested180000。未确认旧句柄终止，不重启同一任务。

## 给新agent的起始消息

> 请在 D:\my-code-repo\my-web-gis 的现有完整dirty工作区接手。先读 docs/architecture/refactor-handoff-2026-11-02.md 和 refactor-plan-v1.md，继续完整阶段0–5，不缩小目标。当前阶段2/3未完成，最新验证是Desktop554/Core155、浏览器13/13、原生数据5/5。先处理活动与保留源的未保存数据检查、恢复和dirty/关闭迁移，别直接删除旧dirty保护。保留原有UI改动和所有未跟踪实现；无提交/推送授权。先核对实际工作区和日志再改动。

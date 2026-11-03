# 阶段 3：Provider 与 EditBuffer（进行中）

## 2026-11-01 Core 基础层

`packages/gis-core/src/feature-provider.ts` 新增运行时 FeatureProvider 契约、MemoryFeatureProvider 和每数据集一个 FeatureEditBuffer。数据集定义仍属于 Project，Provider 不写入序列化配置。现有桌面 featureData 尚未切换，工程 Save 仍为旧完整快照语义；此批不等于阶段 2/3 的保存边界验收。

MemoryFeatureProvider 持有原始行，提供 detached 按 ID/范围/字段过滤/偏移分页读取、能力与生命周期。内存批提交先验证 ID 唯一性、存在性、版本和取消，再发布新索引；无变化不增加版本。事务原子性只适用于本内存实现，不承诺 GeoJSON 文件原位写入、WFS 或其他远端源可写。

FeatureEditBuffer 只记录变化 ID 的 before/after，生成 insert/update/delete 批次；A→B→A、插入后删除可抵消。查询读取完整 Provider 分页，覆盖增量后再做范围、字段过滤和分页，避免漏掉从范围外移入的行；同 ID 不按 Layer 复制。返回的行和待提交批次均为独立副本。保存中禁止其他写入/放弃，提交成功才清空 Buffer；失败、取消、外部版本冲突保留待提交编辑。没有另建 Undo 系统，后续必须接入已有 Application 历史。

当前范围查询是要素包围盒相交，不是精确几何相交。有效查询为正确性先物化全部 Provider 行，不能宣称范围索引、增量地图或百万级性能。版本为数据集整体版本，外部并发变化保守冲突；尚未实现逐行合并、文件原子替换、恢复日志或跨进程提交。

## 待接入的完整垂直切片

1. 在 projectSession 打开/创建/删除/恢复时建立唯一 Provider/Buffer 所有权，完整接收旧 featuresByDataset 的本地修改，保证切换失败不丢数据。
2. 将已有命令、地图、属性表、查询接到同一有效视图，保持唯一历史与数据事务回滚；数据保存只清理该次数据历史，保留配置历史。
3. 为内存/本地 GeoJSON 建立可持久数据源与明确数据保存入口。文件使用安全提交或明确导出流程；只读源继续显示真实能力。
4. 拆分配置 dirty 与待提交数据状态。Ctrl+S 不隐式提交 Buffer；结束编辑/关闭工程走保存、放弃、取消。保存并发、epoch 与恢复草稿必须覆盖待提交编辑，不能只改标志。
5. 完成打开→选择→几何/属性→Undo/Redo→数据保存→重开、共享 Layer、失败重试和崩溃恢复的浏览器及原生证据，再按阶段 4/5 优化同步与大数据。

本批新增 7 项 Core 测试，覆盖来源隔离/抵消、跨范围移动与过滤分页、原子失败及外部冲突、保存失败重试、取消/释放、多页源、保存并发和批次副本。证据日志：.codex-refactor-provider-verified-test.log、.codex-refactor-provider-verified-build.log、.codex-refactor-provider-desktop-types.log。未新增 UI，也未运行浏览器/原生验收；阶段 3 未完成。


## 2026-11-01：同步编辑事务适配

已加载内存源实现 LoadedFeatureProvider.getLoadedById；FeatureEditBuffer 提供 getLoadedById/putLoaded/removeLoaded 与同步 transaction。异步源没有该能力时明确拒绝同步编辑，不把 Promise 混进现有 EditCommand。修改原始 Provider 仍只能通过异步 save/commit。

Buffer transaction 为触及的 delta 记录逆操作，失败还原 before/after、增量抵消及插入顺序，支持嵌套边界；没有复制完整数据集，也没有新增用户历史。同步事务中拒绝 save/discard 和异步写入；显式 async 回调在执行前被拒绝，返回 thenable 的普通回调被拒绝并回滚同步部分。调用方仍不得调度脱离回调生命周期的外部异步副作用。Provider 释放后，旧 Buffer 也拒绝修改。

新增三项测试，包括通过测试适配器将现有 UpdateGeometryCommand 和唯一 EditHistory 接到 loaded overlay，验证执行/Undo/Redo、失败不前进历史；还覆盖嵌套回滚、顺序恢复、异步和生命周期边界。此适配器仅存在测试中，桌面 featureData 尚未迁移，不能宣称真实桌面已采用 Buffer。Core 129 项测试、Core 构建及 Desktop tsc 通过，日志为 .codex-refactor-provider-sync-verified-test.log、.codex-refactor-provider-sync-verified-build.log、.codex-refactor-provider-sync-desktop-types.log。未运行浏览器/原生。

下一步需在实际 featureData/projectSession 中引入 Provider/Buffer 所有权，区分源初始化、服务刷新和用户全数据替换，并让已有数据事务同时回滚有效缓存与 overlay；在这些边界到位前不切换 dirty/保存。


## 2026-11-01：接入实际 featureData

桌面单例已切换为 RuntimeFeatureData。每数据集持有 MemoryFeatureProvider 原始行和一个 FeatureEditBuffer；原 MemoryFeatureStore 作为过渡的不可变全行有效缓存。实际 add/update/remove 同步更新 overlay 与缓存，Application 外层数据事务失败时二者一起回滚。各数据集共享单一源/Buffer，不按 Layer 分裂。普通单行编辑只读取该 ID，不扫描全量行；初始化目前同时克隆源和缓存，不能视为内存优化。

setAll 表示源初始化/刷新，replaceEdited 表示完整用户编辑结果，后者按差异记录 insert/update/delete，保留原始源。现有 writableData.setAll 转到 replaceEdited；同工程 applySnapshotEdit 转到 replaceEffectiveSnapshot。新工程 epoch 的 replaceAll 创建全新源，即使重用数据集 ID 也不串数据；失败加载还原旧源、overlay 和缓存。源刷新发现待提交编辑会拒绝，避免静默丢弃；服务只读权限仍由原有 Application 种类/锁定检查负责，内部内存缓存不代表远端源可回写。

删除保留被移除会话用于 Undo，匹配行恢复时复用原 Provider/Buffer，保留其待提交变化；清空唯一历史时释放被移除的源。暂存删除会保留完整删除行用于恢复匹配，有额外内存成本。普通创建/删除/数据命令仍使用原唯一历史。Buffer 的单 ID rollback token 仅供同步 Application 事务逆序消费，不是额外用户 Undo。

新增 5 项 Runtime/Application 测试覆盖真实 featureCommands→overlay→Undo/Redo、原始源不变、删除撤销恢复待提交编辑、事务/新源创建失败一起回滚、全替换增量抵消、新 epoch 和失败加载、拒绝覆盖待提交编辑的刷新。浏览器历史用例直接读取原始源、pending 数和实际 OL 属性值，断言数据编辑后的原始值仍为 1、有效值为 2、Undo pending=0、Redo pending=1。

全仓 pnpm test、pnpm build 退出 0（Desktop 86 文件 / 481 passed / 5 skipped，Core 129 passed）；浏览器表格、锁定/历史/排序/投影、共享删除 7/7 passed（18.7s），截图关闭，自有 Vite 已停止。最后补充刷新保护后 Desktop 482 passed / 5 skipped，tsc 通过。证据日志：.codex-refactor-runtime-final-workspace-test.log、.codex-refactor-runtime-workspace-build.log、.codex-refactor-runtime-browser.log、.codex-refactor-runtime-protected-refresh-test.log、.codex-refactor-runtime-final-types.log。本批未跑原生。

仍未完成：工程 Save 继续序列化完整有效快照且不清 Buffer，dirty 仍为既有统一语义；不能将 Provider 隔离解释为工程/数据保存已经分离。跨工程 replaceSnapshot/Undo 目前按快照建立新源，会丢失此前源与 Buffer 的原始分界（有效数据仍在）；接入待提交 UI/数据保存之前必须把这些运行时会话也纳入替换历史恢复。字段模式提交、真实 GeoJSON 原子持久化、只读源 Provider 能力、恢复日志与统一异步有效查询仍未完成。继续保持阶段 2/3 进行中。


## 2026-11-01：跨工程替换历史恢复源会话

ReplaceProjectSnapshotCommand 的可选宿主回调携带命令对象及 before/after 方向作为运行时资源键，不写入 Project 或工程 JSON。RuntimeFeatureData 按既有替换命令保留源/Buffer 会话；Undo/Redo 恢复其会话再物化兼容缓存，复用数据集 ID 也不会把有效编辑行误当原始行。失败回滚恢复资源帧及旧缓存，可继续重试。

这些 Map 仅保存现有历史命令持有的运行时资源，没有第二套操作栈。EditHistory 提供独立的命令引用列表，Application 发布历史时按仍保留的命令（包含组合命令内部对象）释放废弃分支的源；清空历史也释放旧工程资源，但保留当前有效源和待提交变化。源会话仍按整个数据集持有，暂不代表按范围加载或大数据内存验收。

新增 3 项测试覆盖跨工程同 ID 的原始/有效行与 pending 边界、嵌套数据事务中替换失败后的重试、废弃重做分支的源释放。Runtime/Application 专项 8 passed。全仓测试退出 0（最后全仓 Desktop 484 passed / 5 skipped，Core 129 passed；随后新增资源释放测试单独通过），全仓构建退出 0。日志：.codex-refactor-runtime-frames-workspace-test.log、.codex-refactor-runtime-frames-workspace-build.log、.codex-refactor-runtime-frames-final-owner-test.log。

浏览器历史与 Scene 文档流程 10/10 passed（16.7s）：真实地图显示新工程值 20/源值20/pending0；撤销替换显示旧有效值9/源值1/pending1；重做再次恢复20/20/0。包含锁定、图层顺序、投影、远程导入成功/失败/取消、样式与导出回归。日志 .codex-refactor-runtime-frames-browser.log。截图关闭，自有 Vite 已停止；本批未跑原生。

上一节所述跨工程替换 Undo 丢失源/Buffer 分界的问题已由本批修复。下一步仍须实现可持久化的独立数据提交、成功后仅清理相应数据历史、配置 dirty/数据 pending 分离，以及关闭确认和恢复草稿。当前工程 Save 仍为旧完整快照语义，阶段 2/3 均未完成。


## 2026-11-01：持久化确认后发布数据基线

MemoryFeatureProvider 新增可选 PersistFeatureRows 适配器。提交先校验并构造候选索引，等待适配器确认持久化，才发布原始行/版本；失败不清 Buffer，不更新源。持久化进行中拒绝并发提交与释放；向适配器传递独立副本，适配器修改输入不污染源。确认成功是提交点，之后发生的取消不能撤销已经完成的写入。

实际 RuntimeFeatureData.saveDataset 绑定一次写入适配器并调用既有 Buffer.save；成功保留有效缓存的对象与 data revision，避免保存本身替换 OL Source。数据写入期间暂时阻止数据事务及源切换/释放，配置操作仍走独立配置路径。projectSession.loadSnapshot 在重置 UI 或历史之前检查数据提交忙状态，避免半切换。

内部 createGeoJsonDataWriter 使用既有 files.writeTextFile→原生 write_text_path→atomic_file 临时文件/替换路径，输出规范的 GeoJSON（内部坐标应为 WGS84），目标必须显式传入，当前未绑定原导入文件、未开放用户按钮。可选 expectedText 检测写入前的外部修改，并在成功后更新预期内容；这是写前比较，不是 OS compare-and-swap，仍存在外部程序在比较与替换间改写的窗口。不能据此声称完整文件版本冲突保证。函数级测试使用文件适配器替身，本批未在真实原生文件系统验证新提交链路。

新增 Core 持久化确认/并发/释放隔离测试及 3 项桌面写入测试：失败保留源与 pending 后可重试、预写取消/外部变化不发布、写入中阻止编辑/替换、确认成功后的迟到取消仍视为提交成功。全仓测试通过（Desktop 488 passed / 5 skipped，Core 随后补充复验 130 passed）；首次构建只因新测试坐标数组类型失败，已添加 GisFeature 返回类型并重跑。日志：.codex-refactor-data-save-workspace-test.log、.codex-refactor-data-save-final-core-test.log、.codex-refactor-data-save-final-workspace-build.log。

尚未开放数据保存 UI：必须先完成成功提交后的数据历史处理（保留配置历史及跨数据集批次正确性）、保存目标绑定的持久化/重开、独立 dirty/pending 订阅、关闭确认与恢复。当前工程 Save 仍写完整有效快照，不能声称工程/数据保存分离已完成；新链路尚无浏览器或原生验收。继续按完整计划推进。


## 2026-11-01：纯行提交历史边界与已提交源重放

内置新增/删除要素、几何/共享顶点、属性命令标记 dataOnly，Application 在首次执行时将命令绑定到源会话 identity，而非仅 datasetId；禁止把同一命令对象重复绑定到另一源。既有 EditHistory.rewrite 先准备两条分支再整体替换，不执行命令或建立第二套栈。clearCommittedRows 仅清理指定源的纯行命令，保留配置及其他数据集命令；组合命令只去掉已提交的子项，未提交部分仍在唯一历史中 Undo/Redo。

RuntimeFeatureData.saveDataset 只有非空且成功发布的数据提交才返回一次性 DatasetCommitReceipt。凭据由本运行时登记，校验源 identity、源 revision、有效数据 revision 和 pending=0；空保存无凭据，伪造、重复或之后发生数据编辑/切换的旧凭据均不能清理历史。清理完成才消费凭据，避免粗暴 clear 丢失配置或其他源历史。

同时修复旧快照重放覆盖已提交行：恢复工程资源帧时，从所保留 Provider+Buffer 的同步有效行重建兼容缓存；不以替换命令的旧行副本覆盖当前已提交版本。图层创建撤销后再重做，如果保留源已有成功提交且无 pending，也恢复其当前源会话，而非初始行。新增完整行读取仅用于这些生命周期恢复，不能作为单行编辑或大规模查询的成本证明。

新增两项已提交源重放测试与四项实际 Application 历史测试，覆盖配置历史保留、其他源历史、跨数据集子命令拆分、跨工程同 datasetId 的源身份、空/过期/重复凭据。专项 17 passed；全仓测试退出 0，Desktop 88 文件 / 494 passed / 5 skipped，Core 130 passed；全仓构建退出 0。证据日志：.codex-refactor-data-history-test.log、.codex-refactor-data-history-workspace-test.log、.codex-refactor-data-history-workspace-build.log。未新增用户界面，本批无浏览器/原生验收。

这是内部纯行提交边界，尚不允许将所有 data-scope 命令粗略视为纯行。混合配置/行快照、字段模式命令、未声明语义的自定义命令，以及单个命令跨多个源的提交历史仍需明确支持；目前多源子命令组合可拆分，单个多源纯行命令会拒绝单源清理。后续 UI 保存编排必须在持久化前处理这些情况，不能写完文件才发现清理不支持。保存目标绑定的持久化/重开、dirty/pending 订阅、关闭确认和恢复日志继续未完成。阶段 2/3 保持进行中。


## 2026-11-01：混合快照重基与提交前预检

ApplyProjectSnapshotEditCommand 在构造时记录既有数据集行变化，并实现 rebaseDataCommit：把已提交数据集的 before/after 行统一到本次有效提交值，保留独立配置及其他数据集变化。只剩独立配置时转换为既有 ApplyProjectConfigurationCommand；没有剩余变化时移除历史项。字段定义同时变化会明确拒绝，不能假装为普通行重基。

新增内部 commitDatasetEdits 编排：校验当前工作区、数据集种类和共享锁定，先 prepareDataCommit 验证整条相关历史，再调用 Provider 持久化，最后凭收据清理/重基历史。空提交不产生历史清理。此入口不由工程 Save 调用，也未开放保存数据 UI。

上下文行写入会记录命令所用的源会话身份，包括没有声明 targets 的自定义命令；无法分类的相关命令在持久化之前拒绝。旧源被刷新成新会话后，旧数据命令不能重放，组合历史也递归检查。未知子命令与数据写入混合的批次保守拒绝，需显式提交契约。现有 SetDatasetContentCommand/字段重命名联动仍需数据模式持久化支持，本批只验证提交前拒绝且文件适配器不被调用，不将拒绝算成该功能完成。

新增 4 项历史测试覆盖行+配置混合快照、两个数据集依次提交、字段模式写前拒绝、未知自定义写入与旧源重放保护。全仓 pnpm test/pnpm build 退出 0：Desktop 88 文件 / 498 passed / 5 skipped，Core 130 passed。证据 .codex-refactor-mixed-commit-workspace-test.log、.codex-refactor-mixed-commit-workspace-build.log。

浏览器 history-preflight 6/6 passed（10.6s）。新用例通过内部编排加测试持久化回调，验证真实 OL 属性值保持9、Provider源值9/pending0，而 Undo/Redo 只改变图层名称。这里没有原生文件写入，不能解释为保存目标重开或磁盘原子性证据。日志 .codex-refactor-mixed-commit-browser.log；截图关闭，自有 Vite 已停止。

仍需完成字段模式与引用联动的提交/历史契约、源目标绑定及重开、独立 dirty/pending 订阅、关闭确认、异常恢复和原生纵向验证。混合快照历史仍有全行比较/克隆，提交准备也会物化行；阶段 4/5 性能要求尚未验收。完整阶段 0–5 目标保持进行中，未提交/推送。


## 2026-11-02：原始/待提交字段模式与 GeoJSON 往返

Provider 现在拥有原始 DatasetField 定义；Buffer 独立记录待提交模式，与行 delta 一起抵消、事务回滚和提交。schema-only 编辑也可形成非空批次，提交失败保留原始模式与待提交模式；只有持久化适配器确认后才更新源模式/版本。pendingCount 现在是行变化数加模式变化项，不是单纯的受影响行数。定义校验覆盖名称、类型、可空性及重复列，源数据值约束仍需结合现有编辑校验继续完善。

实际 projectSession/数据上下文把字段定义传入初始化与增量替换，明确区分源模式和待提交模式。缺少行缓存的本地 vector 空数据集初始化为空源，保留声明列。新工程模式和 ID 校验在清理 UI/历史之前完成，非法模式不会破坏旧工程、选择或 Buffer。WFS 等服务的真实 Provider 能力仍未落地，内部内存缓存不代表远端可写。

GeoJSON 数据写入器支持版本化 foreign member：webgis:schema={version:1,fields:[...]}。读写保留空数据集/全空列的声明类型与 nullable，不靠当前值重新猜类型。未知版本/字段结构明确拒绝。普通 GeoJSON 没有该成员时仍按原行为读取。worker 导入传递 ImportLayerResult.fields，local import 将它还原至数据集定义及 Provider 基线。标准几何、属性、要素 ID 按既有 GeoJSON 序列化，运行时 provenance/内部 feature metadata 的持久化契约仍须在源目标绑定迁移时处理。

同工程快照的 schema-only 变化现在也被标为相关数据操作，不能绕过提交预检。SetDatasetContentCommand 与字段重命名/删除引用联动仍受保护：旧配置历史中可能含旧字段名，需要先完成模式感知的历史重基，不能只清理该命令后留下失效引用。保存数据 UI 继续未开放，字段模式进入 Buffer 不等于完整字段提交流程已完成。

新增 Core 模式提交/抵消/失败/事务测试，实际写入器→解析器的空数据模式往返测试、schema-only 预检，以及加载失败状态保护。最后全仓 pnpm test/pnpm build 退出0：Desktop 500 passed / 5 skipped，Core132 passed；随后新增加载失败测试的 owner 专项11 passed。首轮桌面仅有旧 pending=1 断言失败，因现在同时包含行和模式两项变化，已改为2并断言源模式不变及 Undo 模式抵消。日志：.codex-refactor-source-schema-final-workspace-test.log、.codex-refactor-source-schema-final-workspace-build.log、.codex-refactor-source-schema-final-owner-test.log、.codex-refactor-source-schema-roundtrip-test.log。

浏览器新增空模式用例1/1 passed（4.7s），真实 worker、Application 与属性表展示两个声明列，验证原始模式/有效模式一致、零行及 pending0。日志 .codex-refactor-source-schema-browser.log；截图关闭，自有 Vite 已停止。这里只验证导入/表格行为及文件适配器替身往返，尚无新原生磁盘提交验收。

后续继续：字段模式提交后的历史引用重基、保存目标绑定/读取/重开、配置 dirty 与数据 pending 订阅、关闭确认与恢复、真实文件并发版本保护，以及阶段4/5增量和大数据证据。当前内存模式/全行兼容读取不是这些要求的替代，完整目标保持 active。


## 2026-11-02：名称保留的字段操作提交

SetDatasetContentCommand 可在提交后结束新增字段、字段计算和名称不变的模式/类型编辑历史；前提是未移除既有字段名，且没有无法归类的独立图层配置差异。重命名、删除及混合引用修改仍在持久化前拒绝，不能通过丢弃整条命令回避历史重基。

同工程快照也可提交名称保留的字段声明；重基时将 before/after 的字段定义与行同时归到本次提交结果，保留独立配置差异。只剩模式声明/数据时移除历史项。Provider 对声明的标量类型、有限数值及非空约束在持久化前校验，失败保留原始源和 Buffer；尚未代替完整几何/JSON 值约束验证。

新增实际字段新增、计算器及标量/非空约束测试：新增 code='001' 与列定义一起提交，独立图层改名仍可撤销；计算器 value*3 的实际输出可提交并结束数据历史；空或非法类型在调用适配器前失败。名称不变的模式声明现在由成功提交测试覆盖，原重命名/删除拒绝测试继续保留。

全仓测试/构建退出0，Desktop 502 passed / 5 skipped、Core133 passed；随后计算器新增测试在 history 专项11 passed。证据：.codex-refactor-field-add-commit-workspace-test.log、.codex-refactor-field-add-commit-workspace-build.log、.codex-refactor-field-add-commit-final-history-test.log。

浏览器2/2 passed（5.4s）：空类型列 worker 导入，以及真实字段管理新增 externalId='0007'/nullable=false 后调用内部数据提交，确认原始源/表格保留字符串及类型、独立配置 Undo 不删除新列。持久化为测试回调，不能当成原生文件证据。首轮测试仅因旧按钮名“字段列表”超时，改用当前“列显示与字段管理”并复验，未改产品 UI。日志 .codex-refactor-field-add-commit-final-browser.log，截图关闭，自有 Vite 已停止。

继续处理重命名/删除：不能把所有旧字段字符串全局替换。历史配置需要按源会话及命令当时的字段命名状态绑定，兼顾已执行与重做分支、同名字段删除后重加、跨工程同 datasetId、literal 文本不变及高级表达式既有保护。随后仍需完成保存目标绑定/重开、dirty 与 pending 分离、关闭/恢复和真实原生纵向验证。当前内部支持范围扩大，不表示阶段2/3或完整目标已经完成；未开放保存数据 UI，未提交/推送。

## 2026-11-02：运行时列身份与模式事务回滚

Provider/Buffer 现在分别保存原始与有效字段的逻辑身份，真实 SetDatasetContentCommand 沿用唯一 Application 历史传递命令身份及方向。重命名保留列身份；删除后重加同名列分配新身份；删除 right 后将 left 改为 right 时，现有 right 仍属于原 left，不能误认为原 right。Undo/Redo 恢复对应身份，失败事务也撤销命令身份帧，允许重试；没有新增用户历史栈。

同工程快照按实际变化的数据集记录身份帧，并以声明字段和有效行属性确定最终名称；隐式属性的新增、移除均可 Undo/Redo。普通源刷新按同名列延续逻辑身份，同时替换行历史使用的源代次；新工程仍分配新命名空间。读取字段命名空间只读取元数据，不物化全行。行变更的身份回滚保留不可变 Map 引用，避免每个行 delta 复制整张身份表；快照替换本身依然有全行扫描和克隆。

身份仅存在于运行时，未写入 Project 或 GeoJSON，也未形成跨应用重开的稳定列标识。身份变更与行/模式一起等待持久化确认；同名列替换即使最终行值和字段定义相同也保留 pending。失败写入保留旧源身份与待提交身份，成功重试才发布。配置 scope 现在拒绝绕过数据事务修改已有数据集字段定义。

新增 Core 两项事务/提交测试和 Desktop 七项真实历史测试，覆盖同名冲突、刷新、元数据读取成本、事务失败、快照属性增删、配置绕过保护。全仓测试退出0：Desktop 510 passed / 5 skipped、Core135 passed；全仓构建退出0。首次构建发现新增测试缺少 ProjectEditContext 标注，修正后通过。证据：.codex-refactor-field-identity-snapshot-workspace-test.log、.codex-refactor-field-identity-snapshot-workspace-build.log。

本批尚未改动重命名/删除的数据提交预检。列身份是后续历史引用重基的依据；仍需按命令当时的命名空间同时映射样式、过滤、弹窗等引用，不能顺序执行字符串替换，也不能把所有历史中的同名文本当字段。重命名/删除提交、保存目标绑定及重开、dirty/pending 分离、关闭和恢复继续未完成；阶段2/3及完整0–5目标保持进行中。

浏览器最终7/7 passed（23.3s）：新增实际导入/字段管理删除 right、left→right、工具栏 Undo/Redo 用例，核对列身份和真实 OL 要素值；既有历史预检六项同时通过。日志 .codex-refactor-field-identity-final-browser.log，截图/trace关闭，自有 Vite 已停止。无新增原生磁盘或视觉验收，未提交/推送。

## 2026-11-02：集中字段引用映射，避免级联替换

新增 Core getFieldNameChanges：按列身份建立旧名称到当前名称的映射，明确区分无变化与已删除。同名新列不会复活旧列引用。remapLayerFieldReferences 同时处理过滤、分类样式、标注和弹窗；例如旧 left→right、旧 right→删除，在一次遍历中完成，不会把刚映射成 right 的原 left 再删除。分类字段删除沿用现有 fallback；过滤值、类别值、弹窗标签等显示内容保持原值。

标准样式引用也集中为 remapCartographyFieldReferences，真实字段编辑已使用此实现，前端不再另存一套配置引用变换。静态 get/has、标准/旧式过滤、分类元数据按同一映射处理；literal 数组、普通显示文本、指定对象的局部属性名保持原值。动态 feature-property 字段名和仍引用删除列的高级表达式继续拒绝；只存在分类元数据引用也会拒绝删除，避免元数据留下悬空字段。没有放宽现有高级样式保护。

新增三项 Core 测试覆盖身份匹配、同名冲突、同时交换、删除回退、literal/对象局部键、输入不可变与动态字段保护。全仓 pnpm test / pnpm build 退出0：Desktop510 passed / 5 skipped，Core138 passed。浏览器9/9 passed（30.0s），实际字段管理用例新增图层过滤随重命名和 Undo 恢复的断言，同时复验空类型列 worker 导入、字段新增提交及六项历史预检。证据：.codex-refactor-field-reference-workspace-test.log、.codex-refactor-field-reference-workspace-build.log、.codex-refactor-field-reference-browser.log；git diff --check 退出0。截图/trace关闭，自有 Vite 已停止，无新增原生/视觉验收。

尚未将历史配置命令绑定到操作当时的命名空间，也未放开重命名/删除的数据提交。下一步须在提交预检中重基两条历史分支的命令 memento，保留独立配置和其他数据集，并核对批次、合并、跨工程替换及多次提交。公共映射本身不是该历史契约的完成证据。保存绑定/重开、dirty/pending 分离、关闭/恢复和阶段4/5仍未完成；完整目标保持 active，未提交/推送。

## 2026-11-02：已有源字段提交与配置历史重基

Application 现在记录每条命令执行前后的逻辑字段命名空间和图层归属；批次分别记录子命令，不以最终名称反推中间状态。成功提交时按列身份计算两侧映射。Core 新增 detached rebaseFieldReferences 契约，基础过滤、旧样式、标准样式、图层树和配置草稿生成新的历史 memento，显隐、不透明度和初始视角明确不包含字段引用。合并样式保留原始 before 和最新 after，提交后的新命令不再与提交前手势合并。

真实 SetDatasetContentCommand 可结束显式字段重命名、删除历史：须先证明两侧引用映射后没有独立图层或标准样式差异；行、字段和身份统一到已提交源。保留的配置历史同时重基 Undo/Redo 两条分支。生成的旧样式片段与旧编辑器配置使用相同 fallback/标注删除规则；显式高级样式仍使用静态引用映射和原有拒绝保护。对象键插入顺序不影响结构相等判断，避免语义相同的 before/after 被 JSON 文本顺序误判。

beginDataCommit 在存在历史字段名称变化时暂时禁止历史执行、Undo/Redo 和清空，并发布阻止原因；持久化成功或失败后解除。这样异步写入期间不会出现未经预检的新历史，避免落盘后才发现不能清理。纯行提交继续允许独立配置编辑。失败不替换原历史或源/Buffer，重试和原始 Undo 仍可用。

新增8项实际 Application 测试，覆盖旧过滤/树配置重放、同名复用、重做分支、多次提交、合并样式、标准表达式 literal、生成分类/标注、写入失败及写入期间历史保护、未知配置和创建历史的写前拒绝。全仓测试退出0：Desktop518 passed / 5 skipped、Core138 passed；全仓构建退出0。首次构建因新增测试索引可选 layout 失败，修正为直接断言 layout 后复验通过。日志 .codex-refactor-history-fields-workspace-test.log、.codex-refactor-history-fields-final-workspace-build.log。

浏览器9/9 passed（30.4s）：实际字段管理删除 right、left→right、Undo/Redo 后调用内部提交，之后工具栏只撤销/重做过滤，原始源和真实 OL 要素保持 right=1/pending0。用例明确清除导入历史以建立已有源基线；不据此声称创建/导入重放已经支持。持久化为测试回调，无原生磁盘证据。日志 .codex-refactor-history-fields-browser.log，截图/trace关闭，自有 Vite 已停止。

当前仍会写前拒绝含相关数据集创建/导入或不支持的生命周期历史、未声明字段契约的自定义配置，以及无法证明安全的混合模式快照和高级删除引用。需继续补齐这些命令的资源身份、行、字段及 UI follow-up 保留，不能改成清空历史。保存目标绑定/重开、独立 dirty/pending、关闭和恢复、阶段4/5性能与纵向验证仍未完成。未开放数据保存 UI，完整阶段0–5保持进行中，未提交/推送。

## 2026-11-02：创建、导入和删除生命周期提交重基

新增 rebaseDatasetLifecycleCommit 契约，添加图层、删除内容和同工程快照在提交后保留自身的生命周期操作，同时将所拥有源的恢复行、字段定义和引用归到已提交版本。创建侧只更新存在该数据集的快照，不在原先不存在的一侧伪造空数据集或行。该重基即使没有旧字段名称变化也会执行，避免字段新增/声明等提交后，旧创建 memento 恢复过期字段定义。旧数据代次的行命令不能借此绕过原有源会话检查。

ImportLocalLayersCommand 通过 recreate 保留命令 ID、前置选择和 execute/undo 的 afterCommit 回调；Application 添加图层的选择包装也转发生命周期重基并包装返回的新命令。首轮专项因此发现添加图层的匿名包装未转发新契约，补齐后复验通过。没有通过换成 Core 基类而丢失原有 UI 行为。

同工程混合快照使用独立且稳定的 schemaKey，在部分源提交而重建命令后沿用原 Buffer 字段身份帧。标识不引用旧命令，避免为保存该帧而额外保留旧快照对象。新测试在提交 A 后立刻 Undo/Redo 未提交 B，确认 B 的隐式字段身份正确恢复，A 的已提交行不变。

原创建历史拒绝测试已改为成功提交后的真实添加撤销/重做测试；另新增4项覆盖多图层导入选择恢复、另一个源 pending 保留、两个源依次提交后导入重放、已撤销删除命令的 redo/undo，以及部分提交后的原模式帧。字段历史专项12 passed；全仓测试退出0：Desktop522 passed / 5 skipped、Core138 passed；全仓构建退出0。证据：.codex-refactor-schema-lifecycle-multiple-commit-test.log、.codex-refactor-schema-lifecycle-workspace-test.log、.codex-refactor-schema-lifecycle-workspace-build.log。

浏览器9/9 passed（31.0s），field-identity 用例取消清空导入历史，完整保留真实导入命令，经 UI 删除 right、left→right、Undo/Redo 和内部提交后，再 Undo/Redo 导入，核对列身份、有效行与真实 OL 要素 right=1/pending0。此证据取代上一批“已有源基线”的浏览器限制。持久化仍为测试回调，不代表原生磁盘保存或保存目标重开。日志 .codex-refactor-schema-lifecycle-browser.log；截图/trace关闭，自有 Vite 已停止。

前一条记录中创建/导入历史的一般拒绝限制已由上述显式契约替代；跨工程整份资源替换、不支持的混合模式变更、未知自定义命令和高级删除引用仍需逐项处理，不能推断全部历史已可提交。后续继续字段混合快照契约、保存目标绑定/重开、dirty/pending 分离、关闭与恢复、真实原生纵向和阶段4/5性能门槛。完整目标仍在进行中，未开放数据保存 UI，未提交/推送。

## 2026-11-02：混合快照字段模式提交

ApplyProjectSnapshotEditCommand.rebaseDataCommit 现在使用宿主提供的命令两侧字段身份映射，先重基各自配置引用，再将提交源的行与字段定义统一到确认版本。只有字段/数据变化时结束该历史项；仍有独立名称、样式、标注或过滤变化时保留配置命令；另一个源未提交时继续保留其模式帧和数据历史。结构比较继续忽略对象键顺序。未提供身份映射的直接调用保留原来的模式删除/改名保护。

普通快照替换不通过值相似度推断字段改名：实际移除的列会退休，新列有新身份。历史配置 Undo 不会复活已提交删除的旧字段引用；显式 SetDatasetContentCommand 重命名仍保留原列身份。高级标准表达式若仍引用退休列，映射在持久化之前拒绝，原源、pending 和历史均保留。

新增4项 Application 测试，覆盖混合字段替换后保留名称/标注/过滤 Undo、纯字段删除后无旧字段历史、两个源的模式变化依次提交及中间 Undo/Redo、已退休高级 operand 的写前拒绝。历史专项27 passed；全仓测试退出0：Desktop526 passed / 5 skipped、Core138 passed；全仓构建退出0。日志 .codex-refactor-mixed-schema-history-test.log、.codex-refactor-mixed-schema-workspace-test.log、.codex-refactor-mixed-schema-workspace-build.log。

浏览器10/10 passed（32.6s），新增混合模式用例将 value 替换为 count:number/nullable=false，内部提交后工具栏仅撤销/重做图层名称，核对真实 OL count=9、原始源9/pending0、字段定义不回退。已有真实导入历史及字段操作链路同时通过。日志 .codex-refactor-mixed-schema-browser.log，截图/trace关闭，自有 Vite 已停止。持久化为测试回调，无新增原生磁盘、目标重开或视觉验收。

仍需完成跨工程完整资源历史的字段提交重基、未声明语义的自定义混合命令，以及高级删除引用的明确处理。保存目标绑定与重开、配置 dirty/数据 pending 分离、关闭与恢复、阶段4/5增量及100k/1m门槛继续未完成。完整目标保持 active，数据保存 UI 仍未开放，未提交/推送。

## 2026-11-02：跨工程资源快照的字段提交与保留键

FieldReferenceRebase 明确携带与当前逻辑源匹配的 before/after 侧。ReplaceProjectSnapshotCommand 只重基匹配一侧的行、模式和配置引用；另一工程即使有相同 datasetId 也不更新。提交 B 后撤销回 A，可以继续保留 A 原 Provider 的待提交编辑，再单独提交 A；来回重放各自恢复其确认版本和字段定义。

完整资源替换使用独立 resourceKey，重建的命令保留原键，并通过 EditCommand.runtimeResourceKeys 声明资源寿命。Application 发布历史时递归检查批次中的资源键，避免新命令替换旧命令后误释放仍用于 Undo 的 Provider 帧。清空历史仍释放不再被使用的源，不保留无主资源。模式帧 schemaKey 与整份资源帧的键继续独立，各自服务于既有唯一历史。

新增2项 Application 测试，覆盖相同 datasetId 的 A/B 工程各自模式提交、A pending 保留、两侧各自提交后的 Undo/Redo；以及批次 A→B→C 在 C 提交后的资源重放与清空释放。断言同时检查命名空间身份、字段、源行、pending 和 Provider dispose。全仓测试/构建退出0：Desktop528 passed / 5 skipped、Core138 passed。证据 .codex-refactor-resource-schema-history-test.log、.codex-refactor-resource-schema-workspace-test.log、.codex-refactor-resource-schema-workspace-build.log。

浏览器11/11 passed（34.7s），新增跨工程资源模式提交用例：A value=9/pending1，切换同 datasetId 的 B 并提交 count=30，工具栏撤销恢复 A 的原始源1和待提交9，再重做恢复 B 的 count:number/nullable=false、原始源30/pending0及真实 OL 要素。日志 .codex-refactor-resource-schema-browser.log；截图/trace关闭，自有 Vite 已停止。持久化为测试回调，不作为原生磁盘、目标重开或视觉验收。

跨工程资源历史的上述字段重基已支持，不能据此声称保存生命周期完整。高级历史表达式依赖已删除列时仍保守拒绝，需要继续明确可恢复配置的处理；未知混合自定义命令仍要求显式契约。保存目标绑定和重开、dirty/pending 分离、关闭与恢复、原生纵向以及阶段4/5增量与大数据门槛仍未完成。完整0–5目标保持进行中，未开放数据保存 UI，未提交/推送。

## 2026-11-02：高级历史样式的退休字段依赖

当前字段编辑继续使用严格 remapCartographyFieldReferences：活动标准样式仍引用字段时，删除会拒绝，要求先调整活动样式。新增历史专用 rebaseCartographyFieldReferences，供历史 memento 使用：依赖已退休列的 paint/layout 属性移除，恢复标准默认值；all/any/none 中依赖该列的子句移除，保留其他字段、几何类型等独立条件；全部子句退休时移除整个过滤。literal 和普通显示内容不作为字段引用。

带 categorized/graduated 元数据的历史分支依赖该列时退休，保留 fallback 分支，移除过期分类元数据和过滤依赖，并同步 binding.styleLayerIds，防止所有旧分类同时绘制或出现孤立 style ID。生成的旧编辑器片段继续按原 legacy fallback 规则恢复；显式高级片段保留其 fallback 的独立属性。剩余动态字段名在确实需要映射时继续拒绝；空映射直接保留片段，纯行提交不会仅因历史包含动态字段表达式而失败。

新增3项 Core 测试，验证属性/子句退休、分类 fallback 与 binding 一致性、动态保护及空映射，包含实际 CartographyState 校验。Desktop 新增3项回归，覆盖用户先调整活动样式再删除/提交、恢复旧高级分类 fallback、跨工程资源中的纯行提交与动态样式；原混合快照高级字段拒绝用例改为成功提交后仅配置 Undo/Redo。活动样式直接删除仍拒绝的断言保留。首轮分类测试误期望移除全部过滤，已修正为保留实际独立 Point 几何条件，没有修改产品来满足错误断言。

最终全仓测试/构建退出0：Desktop531 passed / 5 skipped、Core141 passed。证据 .codex-refactor-retired-style-final-workspace-test.log、.codex-refactor-retired-style-final-workspace-build.log；Core 专项 .codex-refactor-retired-style-core-test.log。

浏览器12/12 passed（39.9s）：实际字段管理删除 value 并内部提交后，工具栏样式 Undo 恢复真实 OL 默认半径5、Redo 为4，字段和原始源不复活，pending0；已有导入、混合模式和跨工程资源链路同时通过。日志 .codex-refactor-retired-style-final-browser.log。截图/trace关闭，自有 Vite 已停止。该断言是样式函数运行结果，不代表截图、原生磁盘或视觉验收；持久化仍为测试回调。

前述对已退休静态高级历史引用的一般拒绝已由上述历史契约取代；活动引用及需要改名的动态表达式保护仍在。未知混合自定义命令仍要求显式契约。下一步继续保存目标绑定/重开、配置 dirty 与数据 pending 分离、关闭和恢复，以及阶段4/5增量与100k/1m门槛。完整目标保持进行中，未开放数据保存 UI，未提交/推送。

## 2026-11-02：受管 GeoJSON 来源元数据与严格往返

核对长期保存目标时发现原内部 GeoJSON writer 只写行、ID 和 schema，没有写 sourceId/sourceCrs/importId 等来源元数据。新增 Core dataset-file 编解码器，输出兼容 GeoJSON 的受管格式：根 webgis:dataset={version:1,coordinateCrs:'EPSG:4326'}，沿用 webgis:schema；每个要素的 webgis:metadata 保存 sourceId、overlaySourceId、sourceCrs、importId。内部 ID 保持字符串原值，来源 ID 可保持数值，原始投影来源不改变已规范化的 WGS84 坐标。sceneFeatureId/sceneMetadataPresent 继续属于宿主映射，不写入可移植数据。

createGeoJsonDataWriter 已改用受管编码器。严格读入要求已知版本、坐标约定、完整且唯一的 ID、支持的几何结构、JSON 属性和有效字段定义；不跳过坏行、不重生 ID、不将未知版本降级为普通导入。未知受管成员明确拒绝，避免读后重写时静默丢弃。写入前拒绝 JSON 会忽略或转换的 undefined/非有限数值/BigInt/函数/Date/稀疏数组/循环/访问器等属性值；失败不调用文件写入，原始 Provider 与 Buffer 保留。普通 GeoJSON 导出接口继续保持原格式。

import-parser 在普通 CRS 转换路径之前识别受管标记，直接读取规范坐标和来源元数据；重复指定非 WGS84 源投影会拒绝。新增独立 dataset-file 包入口，并补齐 Vite 具体别名，避免被根别名截走，同时保持 worker 不经 Core 根入口加载。首轮桌面专项发现缺少具体别名，补齐后通过。

新增12项 Core 测试和3项桌面 writer/导入测试，覆盖字段/来源/ID/坐标往返、空类型列、运行时元数据排除、非法 JSON、重复 ID、版本/几何损坏、写入失败保留源与 pending 后可重试。全仓测试/构建退出0：Desktop534 passed / 5 skipped、Core153 passed。证据 .codex-refactor-managed-dataset-core-test.log、.codex-refactor-managed-dataset-corrected-writer-test.log、.codex-refactor-managed-dataset-workspace-test.log、.codex-refactor-managed-dataset-workspace-build.log。

浏览器13/13 passed（41.1s）。新增真实 worker 导入用例核对稳定 ID、数值 sourceId=42、原 sourceCrs=EPSG:3857/importId、code='001'、规范坐标[116.4,39.9,7]，原始源与有效数据一致/pending0；没有再次投影。日志 .codex-refactor-managed-dataset-browser.log，截图/trace关闭，自有 Vite 已停止。writer 持久化测试仍使用文件适配器替身；没有新原生磁盘验收。

本批完成的是目标绑定所需的数据文件格式，尚未增加 Dataset 保存路径引用、打开工程时按引用加载、目标版本的原生 CAS，也没有改变工程 Save 的完整有效快照行为。不得把受管文件导入往返当成工程引用重开或两类 Save 分离的证明。继续保存目标绑定/重开、dirty/pending、关闭/恢复、原生纵向及阶段4/5门槛；完整0–5目标保持进行中，未开放数据保存 UI，未提交/推送。

## 2026-11-02：显式数据目标绑定、引用加载与原生重启

VectorDataset 新增 storage={type:'managed-geojson',reference}，引用复用既有本地 absolute/relative 资源格式，拒绝 URL、错误源种类和未知类型。原 source/sourceCrs 继续保留原导入来源。工程保存副本中的目标引用按既有规则重定位：同目录使用相对路径，跨目录/盘符保留绝对路径，不改变当前工作定义。

内部 createDatasetStorage 先将 Provider 原始行/字段写到新的目标，再通过唯一 Application 配置历史绑定；Buffer 仍为 pending，不把绑定暗当数据提交。bindExistingDatasetStorage 只接纳与当前原始源一致的受管文件。saveBoundDataset 每次检查文件与原始 Provider 的规范内容，再使用既有提交编排和 expectedText 写前检查；成功不修改工程对象、configRevision 或 dirty。源会话、原始 revision、工程 epoch 或目标在异步操作中变化会拒绝陈旧绑定；创建已确认但绑定失败时保留完整文件并明确报“已创建但尚未绑定”，可重新接纳，不自动删除文件。

新增原生 create_text_path：完整内容在目标旁暂存并 flush，再以 hard-link 发布到仍不存在的路径；已有文件或并发创建者不会被替换。暂存失败无目标，文件系统不支持此发布方式则明确失败。后续更新继续走旧 atomic replace；expectedText 仍非 OS CAS，未声称解决外部并发替换的全部竞争窗口。目标/source 配置在该源发布期间禁止修改或 Undo；失败后临时阻止不缓存为永久历史阻止。

loadDatasetReferences 在发布前加载完整引用集，任一错误不更改当前工程。只加载缺少 featuresByDataset 对应项的源；已有内嵌项（包括空数组）优先保留，以保护旧格式保存的编辑。受管文件提供实际字段定义和规范行。readSnapshotFromPath 与 native picker 共享同一验证/重定位/加载路径。浏览器缺失外部本地数据时明确要求桌面环境，仍可打开含内嵌数据的旧工程。

新增 Core 存储定义/拒绝验证和 Desktop 目标、引用打开、Save As 测试。覆盖创建原始源时保留 pending、绑定配置 Undo/Redo、保存不改配置、重开后再次提交、拒绝已有文件/外部改写、失败保留源、旧内嵌数据优先、等待期间编辑不丢失、工程切换后不回写绑定，以及发布中目标 Undo 的临时阻止。专项初次只因 Node 测试无 window 而缺少命令状态适配器替身，补齐并断言状态消息后通过；没有修改生产状态分发来绕过该环境差异。全仓测试/构建退出0：Desktop544 passed / 5 skipped、Core155 passed；浏览器13/13 passed（41.1s）。日志 .codex-refactor-storage-binding-workspace-test.log、.codex-refactor-storage-binding-workspace-build.log、.codex-refactor-storage-binding-browser.log；Rust 原子文件模块独立实盘测试8 passed / 1 ignored（abrupt-exit 子进程入口），.codex-refactor-storage-create-native-test.log。

新增 test:native-dataset-storage，复用隔离 app identifier/profile、自有 PID/端口和仓库输出目录。真实 Tauri 文件 IPC 原生5/5通过：原始源初始化且 pending 保留；拒绝覆盖已有文件；数据提交保持工程对象/configRevision/dirty；进程重启后读取相对引用，保持稳定 ID、来源、code='001'、坐标[116.4,39.9,7]；再次编辑并提交到同一绑定文件。报告 .artifacts/native-resources-1793597812520/report.json，日志 .codex-refactor-storage-binding-native.log。两次自有 app PID43992/44316、Vite端口14884均正常停止，默认 Rust 配置已恢复；截图关闭。路径由场景赋值，未测试 OS chooser、用户数据保存按钮或视觉效果。

原生重开使用明确的 reference-only 迁移样本，先沿用公开工程 Save 清除恢复草稿，再通过现有文件 IO 写无内嵌行的样本；默认 Ctrl+S/工程 Save 语义未切换。含 pending 的旧内嵌快照仍被保留，不能把它当作已完成的原始源+Buffer 恢复协议；与外部文件基线不一致时数据保存会拒绝而非覆盖。发布配置-only 默认格式前还需完成版本/迁移提示、dirty/pending 分离、关闭与恢复、目标并发策略及保存 UI。阶段4/5增量与100k/1m门槛也未完成。完整目标保持进行中，未提交/推送。

## 2026-11-02：独立编辑状态订阅与提交发布会话

RuntimeFeatureData 新增只读 FeatureEditState/getEditState/subscribeEdits 和 useFeatureEditState，状态从既有 Provider/Buffer 派生，包含活动源身份、原始 revision、pending 项和 saving，不保存第二份行或历史。外层成功数据事务只发布一次；失败回滚保持原状态对象；相同 pending 数量的连续编辑仍推进发布版本，未变化的数据集元数据对象继续复用。schema-only 操作和无行缓存变化的提交完成也能被订阅。pending 项包括行 delta 和模式项，不是“未保存行数”。

新增一次性 commit session，Application 提交从持久化开始到历史凭据消费结束持续阻止数据写入和源替换；只有唯一历史清理完成、schema 临时锁解除后，才发布完成状态。避免完成订阅回调先创建新编辑、继而让历史清理凭据失效。结束时观察者立即创建的新编辑正常留在 Buffer/历史中，可独立 Undo；不是把它误算进刚确认的提交。直接底层 Provider 保存仍有自己的开始/结束事件，应用保存走完整会话。

数据 Undo/Redo/执行在 saving 时进行元数据预检，工具栏 useEditHistory 同时订阅编辑状态，不依赖行缓存替换来刷新阻止原因。独立配置编辑继续允许；目标绑定仍使用前一批的源保护。编辑状态与历史订阅者抛错会在已发布状态之后记录诊断，不回滚已确认数据，也不会把 schema 提交锁留住；finally 无论历史释放结果如何都结束数据发布会话。

新增10项桌面测试，覆盖单次事务通知、回滚引用稳定、schema-only、同计数编辑、活动代次/删除恢复、无全行物化和无行缓存事件的保存完成、失败重试、伪造会话、观察者异常、完成回调新编辑及保存中 Undo 预检。全仓测试/最终构建退出0：Desktop554 passed / 5 skipped、Core155 passed。日志 .codex-refactor-edit-lifecycle-workspace-test.log、.codex-refactor-edit-lifecycle-final-build.log；专项 .codex-refactor-edit-lifecycle-preflight-test.log。

浏览器13/13 passed（41.4s），.codex-refactor-edit-lifecycle-browser.log；原生5/5 passed，.codex-refactor-edit-lifecycle-native.log、.artifacts/native-resources-1793600193367/report.json，新增已发布 pending/saving 元数据断言。自有 app PID34660/34364、原生 Vite13335及浏览器 Vite5196已停止，默认 Rust 配置恢复，截图关闭。仍使用已说明的路径赋值与 reference-only 迁移样本，不据此声称 OS chooser、数据保存 UI 或默认工程 Save 已迁移。

本批未移除数据编辑对旧 dirty 的设置，因为现有关闭与恢复仍依赖它。新状态描述活动源，不可直接替代跨工程历史/已移除资源中待提交编辑的完整生命周期检查。下一步须把配置 dirty、活动及保留源 pending、工程版本/原始源+Buffer 恢复和保存/放弃/取消串联验证，再切换默认保存语义；不能只把 dirty 清掉。阶段4/5增量和100k/1m门槛继续未完成。完整目标保持进行中，未开放数据保存 UI，未提交/推送。

## 2026-11-02：活动源与保留源的未保存检查

`FeatureEditState` 仍用 `datasets` / `pendingCount` / `saving` 表示当前活动源。新增 `retained` 和 `unsavedCount`：`retained` 只收录历史帧与删除墓碑里仍有 pending 的源，按 source identity 去重，不复制行，也不另建历史。同一 `datasetId` 的不同代次分开计数。`unsavedCount` 为活动 pending 与保留源 pending 之和；它为 0 才表示没有未保存要素数据。活动源已保存时，`pendingCount` 仍可为 0。

Undo/Redo 和源切换沿现有事务发布。历史裁剪与 `releaseInactive` 在没有提交会话、也没有进行中的写入时才发布；提交会话打开期间裁剪历史不提前发出完成通知，仍由 `endCommitSession` 发布最终状态。显式 `releaseHistory` 会丢掉墓碑中的 pending 并更新计数。关闭工程尚未改成调用它，旧 dirty 保护仍在。

新增测试覆盖：当前源已保存而历史源仍有 pending、多代次去重、仅模式变更、删除后恢复、显式释放历史、提交会话期间不发布，以及工程替换 Undo/Redo 和删除图层。Desktop 测试 559 passed / 5 skipped。未跑浏览器和原生。恢复协议、配置 dirty、默认工程 Save、保存/放弃/取消入口、阶段 4/5 仍未做。未提交、未推送。

## 2026-11-02：恢复协议、配置 Save、未保存入口

**恢复**：草稿升级为 version 2，`dataSessions` 记录活动源的 Provider 基线与 `FeatureEditBatch`。`FeatureEditBuffer.restorePending` / `RuntimeFeatureData.captureActiveSessions|installActiveSessions` / `projectSession.loadSnapshot(..., sessions)` 支持重开后恢复原始源+pending。v1 有效行草稿仍可读。跟踪在 dirty 或 unsaved 时写入；工程切换使用切换前缓存的 sessions。

**配置 dirty / Save**：纯数据路径不再 `setDirty`。`createConfigurationSnapshot` 对绑定源省略 features 键、对未绑定源嵌入原始行。`getProjectContentVersion` 只跟配置对象。Ctrl+S 只保存配置；有 pending 时提示“数据编辑尚未提交”，且不清理仍含 pending 的恢复草稿。

**关闭/打开**：`hasUnsavedProjectWork` = 配置 dirty ∨ unsavedCount。`requestUnsavedWorkSave` 先配置保存，再提交已绑定活动源；保留源或未绑定 pending 仍阻塞。对话框与原生关闭、beforeunload、恢复宿主已接上。标题 dirty 仍只表示配置。

Desktop 562 passed / 5 skipped；Core 156；ol-runtime 33。未跑浏览器/原生全量。阶段 4 增量与阶段 5 文档见后续记录。未提交、未推送。

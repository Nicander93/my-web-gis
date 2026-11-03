# 阶段 2：ProjectStore 收敛与配置操作统一（进行中）

基线 HEAD：`2cf4a724aadb041ac030350079851494c37802d3`。2026-10-30 启动，2026-11-01 更新；原有 UI 工作区改动保留，未提交或推送。完整目标沿用 [V1.0 合同](refactor-plan-v1.md)，此处记录已落地的边界。

## 配置操作的数据隔离

`EditCommand.scope` 显式标记配置命令；未迁移的命令仍走旧数据路径。样式、标准制图、过滤、透明度、图层树和 Cesium scene 命令标为 configuration；新增显隐命令使显隐也进入现有 Undo/Redo。

Application 编辑入口在配置上下文中暂存 Project，校验工程 ID、工作区及制图，成功后由 ProjectStore 一次发布。该上下文的所有 FeatureStore 方法、快照替换和字段编辑回调明确拒绝访问数据。最初隔离配置 Execute/Undo/Redo 后，本批已进一步删除 `syncStoreFromState` 和 `editedFeatures`；真实过滤变化先收敛 Session 中已有选择，再发布配置，样式等无过滤变化的操作不读取要素。

继续复用现有 EditHistory，没有新增另一套历史监听器。合并仅发生在相同 scope、mergeKey 的命令间；先成功执行后再吸收新的 after 状态，避免一次非法样式更新破坏上一条有效手势的 Undo/Redo。配置失败不发布暂存工程，也不新增历史。

Store 已增加 `configRevision`：受控 Project 引用变化时推进；数据/选择/dirty 确认不推进，Undo/Redo 各算一次配置变化，载入工程以新 epoch 将配置版本归零。原有 contentVersion 保存保护继续同时订阅配置和数据会话，尚未将统一 dirty 错当成配置 dirty。

## 选择状态所有权

`selectedLayerId`、`selection`、`lastSelectionCountAfterFilter` 已从 ProjectState 删除，由既有 SessionStore 单独持有。UI、地图工具、属性表、导出、处理命令和测试探针均从 Session 读取，没有保留 Project 中的镜像或代理字段。浏览图层直接调用 Session action；要素选择的设置/增减/匹配/清空由 Application `selectionCommands` 按有效过滤结果验证。这些方法已从 ProjectStore 删除，不发布 Project，不影响配置版本/dirty/保存确认。

地图的 Project 订阅继续处理配置/数据；Session 订阅单独处理高亮和浏览图层重绑定，两类订阅均在卸载和测试重置时释放。新增图层先发布定义，再选中图层，保证选择工具拿到真实图层；移除/替换/载入工程清理对应选择。几何工具继续锁定工作目标，不因浏览另一图层而改变编辑目标。

移除选择方法后的 Desktop 全套测试 78 文件 / 415 passed / 5 skipped，构建（含 TypeScript）退出 0。随后补充重挂载/卸载订阅生命周期测试，连同配置及保存专项 28/28 passed。Chrome 回归覆盖属性表跨标签目标/父组锁定/WFS 只读、同 ID 工作区替换、框选及 Shift/Alt 增减与行定位、公开 Scene 配置修改及 Undo/Redo 保留表格和选择，共 4 项通过（分批运行）。

首轮框选测试卡在旧“诊断”菜单文案，更新为真实“诊断中心”窗口的打开/关闭交互后通过。选择命令迁移期间，Vite 热更新使硬编码模块 URL 的探针读到另一份未挂载 runtime；探针改用页面资源记录中的实际模块 URL，两项选择回归通过。没有通过修改业务断言来掩盖问题，未捕获截图；不据此声明全套 E2E 或原生视觉通过。

## 要素数据所有权

`featuresByDataset` 已从 ProjectState 删除；没有迁移到另一个 Zustand Store。现有 `MemoryFeatureStore` 成为当前内存数据的唯一所有者，应用实例为 `services/feature-data.ts` 的 `featureData`。移除命令前全量灌入、命令后全量导出的复制链。单条几何/属性命令直接通过该 FeatureStore 按稳定 ID 修改数据；数据 Execute/Undo/Redo 统一使用数据事务。

| 入口 | 当前职责 |
| --- | --- |
| `featureData.getById/getAll` | 现有同步业务读取的独立副本；只读不再创建不存在的数据集 |
| `featureData.readSnapshot` | 按数据版本缓存的冻结只读视图；未变的数据集数组和要素对象保持引用共享，不复制另一套要素对象 |
| `useFeaturesByDataset` | React `useSyncExternalStore` 订阅数据视图，不把数组写入 Zustand |
| `featureData.transaction` | 同步数据批次成功后单次通知；失败回滚数据、视图身份、数据集与行顺序和数据版本；支持嵌套保存点 |
| `featureData.snapshot` / ProjectSnapshot | 保存、恢复、Scene 交换等需要独立数据的边界；继续保留原来的完整嵌入数据，不丢弃本地修改 |

Core 快照命令的宿主回调现在明确同时写配置和数据；核心命令不再重复灌入相同要素。应用载入、删除、快照编辑在数据事务内协调 Project 发布，数据变化后再通知数据订阅者。地图和公开 Scene Controller 同时订阅配置与数据，按实际引用组合去重同一批次通知。

保存版本继续观察数据通知，保存中新增数据修改不能误清 dirty。恢复跟踪独立订阅数据，同时保存上一工程的数据视图，切工程写入旧 epoch 的草稿时不会读取新工程数据。新增断言验证旧工程的编辑值 7 仍被写入旧草稿，新工程草稿不带旧数据。切换三维工程会清空二维数据会话。

Core 数据所有权测试覆盖共享视图不可突变、输入及输出副本隔离、无关数据/要素引用共享、失败批次回滚与顺序、嵌套保存点和旧工程清理。Desktop 测试另验证单条修改不调用 setAll/getAll/snapshot、不往 ProjectStore 写要素、失败命令不产生数据通知/历史、配置操作不访问数据视图。

**当前边界**：这仍是内存 FeatureStore，尚无 Provider 范围/分页查询、EditBuffer overlay 或独立数据提交。现有 UI 仍消费全量只读行视图，修改后首次读取会构造该数据集的行引用数组；失败删除的回滚保留行顺序也需要记录 ID 顺序。地图日常同步仍生成全量 Scene/GeoJSON。不能据此宣称百万级数据按需加载或单条编辑的全部 UI 成本已经为常数。

## 验证与计数

### Application 编辑入口与历史

单一 EditHistory 的所有权已移到 `services/project-edits.ts`。`execute/executeMany/undo/redo` 在该入口路由配置和数据上下文；ProjectState 已删除编辑执行、Undo/Redo、属性编辑和数据查询方法。`feature.commands.ts` 承载属性编辑及服务快照刷新，`feature-query.ts` 承载当前同步查询。属性编辑明确拒绝只读 WFS；有效但无变化的属性输入成功结束编辑，不产生历史。

这次同时改变事务行为：命令执行中暂存 Project，数据由现有 FeatureStore 事务暂存；命令成功才发布配置、数据及历史状态。字段重命名等 Session 跟随操作延后，导入/复制的新选择通过 `ProjectEditContext.afterCommit` 在实际提交后执行。配置和数据命令执行失败、批次中途失败、Undo 失败，均保留先前配置/数据/历史和重做分支。提交后 UI 跟随失败只报告该 UI 问题，不回滚已完成的数据，也不导致历史状态失去通知。

`executeMany` 对同一作用域的多要素手势形成一个批次和一个撤销步骤，逆序撤销；复制调用方的命令数组，避免后续数组改动改变历史。配置与数据作用域不能混装批次，配置上下文始终不能访问要素，三维编辑上下文也禁止二维行写入。

`useEditHistory` 订阅同一历史的 revision/canUndo/canRedo；工具栏、编辑菜单和三维工作区不依赖全量要素或 Project 变化来刷新历史按钮。全局快捷键入口仍复用原 editCommands，没有第二套 Ctrl+Z 监听器。

无变化的树配置、默认未锁定状态不增加历史/配置版本，也不清空重做分支；非法透明度在写入前拒绝。透明度仅在显式 transactionId 内合并，复用现有 style-interaction 手势身份；检查器处理 pointer/按键连发的开始、结束、取消、失焦和目标切换，独立手势分别撤销。新增真实浏览器键盘用例验证两次独立 ArrowLeft 各占一步，按住重复 ArrowLeft 共用一步，数据版本保持不变。

Application 边界新增 10 项测试，包括配置+行+UI 的失败原子性、成功提交顺序、多行单次 Undo、失败保留重做、失败 Undo、数据/配置作用域、三维拒绝二维数据、只读/无变化属性、无变化配置/非法透明度、手势合并及提交后 UI 异常隔离。实际测试数以日志为准，部分测试同时覆盖多个情形。

历史/事务迁移后的全仓测试与构建退出 0，Desktop 79 文件 / 427 passed / 5 skipped、Core 117 passed。随后补强批次列表隔离和 UI 异常处理，专项 23/23 passed，Desktop 构建退出 0。浏览器主批 8/8 passed（44.3s），包含新手势、同 ID 工作区替换、worker 导入/取消、制图保存重开、Scene 样式/历史、绘制/Undo 和表格选择保留。原生 9/9 passed，报告 `.artifacts/native-resources-1793351650402/report.json`，自有进程清理与常规构建恢复均无错误；该原生结果在最后的二维 UI 跟随异常隔离补强之前。原生对话框、缩放及视觉验收的既有边界不变。

`src/stores/configuration-transactions.test.ts` 的 9 项测试覆盖：

- 10,000 条数据的 Proxy 读取计数：样式、显隐、透明度、重命名及配置 Undo/Redo 不访问要素、不调用 MemoryFeatureStore 复制入口，选择和数据引用保留。
- 无变化的显隐不发布、不产生历史。
- 配置暂存后尝试清除数据会失败，工程、dirty、数据及历史不变。
- 合并手势后续参数验证失败时，已有有效操作仍可正确 Undo/Redo。
- 过滤配置发布时 Session 选择已收敛，数据引用不变，Undo 恢复过滤。
- 配置版本独立于数据/会话/保存确认，正确覆盖 Undo/Redo、无变化操作和同工程 ID 重新载入的新 epoch。
- 选择只存在于 Session，非法 ID 被过滤、切三维工程清空；浏览/选择不会发布 Project、修改配置版本或 dirty。
- 单条数据修改直达唯一数据所有者，无关要素对象共享，配置版本不变；失败数据命令回滚且不通知、不增加历史。

第一批仅隔离配置时的历史计数，入口 `src/__tests__/architecture-baseline.test.ts`：

| 10,000 条数据的操作 | setAll 复制条数 | snapshot 复制条数 | 满足地图订阅条件的发布数 | 单次观察 ms |
| --- | --- | --- | --- | --- |
| 显隐 | 0 | 0 | 1 | 0.25 |
| 样式 | 0 | 0 | 1 | 0.47 |
| 单几何 | 10,000 | 10,000 | 1 | 44.61 |

原阶段 0 样式计数为复制 10,000 + 10,000 条、发布 2 次。计数仅覆盖指定 Store 复制入口；耗时为本机单次观察，不是性能承诺。场景投影仍转换 10,000 条（本次约 71.68 ms），**尚未实现地图增量同步**。

数据所有权收敛后，同一入口的 10,000 条新计数：显隐/样式/单几何操作在 `setAll/snapshot` 两个全量复制入口均为 0，各 1 次满足地图订阅条件的通知；本机单次分别约 0.21/0.48/0.05 ms。另计首次行视图物化：构造 10,000 个行引用约 0.02 ms；场景投影仍转换 10,000 条约 81.68 ms。此探针未挂载 React/OL，**没有把视图物化和地图同步成本算进 Store 命令耗时，也不代表全部克隆或实际 Source 重建次数**。

本批验证：全仓 `pnpm test`、`pnpm build` 均退出 0，Core 23 文件 / 117 passed，Desktop 78 文件 / 418 passed / 5 skipped；新增数据边界、恢复与计数专项 15/15 passed。浏览器分批通过 10 项：标准制图保存重开 1、恢复 3、选择/公开 Scene 配置/绘制 Undo 3、真实 worker 导入及取消/切工程/大文件响应 3。初轮并行构建触发 Vite 热更新干扰制图用例，构建结束后重跑通过；worker 探针也改用实际加载的模块 URL，保留原数据/撤销/防晚到断言。

数据所有权迁移后原生 `test:native-scene-editor` 完整 9/9 passed，退出 0，报告 `.artifacts/native-resources-1793349912120/report.json`。本轮 WebView2 的 Playwright 页面事件未记录自定义协议响应；测试补充独立 CDP `Network.responseReceived` 监听，捕获 37 条真实资源响应，原有依赖路径与 200 状态断言保持。首次缺少该监听的运行虽已加载 3 个场景对象，但依赖响应证据为空，报告 `.artifacts/native-resources-1793349607309/report.json` 仍保留为失败。最终运行的保存重启、重定位、副本、授权和清理/正常构建恢复均成功。Windows 文件对话框、125% 缩放和视觉质量的未验收边界不变。

配置路径接入后，Core 114 passed、Desktop 408 passed / 5 skipped；新增边界及计数测试首轮 7/7 passed，加入配置版本后保存/恢复/配置专项 24/24 passed。Chrome 二维制图保存重开、三维样式/历史重开 2 项通过。另新增工作区切换测试，验证同一工程 ID 的二维→三维→二维切换，防止旧地图卸载前的订阅读取新三维内容。原生 9 项是阶段 1 严格工作区后的结果，发生在本批配置路径修改之前，不能直接作为本批原生回归。后续完整回归见[证据记录](refactor-boundary-evidence.txt)。

配置版本和工作区订阅修复后的 Desktop 全套测试：78 文件 / 414 passed / 5 skipped；Desktop build（含 TypeScript）退出 0，保留现有 Vite 体积警告。浏览器及单元行为证据不替代视觉验收。

最后的 UI 跟随异常隔离后，真实 worker 导入/撤销与透明度键盘手势两项浏览器回归再次通过（24.8s）；见 `.codex-refactor-edits-follow-up-browser.log`。

## 2026-11-01：结构共享与生命周期

`normalizeLayerTree` 对有效树返回原对象；清理旧成员或补齐子顺序时只替换受影响的文件夹和顺序。`reconcileProjectCartography` 复用未变化的 metadata/content。树历史沿用原机制，但应用时按稳定 ID 复用相同图层/文件夹，变化对象内未变化的样式、成员、子顺序等字段也复用。测试覆盖冻结输入、失效成员修复及二次规范化身份，和真实 Store 样式/重命名/Undo 后的分支引用。

本阶段选择保留纯不可变领域函数配合 Zustand 受控发布，暂不引入 Immer：当前命令已在 Core 产生新配置，单在 Store 包一层 produce 无法消除这些函数的复制；这次直接修复产生复制的规范化和树应用边界。没有把 Draft 引入领域 API，也没有并列维护 patches 历史。此决定采用合同中“如确认适合”的实现选择，不能替代结构共享验收；上述引用测试才是证据。部分命令准备仍复制配置快照，后续继续按实际成本收敛。

`loadSnapshot/getSnapshot/applySnapshotAsEdit/replaceSnapshotAsEdit` 已从 ProjectState 删除，由 `services/project-session.ts` 的 Application 函数统一编排。该模块不保存 Project 副本，也没有新建 Store。载入前先准备和克隆输入；有效载入才取消旧 WFS、增加请求世代、清理工作目标/选择/历史，再在数据事务内打开新配置 epoch。相同工程 ID 重新载入仍开启新 epoch，配置版本归零。

无效二三维组合或不可克隆数据不会取消当前请求、清空历史、替换数据或改变当前工程。完整快照仍提供独立副本用于保存/恢复。载入新 epoch 时不把旧工程传给制图编辑协调器：文件中的标准制图 AST 与旧编辑器缓存均被保留，不会将文件缓存差异误判成对上一个工程的样式编辑。

生命周期 4 项测试覆盖上述有效载入、失败保护和制图权威边界；保存/恢复原有测试同步迁到实际 Application 入口。Core 118 passed；全仓测试/构建在生命周期迁移后退出 0（Desktop 433 passed / 5 skipped），随后补强制图加载边界后 Desktop 434 passed / 5 skipped，Desktop build 退出 0。浏览器与原生结果见本轮证据记录，不能从单元测试推断原生对话框或视觉质量通过。

本轮浏览器 8/8 passed（51.1s），原生 `test:native-scene-editor` 9/9 passed、退出 0，报告 `.artifacts/native-resources-1793521397086/report.json`。原生覆盖真实文件写入、重启重开、依赖资源、重定位和目录授权；自有进程清理及常规构建恢复无错误，截图关闭。Windows 文件选择对话框和视觉效果仍未验收。

## 2026-11-01：图层与数据集创建、删除

`addLayer/copyFeaturesToLocalLayer/addServiceLayer/removeLayer/removeGroup` 已从 ProjectState 删除，由 `app/commands/layer-content.commands.ts` 编排，UI、处理结果、服务发布和测试探针均调用这一入口。普通创建及服务创建也进入唯一的 `projectEdits` 历史；复制结果沿用独立数据所有权和单步 Undo。普通创建/服务创建保留已有要素选择，复制结果清空选择，创建 Undo 恢复仍有效的前一个选择目标。

Core 的 `AddDatasetLayerCommand` 支持本地初始行和不预建空行缓存的服务定义；已有 `AddLocalLayerCommand` 保留兼容入口。创建 Undo 会清理加载后的服务缓存、取消所属请求并关闭该图层的会话；Redo 恢复定义，服务数据重新加载。

`RemoveLayerContentCommand` 将图层/文件夹删除纳入一个事务和 Undo。共享数据集仍有其他图层引用时保留定义和数据；只捕获、清除真正失去图层引用的数据集行，不调用全工程要素 snapshot，也不替换无关数据集。配置差异应用保留未变化分支及后续无关配置更新。撤销恢复图层、数据集、树顺序、制图与本地行；已取消的请求和删除时清理的界面会话不会复活。删除仍会保存被移除数据集的完整行用于 Undo，不能当成 Provider/EditBuffer 或大规模删除内存验收。

请求取消、表格/编辑目标清理及选择清理在命令成功后、配置发布前执行。锁定后代、重复数据集 ID、数据写入/删除失败和缺失目标不破坏当前工程、数据、会话或重做分支。新增 8 项 Application 测试覆盖这些边界及引用隔离；删除共享图层时还断言兄弟图层配置和数据引用保留。

本批全仓 `pnpm test` 和 `pnpm build` 均退出 0：Core 118 passed，Desktop 82 文件 / 442 passed / 5 skipped；构建保留现有 Vite 体积警告。最终 Chrome 11/11 passed（约 1 分钟），覆盖真实界面共享图层删除/Undo/Redo/保存、实际 OL Source、表格编辑、worker 导入/取消、带凭据 WMS 请求、标准制图往返和三维样式历史。首轮及一次重跑的表格用例在第二次导入确认页等待超时，随后插桩运行、原测试和最终整批通过；没有修改导入生产逻辑，超时原因尚未稳定定位，日志保留。本批未重跑原生测试，上一节原生结果属于生命周期批次；浏览器证据不替代原生文件选择对话框或视觉验收。

## 2026-11-01：配置入口、属性草稿与初始视角

ProjectState 现在只包含 `project/projectEpoch/configRevision/dirty/setDirty`。16 个样式、过滤、显隐、透明度、命名和树操作迁入 `layerConfigurationCommands`；配置查询迁入不保存状态的 `layerConfigurationQueries`。WFS 加载元数据由 `datasetConfigurationCommands` 通过受控配置提交更新：忽略缺失/非 WFS 数据集、跳过无变化、克隆输入、检查密钥字段，不读写要素，也不新增用户历史。样式、过滤和透明度的 Application 入口检查父级锁定；显隐保留锁定时可浏览切换的既有行为。透明度控件在有效锁定时禁用，过滤、布尔值和非有限透明度输入在提交前被拒绝。

完整图层/文件夹属性、符号预设/资源和 GeoServer 发布链接不再先取得全工程要素快照。`projectConfiguration` 仅取得独立 Project 配置副本；`ApplyProjectConfigurationCommand` 在已有 EditHistory 中应用配置差异，使用拒绝 FeatureStore 访问的 configuration scope。它禁止切工程/工作区和新增、删除、重新绑定图层/数据集所有者。标准制图变化也检查图层锁定。弹窗与地图可选择设置直接应用配置，不再通过全量 Scene 文档往返转换。CRS 赋值兼容助手传入空数据字典，只调整数据源配置。UI 仍有全行统计/读取，运行时地图同步仍会全量投影；这里的命令隔离不能证明整个 UI/OL 的成本不随要素数量增长。

二维新增“设为初始视角”，在真实地图就绪时将当前 OL 视角作为一次可撤销配置编辑；无变化不发布，无效数值不破坏历史。保存仅序列化已配置的二维初始视角和三维初始相机，不自动读取实时地图/相机。旧文件中已有的初始视角继续作为打开预设；三维沿用已有“使用当前视角”配置命令。保存期间仅导航不阻止确认，显式初始相机配置编辑仍由版本保护保留 dirty。真实浏览器覆盖导航后保存不改预设、明确设置/Undo/Redo、文件重开和实际 OL View；采样先等待 OL 动画结束，没有放宽保存值的精确断言。

本批新增 8 项配置边界测试和 1 项保存并发测试；全仓 `pnpm test`、`pnpm build` 退出 0，Desktop 83 文件 / 451 passed / 5 skipped，Core 118 passed。另有 9 项属性/预览浏览器通过；worker 依赖收敛后的最终批次 10/10 通过，包含初始视角、制图、共享数据、表格、三维样式和真实 worker；多格式与表格重开补充批 6/6 通过，覆盖中文多图层 SHP、CSV、非法 GeoJSON、两类 DXF。三批有重叠，不累计为 25 个独立用例。

表格第二次导入曾在 15 秒确认等待内超时；插桩及只在结束后采样的运行没有观察到取消，但一次 3 条记录的后台解析耗时约 8.4 秒，其余约 0.1–0.2 秒。worker 静态依赖原先经 Core/多格式总入口引入大量无关模块。现在为 Core 的 geojson/id、vector-io 的 coordinate-transform/csv/dxf/shapefile 提供明确子路径；worker 仅静态加载基础解析和坐标转换，格式解析器按需加载。构建入口由 360.07 kB 降至 140.74 kB，另有 CSV/DXF/SHP 块；这不是所有块的总大小。重启开发服务器后的整批和随后原表格流程均通过，没有延长超时。不能据此断言此前所有超时均只有一个根因，也不替代大规模数据验证。

最后原生 `test:native-scene-editor` 退出 0、9/9 passed，报告 `.artifacts/native-resources-1793526957800/report.json`。记录 37 条真实资源响应，覆盖本地依赖、样式/历史、实际文件保存、进程重启重开、重定位、副本及目录授权；自有进程清理和常规构建恢复成功。`screenshots=false`，原生文件选择对话框及 Windows 125%/视觉验收仍未完成。新增子路径后 `vector-io test:consumer` 的 Node 运行和 TypeScript 检查也退出 0。

## 2026-11-01：历史预检、上下文写入与公共配置路径

Core 命令通过 `EditTargets` 声明稳定的数据集、二维图层/组、三维对象/组目标，继续复用同一 EditHistory。字段/资源变化从配置差异推导目标；二维/三维移动和根排序另外捕获操作对象，调用方随后修改选择数组不会改变历史目标。资源变更会关联引用该资源的三维对象。`getBlockReason` 已实现，内置命令的执行、Undo、Redo 在当前定义上检查父级/对象锁定和既有数据集种类能力，不读取要素视图或试运行命令。

被阻拦的 Undo/Redo 返回 false 并保留原分支，工具栏显示原因；解锁或恢复数据集能力后可继续。显隐操作保留锁定下的浏览行为，本地锁定切换只检查父级；缺省锁定值与 false 等价。批次合并所有目标，在首项写入之前预检。数据事务内的 FeatureStore 写入还会实际检查能力、缺失所有者和共享数据集的引用层锁定，覆盖没有声明目标的自定义行命令。初始化/删除存储必须先在暂存配置中建立/移除所有权；服务缓存创建撤销仍可清理，不被误当作对只读源的行编辑。

自定义命令未声明目标时，写入阻拦只能在实际调用时发现；该阻拦会回滚数据，保留历史，并按命令、方向、Project 引用和数据版本缓存诊断理由。该缓存不保存 Project 副本，也不成为新的内容所有者。普通代码错误仍抛出，未被吞成“无操作”。自定义命令应通过上下文修改数据，并用 afterCommit 安排 UI 跟随；框架不能回滚回调自行在外部执行的副作用。

地图投影切换已从完整 Scene 文档往返改为纯配置提交，保持地理中心、当地比例和旋转，不读写要素。公共 Scene 桥对同工程、相同数据所有者/定义、相同行内容的修改改用 configuration scope；数据或资源定义变化继续使用内容事务及会话清理路径。新测试验证 API 显示修改及 Undo/Redo 不调用 setAll/replaceAll，不推进数据版本且保留行引用。SDK 仍需读取/返回完整 SceneDocument，因此读取与投影成本仍未消除，不能当作全链路不随要素数增长的证据。

公共转换原先会省略单级文件夹的显式 childOrder，使显隐被误认成树修改；桥现在只在语义子顺序未变化时保留宿主原顺序。属性草稿的重复 JSON 锁定判断已移除，由统一命令预检负责；对象属性顺序差异不再被误报成受保护字段变化。

新增 12 项历史/写入预检、2 项投影命令和 2 项公共桥测试。最终全仓 `pnpm test`、`pnpm build` 退出 0：Desktop 85 文件 / 467 passed / 5 skipped，Core 118 passed。首轮浏览器 13 项中 11 passed，失败为历史导入超时及旧 CRS 探针。CRS 探针已改读 content.crs，并验证真正还原快照中的几何，修正原来未定义值相等及读取原数据的无效断言。表格原用例追加仅失败时的任务/worker 诊断；随后连续 3 次通过，重启服务器后包含投影、坐标 CSV、源 CRS、表格及受阻后重试的 6 项全通过（41.5s）。没有延长超时，导入问题的全部原因仍未查明。

最后原生 `test:native-scene-editor` 退出 0、9/9 passed，报告 `.artifacts/native-resources-1793531477296/report.json`，记录 66 条资源响应。保存/进程重启重开、样式/历史、资源依赖、重定位、副本及授权通过，自有进程清理和正常构建恢复成功；截图关闭，原生文件选择对话框和 Windows 125%/视觉验收仍未完成。

## 2026-11-01：二维公共锁定语义

二维 Layer 新增可选 `locked`，与旧 `editable` 编辑标志独立。缺省锁定为 false，旧工程的 `editable: false` 不会被迁移成锁定。SceneDocument 输出使用显式本地锁，输入保留公共 `node.locked`；宿主公共编辑往返另行保留已有 editable。已经明确写入公共文档的 locked=true 继续被尊重，不能自动猜测它来自旧映射错误并解除锁定。

有效锁定覆盖自身和祖先；配置、样式、过滤、属性窗口、源 CRS、拖动、移动、删除和历史预检沿用同一判断。图层菜单新增锁定/解锁及有效锁标记；本地解锁只受父级约束，显隐仍允许切换。共享数据集任一引用图层锁定后，属性/几何编辑入口、表格、字段计算和地图工具都禁止写入共享行；正在使用该数据集的地图编辑目标会退出。新增 `isDatasetLocked` 只检查配置定义，不读取要素。

本地锁定 Undo/Redo 可正常执行；解锁同时夹带命名或其他受保护字段变化仍被拒绝，二维图层、文件夹及三维对象均有回归断言。配置提交保持有效要素行引用和数据版本，v3 工程序列化/重开保留显式锁定。

全仓构建退出 0；串行全仓测试退出 0，Desktop 85 文件 / 474 passed / 5 skipped，Core 119 passed。日志为 `.codex-refactor-local-lock-workspace-build.log`、`.codex-refactor-local-lock-serial-test.log`。一次与浏览器并行的全仓运行有两项 5 秒单测超时；停止其他工作后未放宽超时即通过。首轮另有新测试缺少 window 状态消息环境，已以测试替身修正并复验。

浏览器独立批次先为 13/16，通过公共锁定后退出实际地图编辑、菜单解锁、Undo/Redo、数据版本保持，以及表格、投影、源 CRS、属性窗口、共享内容和远程导入。3 项旧 Scene 测试仍依赖已移除的未应用样式提示及表格继承图层过滤假设；按即时提交与独立表格过滤更新，保留取消/导入/Undo 恢复样式、有效图层过滤和导出全行断言，删除显式截图。Scene 复验 5/5（9.4s），当前 15 项用例分批全部通过。日志为 `.codex-refactor-local-lock-isolated-browser.log`、`.codex-refactor-local-lock-scene-final.log`。

第二次导入超时在与全仓单测并行时再次出现。失败任务诊断显示第二个解析任务 running、worker 仍存活；trace 网络记录 worker 的 clone/coordinate-transform 依赖耗时约 23/25 秒，超过测试 15 秒等待。独立浏览器原表格用例通过；本样本支持开发依赖加载延迟，但不足以认定历史超时全部同源，未修改导入生产生命周期或延长超时。本批未重跑原生，不能将上述浏览器/序列化结果当成原生或视觉验收。自有 Vite 已停止，无提交或推送。

## 2026-11-01：公共排序操作目标

Scene SDK 的 moveNode 向宿主传递可选 SceneCommitIntent，携带移动对象和目标父级；宿主映射二维图层/文件夹及三维恢复后的对象 ID，将目标复制进既有配置命令。执行、Undo、Redo 检查当前锁定，不将明确移动造成的同级数组位移误当作那些同级对象也被移动。普通 transaction/文档配置替换没有操作意图时，对同级序列中发生位置变化的既有对象采用保守锁定检查；它可能阻拦跨越锁定同级的原始数组排序，应使用 moveNode 表达真实目标。此元数据不新增状态或历史，也不改变独立 SDK 的文档所有权。

新增两个 Application 测试覆盖锁定根对象不能移动、未锁定对象可跨过锁定同级、之后外部加锁阻止撤销且保留历史、原始数组反转不能绕过锁定。测试按公共绘制顺序定位，避免将图层树顺序与公共节点数组相反的约定混淆。桌面专项 32 passed，SDK 44 passed；Core/SDK 构建、桌面 tsc、diff check 通过。日志为 .codex-refactor-order-verified-test.log、.codex-refactor-order-verified-types.log、.codex-refactor-order-sdk-test.log、.codex-refactor-order-core-build.log、.codex-refactor-order-scene-build.log。本批未重跑全仓构建、浏览器或原生，不能沿用上批结果声称这些边界已复验。

完整公共文档投影仍读取/克隆全行，排序推导仍遍历配置定义；本批不构成性能验收。后续须补充三维恢复 ID、嵌套重排和实际浏览器路径的排序证据，再推进配置/数据 dirty 与保存拆分、Provider/EditBuffer 和增量地图。

## 本阶段余项

这些余项完成并验证之前，阶段 2 仍为进行中：

1. Store 的业务包装已迁出，投影切换已走纯配置，公共 Scene 纯显示提交不再替换要素；二维 node.locked 已与 legacy Layer.editable 解耦。公共 API 移动目标和普通事务根排序保护已接入，继续验证三维恢复 ID/嵌套排序，并处理完整文档读取；当前预检覆盖声明目标及可识别字段/资源变化，不能声称任意公共事务的意图均已识别。
2. 配置 revision 已增加；继续拆分配置 dirty 与未提交数据状态，保护保存并发、工程 epoch 和恢复草稿；当前 Save 仍保存完整编辑快照。
3. 历史锁定预检和 getBlockReason 已实现；目前能力依据既有数据集种类，阶段 3 须接入真实 Provider 的可写权限、版本及提交能力。继续保护无变化跳过和手势合并；部分树操作准备仍复制配置快照，发布保留无关分支。
4. Zustand/不可变函数的结构共享选择和验收已落地，继续保护领域模型及单一历史边界。
5. 按合同验证配置 Undo/Redo、锁定、过滤、制图与保存 dirty。阶段 3 实现真正 Provider/EditBuffer 及独立数据提交；阶段 4 处理地图全量投影/快照、重复同步和内嵌 GeoJSON 等资源成本；阶段 5 验证 10 万/100 万数据。现有隔离单元测试不证明挂载 UI/OL 或内嵌三维资源的完整成本。

本批主要文件：`packages/gis-core/src/editHistory.ts`、`configCommands.ts`、`scene3dCommands.ts`、`apps/desktop/src/stores/project.store.ts`、`session.store.ts`、`services/project-edits.ts`、`feature-data.ts`、`feature-query.ts`、`app/commands/feature.commands.ts`、`selection.commands.ts`，及其 UI/命令消费者和边界测试。不存在“已完成全量架构重构”的结论。


## 2026-11-01：排序边界复验

新增三维嵌套文件夹公开 ID 经宿主恢复后的节点移动测试，覆盖持久配置顺序、Undo/Redo、之后外部锁定阻止撤销和移动；公共桥测试现为 17 passed。新增浏览器用例验证明确移动未锁定对象跨过锁定同级后，图层树、实际 OL 图层集合绘制顺序、Undo/Redo 一致。首次探针错误使用旧 syncLayers 的 zIndex 假设而失败；现文档运行时按 OL 集合及嵌套组顺序绘制，改为遍历真实 map 图层集合并与 registry 中对象比较，没有修改渲染生产代码。最终 history-preflight 浏览器 4/4 passed（约 8 秒），截图关闭。

全仓 pnpm test 退出 0，Desktop 85 文件 / 477 passed / 5 skipped；全仓 pnpm build 退出 0（既有 Vite 大包提示）。证据：.codex-refactor-order-workspace-test.log、.codex-refactor-order-workspace-build.log、.codex-refactor-order-final-browser.log、.codex-refactor-order-nested-test.log。自有 Vite 已停止。本批没有原生或视觉验收，也未证明三维混合文件夹/对象重排能完整表达所有跨类型绘制顺序；公共文档全量读取和 dirty/数据保存拆分仍是余项，阶段 2 未完成。


2026-11-01：开始建立 [阶段 3 Provider/Buffer 基础层](refactor-stage-3.md)，作为 dirty/保存分离的实际数据所有权前提。桌面保存尚未切换，阶段 2 仍进行中。

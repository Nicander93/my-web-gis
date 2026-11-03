# 阶段 1：工程格式与互斥工作区迁移

基线 HEAD：`2cf4a724aadb041ac030350079851494c37802d3`。2026-10-30；未提交或推送，原有 UI 工作区改动保留。

## 本次落地

- `gis-core/project-format.ts` 定义 `ProjectFile = { metadata, content }`。`content.kind` 为 `map2d | scene3d`；二维持有数据定义/图层/制图/初始视角，三维持有 Cesium scene，不在新格式中混存另一工作区。
- `migrateProjectFile` 从工程快照构造磁盘格式；`serializeProjectFile` 提供新格式写入；`parseProjectFile` 读取旧/新文件。运行时和文件版本目前均为 3，旧格式 1/2 仅存在于读取迁移边界。
- 旧 `Project.metadata` 放入新 `metadata.sceneMetadata`，工程 id/name/version 单列；description、显示配置、应用自定义 settings、视角约束、字段、标准制图 AST、资源路径和嵌入编辑数据保留。
- 对混合二三维工程、带额外二维视角/底图/要素的三维工程、未知会被丢弃的字段、版本冲突、无效嵌入数据明确拒绝，保留原文件。已声明类型优先判别，但不授权丢弃另一类内容。
- 无内容的旧显式三维工程可还原默认场景；未声明类型的旧 scene 仍由旧迁移边界识别。新格式不允许 settings.workspaceType 与 content.kind 并存。
- `Project`、`createProject/createEditorProject` 和既有 Store 现已使用 `metadata + content`；Core 命令、树、制图、地图、Cesium、资源、保存、恢复、属性表及业务调用改为新路径，没有第二个 Project Store。`LegacyProject` 仅作旧文件输入类型。
- 新旧工程读取均构造相同的运行时模型，`getProjectType` 仅按 content.kind 判断；旧 settings.workspaceType 只由旧格式解析器读取并剥离，应用、菜单、Scene 控制器不再用它判断工作区。
- 新格式写入和明确的新格式解析沿用凭据值检查；credentialRef 可保存，password 等实际值被拒绝。
- 实际项目文件保存（Tauri 写入、浏览器下载、Save/SaveAs）已改用 `serializeProjectFile`，写入格式 3 的 metadata/content；旧格式 1/2 经文件打开入口检查后报告迁移到 3。旧混合工程会明确提示保留原文件、分别导出，写入失败保留当前编辑、dirty、文件关联和恢复草稿。

## 运行时与交换边界

**文件、`serializeProject/serializeProjectSnapshot` 和恢复草稿现已统一写格式 3。** 恢复读取会将磁盘表示构造成同一个运行时 Project；保存版本/epoch/队列和 recovery owner/revision 比较保护继续复用。

运行时 `ProjectContent` 已拆为严格的 `MapContent | SceneContent`。三维内容不含二维 datasets/layers/groups/视角/底图占位字段。`requireMapContent/requireSceneContent` 在错误工作区明确抛错；通用树、制图、恢复、地图挂载等调用方显式分支。`parseProjectFileSnapshot` 直接构造新模型，不把新文件转回扁平 Project。

Scene 导入会先在独立数据上转换，再检查工作区：混合可编辑二三维内容、附带有效二维视角/底图等不能无损转成三维的文档明确拒绝，原文档不变。公共 Scene 编辑 API 和快照历史不能切换工作区。三维节点/资产/组的 ID 映射独立于二维树；嵌套组往返分别测试二维、三维。旧协议输出所需默认视角只在输出边界生成。

Provider 尚未实现，`featuresByDataset` 继续保存在快照中，**没有只保存 source 引用而丢弃本地编辑**。阶段 2 及后续阶段尚未完成；下一步见[阶段 2 记录](refactor-stage-2.md)。

## 运行时迁移修复

- 工程顶层复制不足以支持嵌套内容更新；`SetCesiumSceneCommand` 同时复制 content，避免修改旧快照或令 Scene 会话漏掉变更。测试锁定原 content 未突变、Undo/Redo 和运行时订阅。
- 三维项目新建时即有空场景；撤销最后一次添加回到空场景，content.kind 保持 scene3d。
- 工程 metadata 与 portable sceneMetadata 分离，描述/显示配置的命令和 Undo 跟随同一 Project。
- E2E 与原生验收探针读取路径同步更新；未改变原有业务断言为“只要页面存在”。原有用户 UI 改动保留。
- 要素缓存同步时先清除当前工程已无的数据集，防止前一个工程的数据进入下一工程的历史/快照。

## 严格工作区迁移后的验证

- `pnpm test`、`pnpm build` 均退出 0。Core 22 文件 / 114 passed；Desktop 77 文件 / 408 passed / 5 skipped。跳过项未计入通过。
- 独立 Vite + 本机 Chrome：5 个专项通过，包含二维共享数据源制图保存重开、三项恢复用例、三维样式/历史/导出重开。worker 导入三项是此前运行时迁移结果，未在本轮严格类型后重跑；并非全套 E2E 通过。
- `pnpm --filter @desktop-webgis/desktop test:native-scene-editor`：9/9 passed，退出 0；报告 `.artifacts/native-resources-1793346431731/report.json`。使用隔离 Tauri 标识、真实 WebView2、本地资源协议和文件读写，覆盖嵌套 Tileset/GLB/GeoJSON、外置 GLTF binary、样式/参数/历史、保存后重启重开、资源重定位、跨目录副本和受控目录授权。测试自己的应用/服务清理、常规构建恢复均无错误。
- 首次沙箱内原生运行前三项通过，但结束进程因 Windows 登录凭据错误失败，未计为完整通过；核验并清理其自有进程后，在批准的沙箱外执行上述完整测试成功。
- 原生路径由测试夹具赋值，**Windows 文件选择对话框未验证**；125% 缩放未单独签收。报告包含硬件诊断，但不代表 GPU 视觉质量或用户主观验收。截图关闭。
- 可复现入口、结果和日志名见[严格工作区与配置边界证据](refactor-boundary-evidence.txt)。

## 前序迁移验证记录

- `pnpm --filter @desktop-webgis/gis-core test`：文件 IO 切换后最终回归 21 文件 / 111 passed，包含 21 条新格式/迁移通知测试与 2 条旧格式样本测试；Core build 通过。
- `pnpm --filter @desktop-webgis/desktop test`：文件 IO 切换后最终回归 77 文件 / 407 passed / 5 skipped；跳过项仍未被当成通过。
- `pnpm --filter @desktop-webgis/desktop test -- src/services/project-io.test.ts src/services/project-save.test.ts src/services/recovery-tracking.test.ts`：实际文件 IO 切换后 3 文件 / 26 passed，覆盖浏览器保存→读取含编辑要素的新文件、mock Tauri 三维资源跨盘另存→重开、混合旧文件两端拒绝、失败保存不改变编辑/dirty/路径，以及原有保存并发/恢复保护。
- Desktop build（含 TypeScript）：实际文件 IO 切换后通过，Vite 仍有体积警告。
- 运行时字段迁移后执行 `pnpm test`、`pnpm build`：均退出 0，包含所有工作区包、Viewer、Desktop 和 consumer；Core 111 passed，Desktop 407 passed / 5 skipped。`git diff --check` 无空白错误，Git 有已有 LF/CRLF 提示。
- 独立 Vite 5196 + 本机 Chrome 的 Playwright 行为验证：8 个专项通过（三维样式/选择/Undo/Scene 导出/项目重开 1，真实 worker 导入/撤销/取消/切工程/大文件响应 3，二维共享 Source 标准制图保存重开 1，损坏恢复缓存处理 1，三维分组/光照恢复 1，二维属性计算恢复与保存后清理 1）。分批运行，并非整个 E2E 套件通过。
- 浏览器测试仍执行原有数据、历史、缓存、dirty 和重新打开断言；同步修正格式 3 版本期望以及当前 Ant Design 的字段计算器、可见单选标签/选项和光照 Switch 交互，移除了恢复用例中非必要的截图。没有将软件渲染的浏览器结果当作原生/GPU 视觉验收。
- 最后增加运行时未知字段拒绝后：Core 格式/制图 32 passed、Desktop 保存/恢复 18 passed、Desktop build 通过。全仓完整回归和此后专项的摘要见 [运行时迁移证据](refactor-runtime-evidence.txt)。
- 这些 IO 测试使用真实解析器和资源重定位，文件选取/读写为 mock；不代表 Windows 原生文件对话框或 GPU 验收。
- 阶段 0 的分页 E2E 重跑未产出正常最终汇总，已中断收尾进程，未记为通过。独立持有 Vite 并关闭 Playwright 自带 webServer 后，新专项已能输出终态；既有旧样式控件 E2E 仍待接入当前 Ant Design 交互。

阶段 1 的领域结构、迁移及已列行为门槛已落地，原生对话框等证据边界如上。完整重构目标与完成定义仍按 [V1.0 合同](refactor-plan-v1.md)，不因阶段测试通过而缩小。

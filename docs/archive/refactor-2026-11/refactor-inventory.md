# 架构重构阶段 0：现状与保护基线

日期：2026-10-30。目标合同：[V1.0 原文](refactor-plan-v1.md)。

## 基线与改动隔离

- 本地 main / HEAD：`2cf4a724aadb041ac030350079851494c37802d3`。
- `git ls-remote https://github.com/Nicander93/my-web-gis.git refs/heads/main` 返回同一 SHA。普通 fetch 因 `.git/FETCH_HEAD` 写权限失败；只读 HTTPS 核对成功，未修改 SSH 密钥或权限。
- 开始时已有 24 个已修改文件和未跟踪 `ui-density.test.ts`，涉及 UI 密度、停靠、面板、设置、原生脚本、E2E 和设计系统文档。本阶段保留它们，不提交或推送。
- 本阶段只新增合同、盘点、样本和保护测试，尚未修改产品架构。阶段 1～5 仍未完成。

## 数据所有权与写入入口

| 当前权威/入口 | 实际行为 | 迁移要求 |
| --- | --- | --- |
| `gis-core/src/types.ts` Project | 顶层二维字段，附加 `city`、`sceneDisplay`、description/metadata、mapViewConstraints | 外层 metadata/content；不能丢掉这些额外字段 |
| `gis-core/src/project.ts` | 创建、解析 v1/v2、制图绑定升级、序列化 ProjectSnapshot | 保留旧格式读取；拒绝静默丢弃二三维混合内容 |
| `services/project-type.ts` | settings.workspaceType 优先，否则由 city 推断 | 新格式只按 content.kind；旧规则只存在于迁移边界 |
| `app/commands/project.commands.ts` | createWorkspace/openProject → loadSnapshot；Save/SaveAs → requestProjectSave；scene import/export | 保留 epoch、版本和替换保护 |
| `stores/project.store.ts` | Project、全量 Features、选择、一个共享 EditHistory 和 MemoryFeatureStore | 分离配置、会话和数据所有权，不另建权威 Project 副本 |
| Store addLayer/copyFeaturesToLocalLayer/addServiceLayer | 导入/处理结果/服务创建 Dataset、Layer；copy 使用 AddLocalLayerCommand | Dataset 身份与表现分离；处理结果仍能持久保存 |
| Store loadSnapshot/getSnapshot | 打开/新建替换与快照；load 清历史、增 epoch、清会话 | 后续用 Provider 接管嵌入要素时须先有持久归宿 |
| Store replaceSnapshotAsEdit/applySnapshotAsEdit | 整体替换或同工程差量导入，含会话清理 | 兼容 Scene API、资源和同 ID 数据替换 |
| Store setLayerStyle/setLayerCartography/setLayerFilter | 配置命令，其中样式进入 executeEditCommand 全量数据链 | 统一受控配置事务、锁定、合并历史和 no-op |
| Store setLayerVisible/setLayerOpacity | 显隐直接更新；透明度直接 editHistory.execute | 配置操作写入路径和 Undo 目前不一致 |
| Store tree/group/rename/move/removeLayer | SetLayerTreeCommand、快照命令或直接 set 混合；删最后引用会清 Dataset | 保留嵌套组、锁定和多 Layer 引用语义 |
| Store setDatasetFeatures/patchWfsServiceSource | WFS 加载/刷新更新缓存与来源元信息 | 保留取消、完整性、截断信息；不能将窗口认作全量 |
| Store updateFeatureProperties/executeEditCommand(s)/undoEdit/redoEdit | 数据及配置共享历史，多数路径复制所有 Dataset | 改为 overlay 和各自提交边界；一个快捷键路由 |
| `features/scene3d/scene3d-commands.ts` updateScene | 克隆 city，SetCesiumSceneCommand → executeEditCommand | 迁至 content.scene，保留节点、资产、分组、相机、裁剪等 |
| `features/scene/project-scene-controller.ts` | 公共 Scene API 读写和订阅，导出前后全快照 | 交换格式不是日常地图同步的权威数据容器 |

源码入口目录均相对于 `apps/desktop/src/`，注明 gis-core 的例外。精确 Store 方法声明及所有生产调用引用见 [调用点索引](refactor-call-sites.txt)。索引包含别名方法引用，但不是动态运行调用图；修改阶段仍需逐个追踪实际依赖。

## 保存、恢复与兼容

`project-io.createSnapshotFromState` 读取实时二维视角和三维相机，再由 `buildPersistedSnapshot` 克隆整个 featuresByDataset、规范化配置并检查凭据。Tauri 使用 `files.writeTextFile → write_text_path → atomic_file::write_atomic`；浏览器下载自包含 JSON。当前工程保存同时持久化数据，尚无独立 Provider commit。

`project-save.requestProjectSave` 有串行队列、epoch/mode 合并、内容版本和保存后再次确认，避免切工程或保存过程中修改误清 dirty。三维相机微小数值噪声有容差。后续不能只换字段名而丢掉这些保护。

`recovery-tracking.startRecoveryTracking` 目前由统一 dirty 和 Project/Features 引用变化触发，延迟 5 秒、周期 120 秒；切工程保留上一个草稿，显式放弃可清理。恢复也包含全量要素。拆 dirty 后必须订阅编辑缓冲，否则未提交数据会丢失恢复能力。

迁移样本：[二维 v1](fixtures/legacy-map-v1.webgis.json)含已编辑嵌入几何/属性、稳定 ID、源 CRS、字段、旧样式、过滤、组顺序、WMS credentialRef 与相对路径；[三维 v1](fixtures/legacy-scene-v1.webgis.json)含相对 Tileset 资产、节点、变换、相机、effects 与 sceneDisplay。样本为合成测试数据，不含真实凭据。测试验证两次打开及源文件未改写；v2 制图完整性、样式资产和路径重定位另由已有测试覆盖。

**新增迁移风险**：旧 Project.metadata 已用于 Scene JSON metadata，不能直接当作新 ProjectMetadata；必须有明确兼容归宿。旧 settings 中的 scene 扩展、未知字段和二三维混合内容要先保存/拒绝策略，再转换。不能用空二维结构包住 city 就宣称完成单工作区迁移。

## 实际地图同步链

```text
MapCanvas mount / Store project或featuresByDataset引用改变
  → syncMapFromProject
  → state.getSnapshot
  → createProjectSceneDocument → createProjectSceneProjection
       每个 vector/WFS Dataset 转换全部缓存要素及字段元信息
  → OlMapRuntime.syncDocument
       复用 Layer；features数组引用相同才有 Source 复用基础
  → refresh preview / snapping / selection

Draw/Modify/Delete 工具完成
  → executeEditCommand(s) → 同步 Store 通知触发上述链
  → 工具回调额外 syncMapFromProject → 再触发上述链
```

样式通过 replaceProject 发布一次，再通过 featuresByDataset 发布一次，因此两个发布均满足 MapCanvas 同步条件。计数测试测量的是这些**满足订阅条件的发布数**，未挂载 React/OL，不能将它当作实测 OL Source 重建数。工具回调重复同步的结论来自源码调用链，浏览器实际次数尚待专门探针。

`OlMapRuntime.syncLayers` 在 apps/packages/examples 的生产代码中未发现调用，只有声明和测试 mock/说明。阶段 4 再核实包公开 API 和外部消费后决定删除；`ol-scene-runtime` 的公开文档消费能力仍有独立用途，不能整包删除。

## 数据源能力

| 来源 | 当前边界 | 保存/写回现状 |
| --- | --- | --- |
| GeoJSON 文件/URL、memory、CSV 导入/处理结果 | vector-io + memory features，坐标缓存规范为 WGS84，sourceCrs 单列 | 工程内嵌快照及导出；没有自动原文件回写 Provider |
| Shapefile、DXF | vector-io 读取导入到本地 vector | 快照/导出，不承诺安全原位写回 |
| WFS | bounded snapshot、maxFeatures、截断、取消、世代、credentialRef | 只读，刷新失败保留旧快照；未实现 WFS-T |
| WMS/WMTS | 影像/瓦片、服务定义、运行时凭据 | 保存配置，不应硬套可写 FeatureProvider |
| 3D Tiles、模型、GeoJSON 场景资产 | Cesium schema + 本地资源协议/资源导入缓存 | 项目保留引用、节点变换与显示配置；不重写底层资产 |
| GeoPackage/PostGIS | 当前 Dataset 类型和 Tauri 命令未提供对应数据编辑后端 | 未实现，不能宣称支持 |

## 可重复计数与测试

命令：`pnpm --filter @desktop-webgis/desktop test -- src/__tests__/architecture-baseline.test.ts`。

| 要素数 | 操作 | setAll 复制条数 | snapshot 复制条数 | 满足地图订阅条件的发布 | 本次耗时 ms |
| --- | --- | --- | --- | --- | --- |
| 100 | 显隐 | 0 | 0 | 1 | 0.33 |
| 100 | 样式 | 100 | 100 | 2 | 1.97 |
| 100 | 单几何 | 100 | 100 | 1 | 0.59 |
| 10,000 | 显隐 | 0 | 0 | 1 | 0.10 |
| 10,000 | 样式 | 10,000 | 10,000 | 2 | 46.22 |
| 10,000 | 单几何 | 10,000 | 10,000 | 1 | 43.29 |

单独场景投影：100 条转换 100 个 GeoJSON Feature（3.83 ms），10,000 条转换 10,000 个（68.58 ms）。这里只统计指定的两个复制入口，**不是所有内存分配或所有克隆次数**；耗时是单次冷运行观察，不设速度阈值。测试同时断言配置 Undo、几何 Undo、原始输入不被突变。成本只输出，不将旧架构缺陷固化成预期。

- `pnpm test`：退出 0；所有 workspace 测试通过。Desktop 76 文件，400 passed / 5 skipped；gis-core 88 passed；ol-runtime 33 passed；ogc-io 有 1 skipped。跳过项没有被当成通过。当前环境有 Zustand storage unavailable 提示。
- `pnpm build`：退出 0，包含 Desktop、Viewer 与工作区包；Vite 有体积警告。
- `pnpm --filter @desktop-webgis/gis-core test -- src/project.architecture-fixtures.test.ts`：2 passed；Desktop `tsc --noEmit` 退出 0。原始测试/构建摘要与新增计数输出见[证据记录](refactor-baseline-evidence.txt)。
- 浏览器基线首先因缺少 Playwright Chromium 而无法启动；设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe` 后能运行。`workbench.e2e.ts` 的分页用例仍在引用旧“显示”文案和旧“选择”按钮/菜单名；按 HEAD 的现有语义改为“当前结果”“选择与定位”“选择当前表格结果”，保留行数、选中数、分页、焦点断言。
- 另一条既有编辑/样式切换用例等待已不存在的原生输入 `符号颜色` 而超时。当前 UI 为 Ant Design 颜色控件，页面记录显示 `点符号颜色`；此基线测试需按当前交互重新接入，未将其算作通过。三用例组合运行及分页修复重跑未正常输出最终汇总，已中断其收尾进程；没有据此声称分页、三维或整组 E2E 已通过。
- 浏览器行为、原生 Tauri/GPU、10 万/100 万性能不能由这些单元测试或构建证明，尚未完成最终验收。

## 后续阶段门槛

阶段 1 先统一 Project 模型并贯穿全部消费者、迁移和资源保存边界，不保留第二套活跃权威模型。阶段 2 切断配置操作的数据复制，阶段 3 引入真实 Provider/Buffer 垂直闭环，阶段 4 收敛增量同步；阶段 5 才用 10 万/100 万数据对比 Source/Feature/内存指标。未完成任何一个门槛均不能宣布整个重构完成。

# 同渲冻结清理

基线：`origin/main` 的 `5a58d62`，对应 [下一步计划](next-steps-2026-10-10.md) 第 3.1 节。

## 行为与调用关系

本次检查没有发现独立的“在三维使用二维图层”菜单。入口是默认运行时：Desktop 的 `city-document-session.ts` 和 Viewer 的 `city-viewer.ts` 都调用 `createCesiumDocumentRuntime`，首次加载及更新都经过 `projectCesiumDocument`。关闭这个共同入口即可覆盖两端，不新增开关或恢复同渲的配置。

二维 vector／tile 不再被转为 Cesium GeoJSON／影像节点，返回 `cesium.unsupported` 问题；完整文档仍保留资源、节点、样式、过滤及 Popup。只有原生三维节点引用的资源进入三维投影，二维专用资源变化不触发三维资源更新。原生三维 GeoJSON 可以继续引用同一 GeoJSON 资源。

旧迁移器曾把原生三维 imagery 转成 tile，混淆了归属。本次迁移改为保留 imagery 类型和 URL、透明度、层级等设置，并沿用三维节点校验。已经存成 v3 tile 的历史文件没有可靠的来源标记，保留文件内容并按二维节点处理，不猜测其原始归属；需要三维显示的影像应从原生 CityScene 重新导入。

## KEEP／REMOVE

| 决定 | 路径 | 原因 |
| --- | --- | --- |
| KEEP | `packages/scene-schema/src/document.ts` | 共享文档、迁移、资源及视图定义；原生 imagery 迁移保留原类型，避免误删三维独立能力 |
| KEEP | `packages/scene-core/src/` | 文档控制器、JSON／ZIP、资源打包与往返 |
| KEEP | `apps/desktop/src/services/scene-document-io.ts`、`scene-archive-io.ts` | 完整导入导出，不删二维内容 |
| KEEP | `packages/ol-runtime/src/`、`ol-selection/src/`、`ol-scene-runtime/src/` | 二维图层、选择和框选的独立能力 |
| KEEP | `packages/cesium-layer/src/`、`cesium-tileset-edit/src/` | 三维原生 GeoJSON／影像／模型／Tileset、编辑与资源释放 |
| KEEP | `packages/cesium-scene-runtime/src/index.ts` | 原生三维运行时、文档更新与取消安全 |
| KEEP | `apps/desktop/src/features/city/`、`features/scene/project-scene-document.ts` | 三维独立编辑及共享文档宿主适配 |
| KEEP | `apps/viewer/src/city-viewer.ts` | 三维 Viewer，沿用同一已关闭同渲的运行时入口 |
| REMOVE | `packages/cesium-scene-runtime/src/document.ts` 内的 tile／vector 转换分支 | 明确只为同渲服务，改为报告并跳过节点 |
| REMOVE | 同文件内 `colorFromLayerStyle`、符号颜色转换、`filterFeatureCollection`、`matchesFilter` | 搜索调用方仅为上述转换及其测试；不影响二维样式或过滤 |
| REPLACE | `packages/cesium-scene-runtime/src/{document,map-projection,runtime}.test.ts` | 同渲成功断言改为不渲染、完整保留及原生内容不受影响的回归 |

旧 S00–S10 文档保留作历史，不重新执行；不删除公共包目录或协议结构。本次没有需要另外保留为“实验能力，未启用”的生产路径。

## 验收

- [x] 工程验证：用户默认行为没有二维节点在三维中的自动渲染。
- [x] 产品确认 KEEP／REMOVE 边界；2026-10-11 用户授权当前任务承担产品验收，复核后 PR #44 squash 合入 `e684ab4`。
- [x] 构建与已有测试门禁通过，导入导出及原生三维资源没有回归。

2026-10-11 验证：

- `pnpm -r build` 通过，包含 Desktop、Viewer 和各运行时包；仍有既有大块体积及静态／动态混合导入警告。
- `pnpm -r test` 通过，Desktop 206 项通过、5 项跳过，OGC live smoke 1 项跳过；Cesium runtime 33 项通过。
- 后续补充的影像结构 schema 测试：`pnpm --filter @desktop-webgis/scene-schema test` 26 项通过；`python packages/scene-schema/verify-document-schema.py` 通过。
- 浏览器：scene-document／selection 在三种窗口共 42 项通过；city-document 在测试数据修正后定向重验，三种窗口共 3 项通过。后者验证真实 GLB 像素、显隐、变换、撤销／重做、导出、失败重试，以及二维 XYZ 零渲染请求。不是同一轮 45 项全部成功。
- 新增测试数据最初不符合当前工程导入约束，已修正 URL、要素 ID 及底图角色。Desktop 导入导出规范化底图 ID；断言检查数据及 URL 保留，不承诺 ID 字节级往返。
- `git diff --check` 通过。

未新增 Windows 原生文件窗口或硬件 GPU 验收。产品勾选后再合入，不自动推送 main。

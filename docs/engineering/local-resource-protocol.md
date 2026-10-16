# 本地场景资源协议

M6 的第一层实现为原生 `webgis-resource` 协议。它按受控目录读取原文件，不复制大型模型，不把根 JSON 改成丢失 base URL 的 Blob。项目引用模型、保存路径重算与重定位界面继续在下一层接入，本文件不表示 M6 已整体完成。

## 宿主接口

- `grant_local_resource_directory(directory)` 返回随机 key、目录 base URL 及真实目录。宿主只能为已授权的项目目录或用户选择目录调用，不能从任意项目内容自动授权外部路径。
- Windows base URL 为 `http://webgis-resource.localhost/<key>/`。路径保留目录层次，子瓦片、GLTF buffer、纹理和嵌套 JSON 可按标准 URL 规则解析；Unicode 文件名按 URL 编码传输。
- key 使用系统随机数生成，目录最多 256 个活动授权；`revoke_local_resource_directory(key)` 释放指定授权，旧 URL 不再读取文件。URL/key 是运行时能力，不应写入正式项目或恢复草稿。
- 请求仅支持 GET、HEAD、OPTIONS；限制来源到当前 Tauri 页面 origin。文件每次 canonicalize，拒绝目录遍历、编码分隔符、NTFS ADS、符号链接/junction 越过已授权目录、未授权 token 和目录请求。
- 文件 IO 在 Tauri blocking runtime 执行。单次响应最多 512 MiB，较大文件可通过范围读取取得较小片段；没有宣称大规模目录/GPU 性能已验收。

## HTTP 与文件行为

- 按扩展名提供 JSON、GLTF、GLB、PNG/JPEG/WebP、KTX 等 MIME，其他二进制为 `application/octet-stream`。
- 单段 Range 支持首尾范围、开放末端、后缀、超大整数和 `Content-Range`；不可满足的范围返回 416，文件不存在为 404，授权/路径错误为 403。
- HEAD 忽略 Range，仅返回完整表示的元数据；未知单位、多段 Range 回退完整读取。未提供匹配验证器的 If-Range 回退完整请求；缓存为 no-store。依据：[RFC 9110 §14](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.2)。

## 当前证据

`rtk cargo test --lib --locked`：21 项通过，另两个退出探针由父测试执行。新增协议单测覆盖嵌套 Unicode 文件、MIME、范围/HEAD/If-Range、实际 Windows junction 越界、授权撤销、目录数量和大文件响应限制。

`rtk proxy node apps/desktop/scripts/native-recovery-acceptance.mjs` 最终退出码 0，真实 Tauri/WebView2 的验证包含：

1. 从既有真实 GLB 提取几何，生成带外部几何 buffer、UV buffer 和 PNG 纹理的 GLTF，按子 URL 请求全部依赖并比较字节。
2. PNG 在原生 Canvas 中生成，经过协议后由 `createImageBitmap` 实际解码为 1×1；保留解码断言，不只验证文件传输。
3. 两类 Range 返回 206 及正确字节，HEAD 返回 200/正确长度，缺失文件 404，越界与撤销后请求 403。
4. 原有二维属性及三维真实 GLB 的强制退出恢复、原生保存清理、模型显隐像素对照继续通过；结束后恢复普通 debug 配置。

[最终原生报告](../design/desktop-productization/evidence/native-local-resource-protocol-report.json) 对应 `com.desktop-webgis.recovery-acceptance-1791974348928`。本次外部 GLTF 依赖验证为协议传输/解码证据，不冒充该 GLTF 在产品中的导入、保存重开、另存或重定位验收。

## 持久引用与项目文件 IO（2026-10-14）

`ResourceReference` 区分 `relative/path`、`absolute/path` 与 `url/url/credentialRef`。本地资源路径不作 URL 解码，中文、空格、`%` 与 `#` 保留；Windows 盘符及 UNC 路径规范化，禁止盘符相对路径、ADS 和越过盘符/共享根目录。在线引用拒绝明文认证及临时目录授权 URL。

旧 URL 资源继续读取，引用字段为兼容扩展。模型、Tileset 和三维 GeoJSON 的引用在旧场景迁移、SceneDocument v3、Desktop 桥与运行时投影间保留，不制造页面相对 URL。未准备数据的引用资源不能冒充已加载的二维数据集。

原生项目打开时将带类型的相对引用解析为工作副本中的绝对路径。保存仅对待写入副本重算：目标目录内文件使用相对路径，目录外或跨盘文件保留绝对路径；不复制资源，不修改编辑状态和撤销历史。另存文件对话框打开前捕获来源项目路径，期间切换项目不会改变旧快照的解析基准。临时协议 URL 不允许作为模型资源 URL 写入该链路。

该批验证：全仓构建/单测通过；Desktop 最终生产构建通过，268 项单测通过、5 项原有环境项跳过；1366×768 全量浏览器 E2E 60 项通过。引用专项覆盖中文路径、UNC、跨盘另存、重开等价、源对象不变、临时 URL 拒绝与对话框期间项目切换。浏览器 E2E 验证既有真实模型与保存/恢复工作流，本地引用的原生渲染组合尚未验收。

后续须接入原生目录授权生命周期、父目录重定位及统一添加数据界面，完成实际 GLTF/Tileset 的引用加载和另存重开组合。系统文件选择、Windows 125% 缩放、两套不同变换 Tileset 的 LOD/效果/GPU 清理仍保持未签收。

## 运行时引用解析与授权生命周期（2026-10-14）

`createCesiumDocumentRuntime` 的 `resolveReference` 回调只处理脱离源文档的渲染副本。返回的协议 URL 用于模型、Tileset、GeoJSON 加载；`getDocument()`、Project、保存文件与草稿保持原始引用。准备阶段检查 AbortSignal 和更新序号，失败或过期的解析不能替换已显示场景。

Desktop 的 `createLocalResourceSession` 为挂载的三维工作区复用项目目录授权。目录外资源必须显式授权；路径采用分段比较，不能通过同名前缀目录扩大范围。工作区销毁先结束运行时，再撤销目录授权；销毁后才返回的异步授权也会撤销。项目 ID 相同但 epoch 不同时重新挂载，防止重新打开项目复用前一个会话的授权。

新项目第一次保存后，现有会话读取新的资源基准。恢复的未保存副本保留来源项目的资源基准，正式保存路径仍为空；该基准受 epoch 隔离，不继承到下一个项目。正式文件与草稿比较时规范化相对引用，避免仅因磁盘相对路径/工作绝对路径不同误判内容。

真实 Tauri 验证将 URL 模型改为 `本地模型/塔楼 #%.glb` 对应的本地绝对引用，检查相对路径正式文件不含临时 URL；强制退出、草稿恢复后重新显示模型，再经原生保存链路写入新文件。模型显隐像素为 65359→17197→65349。[报告](../design/desktop-productization/evidence/native-local-reference-report.json)、[恢复截图](../design/desktop-productization/evidence/native-local-reference-restored.png) 对应隔离应用 `1791979440848`，结束后恢复普通 debug 配置并关闭自有应用/服务。

全仓构建及单测通过，Desktop 271 项通过、5 项原有环境测试跳过；laptop 全量浏览器 E2E 60 项通过。当前原生渲染证据覆盖 GLB；外部 GLTF 依赖仍只有协议传输/解码证据，Tileset、GeoJSON 引用加载、正式文件重新打开、跨目录另存与父目录重定位仍须专项验证。通用添加数据窗口和显式目录授权入口尚未接入，本地引用案例通过验收夹具准备。系统文件选择器与 125% 缩放未签收。

## 文件和目录重定位入口（2026-10-16）

三维对象的“数据源”检查器现可打开“重新定位本地资源”，选择替换当前文件或所在目录。目录模式以所选资源的旧父目录为基准，逐一预览受影响对象和新旧路径，只替换相同目录及其子目录中的引用。Windows 原生选择器返回的目录，或用户明确填写并应用的目录，进入当前资源会话的授权范围，底层仍由原生目录协议检查规范路径。

应用仅更新资产引用，保留节点、变换、样式和依赖文件的相对结构，并提交一个可撤销命令。不移动磁盘文件；加载失败仍保留对象和失败状态以便重试。工程 epoch、资产引用冲突及继承锁均在提交前检查；任何一项失败都不会部分更新引用。

浏览器 E2E 已覆盖目录预览、取消、一步撤销/重做、真实项目下载和重新打开；单元测试覆盖单文件替换、目录隔离、冲突、锁定和另存路径重算。本节更新的是产品引用流程，Windows 文件/目录选择、外部 GLTF/Tileset 的真实依赖加载及跨目录另存组合仍待原生验收。此前章节的批次结果按历史记录保留。

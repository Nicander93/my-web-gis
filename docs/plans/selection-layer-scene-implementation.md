# 选择、图层与场景 API 实施记录

日期：2026-10-08。对应[完整计划](selection-layer-scene-public-api.md)。目标保持 S00–S10 全部范围；此记录不是缩减后的完成声明。

## 首批实现：163d688

代码提交：`163d688`（`feat: extract controlled OL selection and link box selection to table`）。未推送。

| 阶段 | 当前证据 | 尚需完成 |
| --- | --- | --- |
| S00 | 选择身份为 layerKey＋typed featureId；工作台仍使用字符串 ID；普通替换／Shift 追加／Alt 移除；同像素命中保留当前目标层的全部结果；已选中行普通单击幂等，Ctrl／勾选显式切换 | 旧协议与复杂场景样本基线、完整包依赖矩阵、锁定对象语义及其他协议决策 |
| S01 | 独立 ol-selection、框选、真实几何精筛、旋转／孔洞／世界副本、空间索引、宿主确认、持续高亮、源变动／Esc／失焦取消、释放；独立生命周期与 tarball JS／类型检查；图层及父分组 extent 精确裁剪、多部件／集合／圆的纯几何回归；三个窗口尺寸的旋转地图父分组裁剪真实拖框 | 更多复杂／坏几何、目标切换／晚到事件、浏览器大数据与原生验收；当前为 private 候选，未通过完整公开门槛 |
| S02 | OlSelectionRuntime 成为薄适配；Store 过滤后的集合反馈高亮；框选绑定属性表、清搜索／页码、只看选中；工具停用保留高亮，销毁显式释放 | 全量过滤／刷新／删除和绘制／修改互斥组合、异步 WFS／隐藏分组及中途切目标交互证据 |
| S03 | 只读双击／Enter／单条按钮定位；可编辑单元格仍用于编辑；选择菜单批量定位全部选中；零结果状态／分页 | 表格行菜单、选中集合跨页定位、键盘编辑冲突、样式草稿保护的新增针对性证据；原生路径 |
| S04 | v3 SceneDocument 资源／节点／视图、分组引用与循环校验；旧 Manifest v1/v2 和 CityScene v1/v2 迁移、跨引擎 ID 冲突重映射；纯资源／节点／视图／环境操作；扩展保留与不支持版本报告 | 完整 ProjectSnapshot 双向适配、字段／WFS 原始定义、JSON Schema 一致性、完整迁移报告、复杂真实文件往返及语义边界；尚未完成阶段签收 |
| S05–S10 | 原有 runtime／IO 与消费脚本保留；scene-core 已移除工程依赖 | OL／Cesium 工厂收敛、内容真源、完整场景／资源包导入导出、Viewer 一致性、各候选包的签收门槛 |

现有公共包候选审查已经写在计划第 10 节。不能因选择包 tarball 检查通过，就将 ogc-io、vector-io、spatial-analysis 或其他场景包标为可公开消费。

## 验证

| 命令／路径 | 本轮结果 | 覆盖边界 |
| --- | --- | --- |
| `pnpm --filter @desktop-webgis/ol-selection build` | 通过 | 类型声明和 ESM 编译 |
| `pnpm --filter @desktop-webgis/ol-selection test` | 6 通过 | ID／集合、线 bbox 误命中、孔洞／边界、旋转／世界副本、索引粗筛不全量扫描 |
| `pnpm --filter @desktop-webgis/ol-runtime test` | 18 通过 | 原要素适配、注册、编辑捕捉、可见要素和 WMS／WMTS 请求 |
| `pnpm --filter @desktop-webgis/desktop test` | 149 通过、5 跳过 | 现有 Store／工作台／数据与编辑规则；跳过的是独立平台验证 |
| `pnpm --filter @desktop-webgis/desktop build` | 通过 | 最终 Desktop 编译；原有大 chunk 和混合动态／静态 import 提示仍在 |
| `playwright test selection.e2e.ts` | 最终串行运行 12 通过 | 三种尺寸真实拖框、Shift／Alt、空集合、双击、Esc、主动点击、切平移、独立控制器资源释放 |
| `playwright test workbench.e2e.ts` | 27 通过 | 起始页、CSV、Help、分页／选择、过滤／草稿、编辑目标、处理、三维工作台 |
| `pnpm --filter @desktop-webgis/ol-selection verify:consumer` | 通过 | OS 临时目录独立 tarball 安装，Node 无 DOM 导入、几何 smoke、NodeNext 类型；OL 10.10.0 |
| `git diff --check` | 通过 | 本轮文本空白检查 |

浏览器使用 `C:/Program Files/Google/Chrome/Application/chrome.exe`，配置启用 SwiftShader；窗口为 1024×680、1440×900、1920×1080。OSM 请求主动中止，因此这些结果不证明联网底图或原生 GPU 渲染通过。未进行新的 Windows Tauri 文件／窗口／DPI 验收。

默认 Playwright 缓存不存在，最初两项启动失败。独立消费 fixture 最初缺少直接 devDependency，已补全。新增零集合场景揭示选中数为零时不显示计数，已修正。一次同时进行构建／pack 的开发服务器验收出现动态观察模块返回 null；停止产物重写后串行重跑 12 项全部通过。以后 E2E 与重写 dist 的构建／pack 顺序执行，避免 HMR 干扰。

浏览器 fixture 不写 Store 来伪造选择：数据经文件输入和确认导入，选择／拖框／取消／定位通过真实鼠标或键盘；只读取真实运行时来获得像素和最终状态。独立 lifecycle fixture 只消费 OL 与选择包，不消费工作台 Store。

## 点数据性能基线

命令：`pnpm --filter @desktop-webgis/ol-selection benchmark`。单次测量，Windows x64、Node v24.11.0、Intel Core i5-14600KF、OL 10.10.0。

| 点数 | 命中候选／结果 | 源构建 ms | 索引＋精筛 ms | 集合移除 ms |
| --- | --- | --- | --- | --- |
| 1,000 | 11／11 | 6.69 | 0.73 | 0.36 |
| 10,000 | 110／110 | 40.90 | 0.57 | 1.24 |
| 100,000 | 121／121 | 285.07 | 0.43 | 8.90 |

这只覆盖 Node 点 Source／索引／几何和集合运算，不包含浏览器绘制、复杂线面、全部选中时的高亮开销或真实用户端到端延迟。不能据此宣称十万要素 UI 验收完成。

## 下一步与完整完成判定

继续补齐 S01–S03 剩余矩阵，同时准备 S04 的真实旧二维／三维样本和 schema 迁移。阶段完成必须按 T01–T24 对照源码、测试和交互证据签收；完整目标仍包括统一场景内容真源、双引擎图层工厂、全场景／资源包往返、Viewer 和每个公共候选的消费证据。当前不满足完整完成条件。

## 后续批次：裁剪验收与纯场景包边界

- 995c941 已补图层／父分组裁剪的精确几何判定。新增浏览器用例通过三个窗口尺寸的实际鼠标拖框，旋转视图中只接受父分组裁剪范围内的要素。最初测试起点命中缩放控件，调整到地图画布后通过。
- ProjectSnapshot 到发布场景的编译器及其原有测试移入 Desktop features/scene；scene-core 根入口、package dependencies 和 lockfile 不再依赖 gis-core。既有调用迁移到应用适配器，发布转换语义保持原状。
- 本批验证：scene-core 构建、5 个测试；Desktop 151 个测试通过、5 个既有跳过；Desktop 构建通过（既有大块与动态导入警告）；裁剪 E2E 3 个通过。
- 这项拆分仅解决公共包的工程依赖边界。完整场景协议、全量保存与发布快照区分、资源包、双引擎工厂、独立 tarball 消费及原生验收仍按 S04–S10 推进。

## 后续批次：统一文档 v3 与纯操作

- 在既有 scene-schema 包内增加 SceneDocument v3 和明确迁移入口；旧 parseScene v1/v2 兼容入口不变。实际资源、节点、视图使用判别联合，父分组使用统一 parentId，跨引擎资源／节点冲突 ID 同步重映射。
- 保留已有二维样式／Popup、全量内嵌数据、三维分组／变换／相机／环境；vector 保存过滤定义而不删数据。扩展 JSON 保留并报告未知必需版本；拒绝不合法引用、循环分组、原生实例、循环及非有限 JSON。
- scene-core 提供纯资源／节点增删改、显式级联删除、分组移动、视图／环境更新及文档序列化。输入不变，结果校验；暂未优化大文档深复制。
- [协议规范](../specs/scene-document-v3.md)列出已实施约束和缺口。当前尚无 v3 JSON Schema、完整 ProjectSnapshot 双向适配或引擎消费，不代表 S04–S10 完成。
- 验证：scene-schema 构建与 22 个测试、scene-core 构建与 8 个测试；scene-publisher 和 ol-scene-runtime 各 8 个既有测试通过；Desktop TypeScript noEmit 通过。未增加原生或渲染验收声明。

## 后续批次：完整工程转换与 WFS 快照

- 增加应用侧 `createProjectSceneDocument` 和 `createProjectFromSceneDocument` 纯转换入口。完整导出保存过滤前数据、共享数据集、未使用资源、二维分组、三维对象及视角，不复用发布快照的过滤语义。
- WFS 资源保留服务定义、本地快照、数量、分页和完整性标记；认证只保存引用。数量不匹配、截断却声称完整、非法 GeoJSON 或重复的同类型 ID 会被拒绝。
- 资源支持字段模式及要素来源元数据。元数据键使用 `string:` / `number:` 前缀，数字 ID 与字符串 ID 在宿主中映射为不同身份，重新导出时恢复原值。
- 分组 scope 校验覆盖整个祖先链，防止二维节点进入三维分组。工程适配器目前明确拒绝无法表示的视图约束、扩展与展示配置；通用文档导入的保留能力、资源准备和 Store 事务仍待后续阶段完成。
- 验证：scene-schema 构建和 25 个测试通过；Desktop 158 个测试通过、5 个既有平台测试跳过，生产构建通过。构建仍有既有大 chunk 和混合导入提示。新增的 7 个转换测试覆盖混合场景、共享资源、空数据字段模式、数字／字符串身份及 WMS／WMTS 认证往返。此证据不代表文件菜单、原生运行或 S04–S10 全部完成。

## 后续批次：OL 工厂生命周期与迟到请求

- 完整工程恢复保留没有三维视图的未使用三维资源、显式三维空分组；新增转换测试通过（该文件现有 8 个测试），Desktop 类型检查通过。
- `createOlLayerHandle` 暴露原地图层、保持实例的显示／样式更新与幂等销毁。调用方提供共享 VectorSource 时保留源所有权；默认源及 Provider 子层由句柄释放。创建 Promise 只承诺原生对象完成创建，远程内容加载不包含在内。
- 现有 OlSceneRuntime 接入句柄。新场景先准备全部图层再替换旧场景，准备失败保留旧内容；新加载和销毁取消上一创建请求，迟到 Provider 结果释放后拒绝提交。创建 Runtime 的初始加载失败时释放 Runtime。
- ol-scene-runtime 构建及 13 个测试通过，其中迟到请求／失败恢复使用替代 Map 表面测试真实异步工厂，不能代表浏览器绘制或原生窗口通过。Desktop 生产构建通过，仍有既有大 chunk 与混合导入提示。
- S05 尚需共享资源注册、v3 能力报告、编辑器创建路径收敛、属性差异更新及真实浏览器生命周期验证；此批不将旧 Manifest 播放器升级视为完整双引擎门面完成。

## 后续批次：原位场景更新与外部 Map 所有权

- Manifest 播放器在资源、视图、控件与图层身份／类型不变时原位更新显示、样式和顺序，保留图层及源实例。先编译全部样式，避免不支持样式导致部分更新。其余更新仍走全量准备与替换；尚未覆盖资源局部增删差异。
- 新增 `getScene()` 隔离副本；显隐和透明度便捷 API 同步声明式内容。原生实例直接改动不自动反向同步。
- 支持传入已有 Map；仅移除运行时拥有的图层和交互，销毁时注销自己的 Map 事件，不清空宿主控制器、不 dispose 外部 Map 或解除其 target。加载仍应用场景 View，由宿主决定加载时机。
- 验证：ol-scene-runtime 构建通过、15 个测试通过；Desktop TypeScript noEmit 通过。新增测试覆盖顺序更新复用实例、内容副本隔离，以及外部 Map 宿主内容跨替换／销毁保留。测试 Map 表面仍为替代实现，真实浏览器与原生门槛待验收。

## 后续批次：v3 OL 文档创建与共享资源

- `createOlDocumentLayers` 使用 v3 resources/nodes/views 创建根图层及真实分组；父组显隐不改写子节点。宿主负责挂载／移除，工厂释放自建句柄、分组和共享源。
- 同一资源多个节点共享完整矢量源，节点过滤作用于样式及节点查询集合，不烘焙数据。内部 ID 编码区分数字与字符串；原身份通过 `getSceneFeatureId` 读取，支持 idField，重复身份拒绝而非由 OL 静默丢弃。
- URL GeoJSON 下载一次、校验后创建；WFS 保存缓存直接显示，返回缓存提示并保留完整性标记。OL 不支持的三维节点／分组返回能力问题，原文档保留；未知必需扩展及暂未实现的认证瓦片请求明确阻断。
- ol-scene-runtime 构建及 22 个测试通过（含 7 个 v3 工厂测试），Desktop 生产构建通过。工厂测试使用实际 OL View／Source／Layer，未启动浏览器绘制；Map 生命周期测试继续使用替代表面。
- 仍需接入编辑器及发布 Viewer、节点增量更新、认证请求与 WFS 刷新、双引擎能力报告统一格式、v3 JSON Schema、独立 tarball 消费及真实渲染验证。此批不代表 S04–S10 完成。

## 后续批次：v3 Cesium 投影与外部 Viewer

- Cesium Runtime 依赖统一 scene-schema 协议。`projectCesiumDocument` 校验文档并投影既有原生城市对象、资源、相机与环境；原始完整文档保留。嵌套三维分组状态仅在投影中派生，不覆写源节点；未知必需扩展阻断，未实现共享二维节点返回能力问题。
- `createCesiumDocumentRuntime` 接入既有 CitySceneRuntime，并等待图层及环境加载后返回。当前底层编辑仍由宿主回写文档，不能将此创建入口视为 S07 单一内容真源门面。
- `createCityRuntime` 支持调用方 Viewer，默认不拥有；释放自有图层和底图并恢复原地形／光照／时间，保留外部 Viewer。旧直接构造行为兼容，调用方可显式 `ownsViewer: false`。创建后相机或质量初始化失败会释放 Runtime。
- Cesium Runtime 构建和 16 个测试通过；Desktop 生产构建通过（既有大 chunk 与混合导入提示仍在）。新增 3 个纯投影测试及运行时所有权／环境恢复测试使用替代原生加载，不代表真实 GPU、模型、水面、原生窗口验收通过。
- S06 尚需共享二维 GeoJSON／服务能力、完整资源准备、失败／取消事务、原生变换及水面回归；S07–S10 与协议 JSON Schema 门槛继续保留。

## 后续批次：统一内容控制接口

- scene-core 新增 `SceneController`，资源、节点、分组、视图、环境及便捷显隐／锁定／透明度／变换都修改同一 v3 文档。`addTileset` 一次加入资源与节点，显式复用匹配资源，冲突定义拒绝；导出包含 API 新增内容。
- 同步 transaction 在隔离草稿中一次校验、一次通知；无效／抛错／异步／嵌套写入不改文档，no-op 不产生通知。观察者收到隔离 before/after，失败在提交结果中报告，不撤销已提交内容。控制器不拥有引擎、选择、IO 或 Undo 栈。
- 验证：scene-core 构建和 13 个测试通过，Desktop TypeScript noEmit 通过。测试包括声明式／便捷更新等价、完整导出、批次原子性、外部副本隔离、观察者失败和特殊资源字典键。
- 当前仅实现公共内容控制层，尚未将 Desktop Store、引擎准备与历史适配接入；异步加载成功后提交、一次撤销恢复、公开消费者与大资源增量性能仍需完成，S07 不签为完成。

## 后续批次：完整内容的应用历史适配

- gis-core 新增 `ReplaceProjectSnapshotCommand`，工程配置与全部要素数据复用既有 EditHistory；移除不再存在的数据集缓存，撤销／重做恢复完整快照。命令输入隔离复制，可选宿主 `replaceSnapshot` 路径一次写入工程与要素。
- Desktop Store 增加 `replaceSnapshotAsEdit`，保留此前历史；显式场景替换后清理选择和编辑目标，不重置布局。每次替换、撤销、重做取消 WFS 请求并提升加载世代，阻断旧响应写入。
- `replaceSceneDocumentAsEdit` 先完成纯转换与支持能力检查，再进入历史；当前要求调用方已完成资源准备和草稿保护。此入口尚未连接文件菜单，不将命令单元测试当作交互导入验收。
- 验证：gis-core 构建及 69 个测试通过；Desktop 全套 163 个测试通过、5 个既有平台测试跳过，生产构建通过。新增应用用例覆盖完整快照一次撤销／重做、无效扩展不写入、此前历史保留及旧 WFS 取消。
- 仍需资源包／URL 准备、替换／合并交互与旧草稿保护、协议无法表示配置的无损保留、Store 与统一控制器的完整同步、真实浏览器／原生 IO 验收。S07–S08 未完成。
# 完整场景文件入口：桌面应用接入进展

- 项目菜单和三维操作入口统一使用 v3 场景导入、完整导出；对象子集导出仍是单独操作。
- 导入先解析、迁移、检查敏感字段并完成纯转换，再通过既有撤销历史替换内容；取消、解析失败和选择文件期间项目变化不会替换项目。
- 完整导出保留过滤前的数据与过滤配置，捕获当前二维视图及已挂载三维相机，不改变 `.webgis.json` 保存路径或项目修改状态。
- 验证：桌面端 166 项测试通过、5 项环境测试跳过；新增相机生命周期测试通过；桌面生产构建通过。真实 Chrome 在三个窗口尺寸验证导入、属性表过滤、完整下载、撤销与重做，共 3 项通过。
- 当前限制：相对资源路径准备、资源包、合并导入、草稿决策统一交互及原生文件对话框验收仍需完成。本阶段不代表 S08 或完整计划已经完成。
# v3 JSON Schema 公开文件进展

- 新增独立 `scene-document.schema.json` 包导出，保留旧版 Manifest Schema 入口；文件自包含，两种引擎的结构引用不依赖仓库路径。
- 提供生成脚本复用现有样式和三维定义，补齐 v3 分组、资源、视图、WFS 快照和扩展结构。
- 验证：scene-schema 26 项测试通过；Python jsonschema 的 Draft 2020-12 元校验及有效／无效文档样例通过。
- 边界：结构 Schema 尚不证明完整语义一致性，资源引用、循环、跨字段数量、几何等约束仍以 `validateSceneDocument` 为准。完整 Schema 与语义校验一致性矩阵和外部 tarball 消费仍需补充。
# Schema 一致性修正

- 修复 URL GeoJSON 与三维资源分支重叠导致 `oneOf` 拒绝有效文件的问题；v3 矢量节点只接受共享 LayerStyle。
- 增加 GeoJSON 要素、全部几何类型的坐标结构及扩展命名空间约束，保留语义校验对闭环、引用与数量一致性的职责。
- 新增可重复执行的实际 Draft 2020-12 校验脚本，覆盖资源、几何、非法坐标、旧样式与非法扩展名称；脚本及 26 项协议测试通过。
# 声明资源清单与 URL 基准解析

- scene-core 提供声明资源清单及 HTTP(S) 场景 URL 基准解析，覆盖资源主地址、WMTS 多地址、三维底图和地形；解析结果不修改输入并保留瓦片模板。
- scene-core 14 项测试及构建通过。
- 当前协议对部分相对路径有约束，原生目录适配、依赖递归发现和资源准备事务仍未完成；本批公共函数尚未接入桌面文件导入，因此不将 T17 标记通过。
# GeoJSON 导入前准备事务

- 公共 API `prepareSceneGeoJsonResources` 使用宿主加载回调，重复资源只准备一次；逐项校验，失败、取消及迟到结果不会返回半完成文档，也不修改输入。
- Desktop 在替换项目之前准备二维矢量 URL 资源：原生相对文件按所选场景目录读取，HTTP(S) 使用现有网络通道；浏览器相对目录不可访问时明确失败。认证资源适配与用户取消交互仍待补充。
- 验证：scene-core 15 项测试、桌面场景 IO 4 项测试及两端构建通过；原生路径测试为文件服务 mock，尚未完成 Windows 原生验收。
- 模型／纹理、嵌套 tileset、资源包归档及三维共用矢量准备仍未完成，不将整个 S08 标记完成。
# 导入取消与迟到结果保护

- 项目菜单在导入任务存在时提供取消入口；取消信号传递至 GeoJSON 网络请求及准备流程。
- 连续导入自动取消旧任务，命令提交前再检查取消状态；旧文件选择／忽略信号的加载器迟到返回不能覆盖新结果。
- 场景 IO 5 项测试、命令迟到结果测试和类型检查通过。原生对话框的关闭行为仍由宿主控制，取消后即使返回文件也不会提交。
# 全场景合并纯事务

- `mergeSceneDocuments` 保留双方资源和视图，修复冲突资源／节点／分组父引用／凭据引用，输出完整 ID 映射；预留传入后缀 ID，避免修复时抢占其他节点身份。
- 共享环境、主题、演示或元数据冲突明确拒绝；不透明扩展存在 ID 冲突时要求扩展适配器，防止无法识别的内部引用失效。
- 验证：scene-core 18 项测试及构建通过，包括原文档不变、失败原子性和特殊 JSON 字典键。
- Desktop 现有 Project 适配器不能表达同引擎多视图，合并菜单仍未接入；该纯 API 不代表应用合并导入和 T16 已完成。
# 三包真实 tarball 消费

- 构建并 pack cesium-scene-schema、scene-schema、scene-core，在独立 workspace 从 tarball 离线安装完整依赖链。
- Node 运行验证 Schema 文件导出、资源准备、合并、完整文档重新解析及无 workspace 协议泄漏；严格 NodeNext TypeScript 声明消费通过。
- 新增可重复生成消费者的脚本和执行文档。仅证明这三个包的内容 API 消费，不代替 OL/Cesium 渲染、其他候选包、兼容矩阵或许可证门槛。
# 资源准备与取消真实浏览器路径

- Chrome 菜单／文件选择／下载路径覆盖远程 GeoJSON 准备成功并导出内嵌数据、HTTP 503 失败保留原空项目、加载中菜单取消、完整过滤前数据导出与撤销重做。
- 三种窗口尺寸共 12 项通过，未用直接写 Store 代替交互；网络使用受控响应，尚不证明真实服务或原生文件目录验收。
# 同 ID 图层会话失效修复

- 完整内容替换与 loadSnapshot 清空旧图层会话，避免 ID 重用时继承旧样式草稿、表内搜索、页码和仅选中状态；撤销场景内容后按恢复的定义重新初始化面板。
- 新增同 ID 替换／撤销／重新打开测试，桌面全量 171 项通过，5 项环境测试跳过。
- 未应用草稿的场景导入仍由命令入口保护；统一所有历史操作的草稿决策交互仍需单独完成。
# 场景历史恢复的草稿保护

- EditHistory 提供不消耗历史的下一命令检查；Desktop 在完整场景替换、撤销和重做前检查未应用样式草稿。
- 被阻止时原场景、草稿、历史位置不变；二维、样式和三维命令入口提供原因提示。普通非场景编辑不因本检查被阻止。
- Desktop 172 项测试通过、5 项环境测试跳过；GIS 核心 69 项通过。当前交互为保留并提示处理草稿，统一的应用／放弃／取消决策弹窗仍未完成。
# 场景导入草稿决策 UI

- SceneDraftDialog 在导入前提供应用草稿、放弃草稿和取消三种选择，复用既有 layerCommands；没有决策 UI 时拒绝继续，取消不修改草稿。
- 先处理草稿，再检查项目保存决策；应用草稿属于真实历史修改，随后取消文件选择仍保留已应用修改。
- 决策守卫与连续任务测试通过，类型检查通过。撤销／重做的弹窗尚未接入，仍保留并提示，避免应用草稿新增历史后改变用户原本要恢复的命令。
# 草稿决策真实浏览器验收

- 通过菜单导入和真实样式颜色输入验证取消保留草稿、放弃继续、应用继续、项目保存决策、替换后一次撤销恢复；应用路径恢复后保留已应用红色样式。
- 三个窗口尺寸共 6 项通过，未直接写 Store；新增验收不替代原生窗口和历史恢复决策弹窗。
# 历史失败重试边界

- EditHistory 的撤销／重做在命令成功后才移动历史记录，失败仍保留原命令以便宿主修复后重试。
- GIS 核心 70 项测试及构建通过；覆盖失败撤销、失败重做、历史计数、同一命令重试与未改变的模拟内容。
- 该修复只保证历史记录不因异常丢失，命令内部的部分原生副作用仍必须由准备／提交事务保护，不能据此将所有引擎失败恢复标为完成。
# 三维加载复用与迟到失败

- 复用加载中的原生图层时，updateScene 等待同一准备任务，加载完成后使用最新变换、质量和显隐状态，避免提前宣布场景完成。
- 用当前声明图层身份区分主动移除与资源失败，旧对象迟到失败不污染后继场景；当前资源失败仍报告，可通过下一次更新重试。
- 三维运行时 18 项测试及构建通过，新增等待复用、加载中移除、迟到失败与当前失败重试用例。测试替换原生加载器，尚不证明 GPU／真实服务或整场景原子提交完成。
# 控制器异步准备与内容提交

- SceneController 提供 prepareAndReplaceDocument，候选文档在状态外准备并校验后一次提交；宿主可组合 GeoJSON 准备函数和其他资源适配器。
- 新加载、内容编辑、主动取消及销毁使旧结果失效，即使加载器忽略信号也不能覆盖后续内容。
- scene-core 20 项测试及构建通过，覆盖延迟期间旧内容可读、成功单次通知、失败不通知，以及四种迟到失效场景。
- 此公共控制器尚未替换 Desktop Store，原生引擎分阶段准备与提交仍由宿主接入，不将 S07 完整真源绑定标记完成。

## 2026-10-09：v3 OL 文档挂载生命周期

- 新增公开 `OlDocumentRuntime`，复用 `createOlDocumentLayers`；准备成功后替换所属图层与视图。加载失败保留已有文档、图层和视图；挂载失败回退；新加载、取消、销毁阻止迟到请求提交。
- 外部 Map、无关图层、控件与交互由宿主持有；销毁只移除所属图层，在视图仍为本运行时设置时恢复原视图。内部 Map 销毁，重复销毁幂等。
- 验证：OL package 构建、26 个测试（新增生命周期 4 项）、Desktop TypeScript／生产构建通过。测试使用 Map mock 与真实 OL 图层／Source，不作为浏览器、原生 Windows 或 DPI 验收。Desktop 构建仍有既有动态／静态混合导入和大 chunk 警告。
- 范围：这是 S05 的挂载基础，尚未完成增量更新、SceneController 绑定、Desktop／Viewer 路径迁移；`getDocument()` 不捕获原生改动或实时相机。不据此签收 S05、S07 或 S09。

## 2026-10-09：v3 OL 节点显示属性增量更新

- `OlDocumentLayers.updatePresentation` 与 `OlDocumentRuntime.updateDocument` 原位更新显隐、透明度、缩放限制、样式、过滤；保留原生图层、共享完整 Source 和当前地图 View。过滤清除后恢复完整绘制，不累积旧过滤包装。
- 资源、视图、节点顺序／身份／分组结构或文档其他顶层内容变化走准备替换；无效文档在任何 setter 前拒绝，全部样式先编译。宿主监听器在原生 setter 中抛错尚不提供事务保证。
- 验证：OL 构建、28 个测试通过。新增过滤修改／清除、共享源与实例保持、资源变化替换和无效透明度拒绝证据。测试仍为 Node 中的 Map mock 与真实 OL 图层／Source；未新增浏览器或 Windows 原生验收。
- 仍需 SceneController 绑定、编辑器／Viewer 创建路径收敛与更完整的增量差异处理；本批不签收 S05／S07／S09。

## 2026-10-09：Viewer 使用 v3 公共运行时与选择包

- Viewer 读取 v3；旧 SceneManifest／CityScene 先通过共享迁移。二维改用 `OlDocumentRuntime`，三维改用 `createCesiumDocumentRuntime`；声明式显隐更新经过文档／投影而非直接写原生层。v3 尊重 activeView，旧混合场景保留默认三维行为，支持显式 mode 和返回二维。
- 复用 scene-core URL 解析：以最终 HTTP 响应 URL 为资源基准，覆盖真正 302 跳转。新增可直接打开的 public v3 点／Popup 样例。保留图例、控件、Theme、Popup、图层／组开关；不支持对象返回状态问题而非静默省略。页面离开取消读取并销毁所属资源。
- 旧 Viewer 的可选择交互迁移到公共 `ol-selection`。新增可选 `boxSelection: false`，Viewer 保留拖动平移；默认框选行为不变。宿主接收集合并按完整数据、过滤、显隐／锁定确认，不改文档或历史。
- 已通过：Viewer TypeScript／生产构建、ol-selection 构建与 9 项单测；独立 Viewer 浏览器 12 用例，三种窗口尺寸。证据包含 v2/v3、资源加载一次、Popup、实际黄色高亮像素、拖动平移、显隐、未支持内容报告、503、重定向、实际 Cesium canvas 启动和切回二维。Desktop 默认框选 15 个浏览器回归通过，包括属性表联动、修饰键、Esc、独立消费者、旋转与父组裁剪、框选后单击和平移。
- 测试为安装的 Chrome＋SwiftShader，网络样例受控；Cesium 此批只验证空场景启动，不证明模型／tileset、水面、三维 Popup／环境和硬件渲染的完整一致性。生产构建仍有既有 Cesium 大 chunk 警告。
- 仍未签收 S09：完整发布格式／资源打包、能力矩阵逐项一致、controller 绑定、Desktop 创建路径收敛、独立 engine tarball 与原生／DPI 门槛仍需完成。本批未推送或 npm 发布。

## 2026-10-09：SceneController 到运行时的受控投影

- scene-core 新增无 DOM／引擎依赖的 `bindSceneRuntime`。订阅控制器提交，初始／后续投影共用 `updateDocument(document, signal)`；请求修订与已应用修订分开记录。取消旧投影、合并尚未开始的过期请求、忽略旧成功／错误状态，等待者跟随最新修订，不受永不结束的旧请求阻塞。
- 渲染失败不回滚已提交文档或用户历史；状态报告失败和最后已应用修订，`refresh` 显式重试而不改内容。销毁取消本绑定并解除订阅，不销毁宿主控制器／运行时；适配器必须遵守 abort 后不发布原生内容的约定。旧 Cesium `updateScene` 不能直接当作此适配器。
- Viewer 二维内容现在由 SceneController 持有；显隐走控制器便捷 API，运行时为只读投影副本，Popup 读取控制器内容。接回公共选择包和现有浏览器交互。三维 Viewer／Desktop 的内容真源与取消安全适配仍待收敛，本批不签收 S07。
- 通过：scene-core 及三包依赖链构建、core 26 项测试（新增绑定 6 项）、Viewer 类型／生产构建与 12 个浏览器用例。生产构建仍有既有 Cesium 大 chunk 警告。单测包含初始投影、文档隔离、旧失败、最新修订等待、提交后渲染失败、重试、取消／销毁和所有权。
- 三包重新打包并在独立消费者离线强制安装；新增绑定的实际 JS 调用、严格 NodeNext 声明消费通过，无源码 alias 或 DOM，导出仍包含控制器修改。仅证明此协议／core 依赖链；其他公共包、许可证、engine tarball 和原生门槛仍未签收。
- 未新增 Windows 原生／DPI 或硬件 GPU 验收；未推送或 npm 发布。

## 2026-10-09：Cesium 场景替换的资源准备

- `replaceScene` 在当前集合之外隐藏挂载候选图层，等待全部资源和环境准备成功后再替换；失败、外部取消、后续替换、增量编辑及销毁使旧准备失效，迟到资源释放。准备期间保留旧对象、环境和相机。v3 创建入口使用该路径，现有增量编辑继续使用 `updateScene`。
- 图层集合在移除原有图层前校验候选 ID 唯一、已就绪且属于同一个 Viewer；保留仍在候选中的自定义图层。原生模型、瓦片、GeoJSON、图形和水面在加入 Viewer 前设置初始显隐。
- 通过：Cesium runtime 24 项单测、layer 23 项单测、七包依赖链构建；真实 tower.glb 在隐藏准备阶段完成加载，Viewer 三个窗口尺寸的浏览器测试通过并支持显隐切换。
- 浏览器使用 Chrome/SwiftShader；此证据验证真实模型加载就绪，不代表硬件渲染、原生 Windows 或 DPI 验收。准备式替换不保证同步原生 setter 抛错或重入时的完整回滚；尚需 v3 增量适配、三维 Viewer/controller 绑定及 Desktop 迁移，本批不签收 S06/S07。

## 2026-10-09：三维文档更新与 Viewer 控制器绑定

- Cesium v3 适配器新增 `updateDocument`；就绪对象的显示属性、变换、质量、Popup 和图形修改复用原生实例，资源/环境来源变化走隐藏准备式替换。完整文档和能力问题只在成功投影后更新；无效文档、取消和失败不改写最近应用的文档副本。相机声明不变时保留用户导航。
- 准备式替换取消后立即拒绝，不等待忽略信号的原生加载器；迟到资源仍清理。三维 Viewer 显隐统一提交到 SceneController，通过 bindSceneRuntime 投影；不再直接调用旧 updateScene 或维护第二份可写场景。页面离开取消启动和投影，释放绑定、运行时及控制器。
- 通过：Cesium runtime 29 项单测、运行时构建、Viewer 类型与生产构建、三种窗口尺寸共 15 个 Viewer 浏览器用例。真实 GLB 的显隐切换只产生一次模型下载。构建仍有既有 Cesium 大 chunk 提示。
- 浏览器为 Chrome/SwiftShader，未新增原生 Windows、DPI 或硬件 GPU 证据。同步原生 setter 异常/重入完整回滚、共享二维节点三维渲染、Desktop 控制器迁移和公共包完整发布门槛仍待完成；不据此签收整个 S06/S07/S09。

## 2026-10-09：宿主持有的场景控制器与 Project API 适配

- scene-core 新增 `SceneDocumentHost` 和 `createHostedSceneController`：读取、导出直接取宿主；便捷/声明 API 通过宿主同步原子提交与历史。外部命令、撤销/重做通知控制器并使旧准备失效；UI 状态不属于内容通知。API 提交不重复通知，观察者收到隔离的前后快照；销毁解除宿主订阅。
- Desktop 提供 `createProjectSceneController`，Project 和现有编辑历史仍是权威存储，不保留可独立修改的场景镜像。API 新增 Tileset 进入 Project 并被完整导出；同项目编辑保留未变化资源的本地来源和处理记录、项目设置及原底图配置。资源 JSON 键顺序变化不误判为来源变化。
- 通过：core 32 项单测及三包依赖链构建；Desktop 场景适配、控制器和导入历史共 18 项单测，Desktop 生产构建。新 tarball 的独立 Node 实际调用及严格 NodeNext 声明消费通过；声明检查使用 Node 24 平台类型提供 AbortSignal，未启用 DOM，也不使用源码 alias。
- 该 Desktop 门面目前通过既有整场景快照命令提交，沿用草稿保护及会话重置；尚未接入面板/引擎宿主的细粒度同步。完整可携带元数据、嵌套组/多个视图、资源改动时的来源策略、选择/草稿保留优化和性能门槛仍待完成。无新增浏览器、Windows 原生或 DPI 验收，不签收 S07/S10 全项。

## 2026-10-09：同项目 API 编辑的差异历史与会话保留

- gis-core 新增 `ApplyProjectSnapshotEditCommand` 和快照影响分析。同项目编辑沿用一个 EditHistory，按变化字段和稳定 ID 应用内容差异；撤销透明度修改不覆盖随后完成的无关数据刷新。要求宿主提供原子 `applySnapshotEdit`，宿主拒绝时不先修改 FeatureStore；全场景替换继续使用原 Replace 命令。
- Project API 门面同项目更新改走 `applySnapshotAsEdit`。保留未受影响的选择、属性表目标、搜索、分页、检查器和草稿；样式变化仅失效样式草稿，资源/数据变化清理对应会话与请求，删除图层清理目标。只有受影响图层的脏草稿阻止 API 更新及历史恢复。JSON 键顺序变化不添加无效历史，未改变视图时不额外改写工作区类型。
- WFS 完成时确认请求身份及未取消状态；同 ID 资源修改后的迟到成功不再写入。旧请求结束不能清除较新请求的注册和加载状态，增加相应回归。
- 通过：gis-core 72 项单测及构建；Desktop 全套 183 项通过、5 项既有平台测试跳过，生产构建和最终类型检查通过。选择交互浏览器组在三个窗口尺寸共 18 项通过；新增流程先实际框选和搜索，再调用公共 API，观察原生图层透明度，通过工具栏撤销/重做验证选中行与表格搜索保留。浏览器使用安装的 Chrome/SwiftShader，不等同于 Windows 原生、DPI 或硬件 GPU 验收。
- 同项目差异历史不是协同冲突解决器：命令改写的同一字段、非稳定 ID 数组或创建/删除的整块内容仍按命令目标应用。Desktop 创建路径向公共文档运行时收敛、完整元数据与嵌套/多视图支持、资源包和性能门槛仍未完成；本批不签收整个 S07/S10。

### Desktop city identity projection before runtime migration (2026-10-09)

- Added `createProjectSceneProjection`: full scene document and bidirectional host city node/group ID mappings are built together. The existing document export delegates to this projection and keeps its output contract.
- Mapping prevents map/city ID collisions from directing selection or transform callbacks to the wrong host object. It does not mutate Project content or create another writable content source.
- Verification: 9 project scene document tests passed; Desktop TypeScript and production build passed. Existing mixed static/dynamic import and large bundle warnings remain.
- Desktop CityWorkspace still uses the legacy runtime entry. Wiring the new document runtime, startup cancellation, retry/error state and mapped editing callbacks remains pending; this entry does not complete S06/S07 or the full plan. No push, package publication, native acceptance or shutdown was performed.

## 2026-10-09：Desktop 三维工作区接入公共文档运行时

- CityWorkspace 不再直接创建旧 CityRuntime 或调用 updateScene。通过 Project-owned SceneController、bindSceneRuntime 和 createCesiumDocumentRuntime 投影，现有 Project、绘制/编辑命令及 EditHistory 继续保存权威内容。
- city-document-session 处理启动期间内容变化、取消、迟到工厂结果、过期原生回调、运行时更新错误和资源重试。销毁解除订阅并释放拥有的运行时；失败保留成功投影和已显示图层，重试不产生内容历史。新项目加载应用其初始相机。
- 投影提供三维对象/分组及资源的双向 ID 映射。拾取、定位、模型变换和图形编辑回写原宿主 ID；公共 API 同项目提交恢复已有宿主 ID，避免二维/三维同名对象导致选择失效，新增碰撞 ID 单独分配。
- 像素验收发现重试成功会重置用户相机；修复公共运行时，使资源替换和显式 updateDocument(..., { reload: true }) 保留用户视角。文档相机声明变化或切换文档 ID 仍应用初始视角，用户导航不自动写入内容。
- 非三维投影内容的标题或二维节点变化只更新完整文档及能力报告，不额外调用原生属性设置或取消三维交互；旧的异步准备仍会失效。
- 证据：Desktop 三个相关单测文件共 24 项通过；全套 191 项通过、5 项既有平台测试跳过；公共 Cesium runtime 31 项通过及构建。Desktop 与独立 Viewer 生产构建通过，既有混合导入与大体积 bundle 警告保留。三个窗口尺寸 1024×680、1440×900、1920×1080 的既有场景实时设置/撤销交互通过；新增真实 GLB 流程验证定位后的实际模型像素、隐藏后消失、显隐与缩放不重复下载、撤销/重做与完整 JSON 导出、503 失败保留旧模型像素及重试恢复视角。测试使用安装的 Chrome/SwiftShader，不等同 Windows Tauri、DPI 或硬件 GPU 验收。
- 剩余：Desktop 二维运行时创建路径收敛、完整元数据/嵌套组/多个视图、Desktop 合并及资源归档依赖、完整能力/性能/pack/原生矩阵。未推送、未发布 npm、未关机；本批不签收 S06/S07/S10 或完整计划。

### 二维公共创建与替换边界（2026-10-09）

- Desktop 矢量创建使用公共 `createOlVectorLayer`，保留编辑源和原要素 ID；共享数据注册表支持多个显示图层，并保持旧单图层查询兼容。
- 公共 OL 文档资源替换在视图声明未变化时保留当前 View 与准备期间的导航。标题、未引用资源及三维内容变化只更新完整声明和能力提示。
- 取消立即释放已准备资源；文档运行时及时拒绝忽略取消信号的请求，迟到结果不能覆盖地图。
- 验证：OL scene runtime 34、OL runtime 19、Desktop 191 个测试通过（Desktop 5 个跳过）；两个公共包及 Desktop 构建通过。Chrome 三个窗口尺寸的框选、表格联动、双击定位、撤销、取消和旋转视图回归共 18 项通过；这不是 Windows 原生验收。
- S05 尚未完成：Desktop 仍需完整文档绑定、认证服务和编辑交互适配。此轮不代表 S05–S10 验收完成。

### 宿主编辑源接入边界（2026-10-09）

- OL 文档工厂和文档运行时新增 `vectorSources` 资源映射，复用宿主已投影的完整源。各显示节点保持独立样式与过滤，源数据同步仍由宿主承担。
- 工厂不请求被宿主接管的矢量资源，不改写业务要素 ID；失败、替换和销毁只释放自己的源。验证共享节点、后续准备失败及跨文档替换后原 Feature 对象仍在。
- 公共 OL scene runtime 37 个测试及构建通过。Desktop 实际源同步、过滤后编辑／吸附和认证服务适配仍待接入，未宣称二维迁移完成。

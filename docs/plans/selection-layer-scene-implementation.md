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

# 项目文档

这里集中存放项目级文档、设计参考图和工程约定。根目录的 `AGENTS.md` 是 Agent 入口；按任务需要渐进式读取下面的内容即可。

## 文档结构

### 规范与设计

位于 [`specs/`](specs/)：

- [产品需求 V0.1](specs/01-PRD-V0.1.md)
- [技术架构 V0.1](specs/02-Technical-Architecture-V0.1.md)
- [UI/UX 设计指南 V0.1](specs/03-UI-UX-Design-Guidelines-V0.1.md)
- [UI 实现设计规范 V0.1](specs/04-UI-Implementation-Design-Spec-V0.1.md)
- [Scene Manifest 与发布 V0.1](specs/05-Scene-Manifest-and-Publishing-V0.1.md)
- [二维与三维统一工作台](specs/06-Unified-Workbench.md) — 最新 Ribbon、对象菜单与面板交互规则
- [统一场景文档 v3](specs/scene-document-v3.md) — 已实现的资源／节点／视图协议、旧格式迁移与纯操作；完整工程适配、JSON Schema 和运行时接入待完成
- [二维制图系统技术设计 V1.1](design/2d-cartography-technical-design-v1.1.md) — 当前设计基线，含[原型索引](design/2d-cartography-prototype-index.md)；各阶段实际状态见[实施记录](plans/2d-cartography-implementation.md)，[V1](specs/07-2D-Cartography-Technical-Design-V1.md) 保留为历史资料
- [全产品设计原则与改进计划（2026-10-08）](design/product-design-review-2026-10-08.md) — 用户设计理念、全产品目标、12 批整改与验收；A–C 和 D 部分已实施，见实施记录
- [全量界面设计审计（2026-10-08）](design/product-interface-audit-2026-10-08.md) — 51 个界面／功能区、全部 18 个处理工具、问题证据与异常／恢复状态；源码审计，未逐项完成原生验收


### 阶段计划与验收

- [二维制图实施记录](plans/2d-cartography-implementation.md)：P0–P6 的实现、测试及原生/浏览器边界；[GeoServer 验收证据](design/2d-cartography-geoserver/README.md)、[P6 MBStyle 与 WebGL](design/2d-cartography-p6/README.md)。
- [2026-10-13 Desktop 产品化实施记录](plans/desktop-productization-implementation.md)：采用用户交付包的 M0–M9 方案，首批 Shell/Docking 改动、回归基线及尚未实施的范围。
- [实施补充细则](design/desktop-productization/implementation-addendum.md)：已确认原型直接实施、明确采用 Ant Design、组件迁移顺序与最终 PR 验收要求。

位于 [\plans/\](plans/)：

- [第一阶段执行计划](plans/phase-1-gis-workbench.md)
- [WebView 一体化标题栏实施计划](plans/webview-titlebar-implementation.md) — 菜单与窗口控制合为一行，分阶段实施及 Windows 验收边界
- [第一阶段进度交接](plans/phase-1-progress.md)
- [第二阶段：空间处理工作流](plans/phase-2-spatial-processing.md)
- [二维编辑捕捉](plans/editing-snapping.md)
- [下一步计划](plans/next-steps-2026-10-10.md) — 当前执行范围：冻结同渲、内部包维护、按小 PR 推进
- [用户功能清单与改进顺序](specs/user-capabilities.md) — 产品原则、已具备工作流、限制与每刀验收条件
- [同渲冻结清理](plans/freeze-co-render-cleanup.md) — 默认行为、KEEP／REMOVE 清单与验收记录
- [逐条浏览器工作流验收](plans/browser-workflow-audit-2026-10-11.md) — A、B、C、D、F、G、J 的当前证据及产品修复，原生窗口单列
- [选择、图层与统一场景 API 实施计划](plans/selection-layer-scene-public-api.md) — 历史方案，保留作对照，不再整包执行
- [选择、图层与场景 API 实施记录](plans/selection-layer-scene-implementation.md) — 历史验证证据及未签收项
- [GeoLibre 对标与下一阶段建议](plans/geolibre-gap-review-2026-10-03.md)
- [城市编辑器产品与核心能力演进](plans/city-editor-product-and-core.md) — 功能区交互、Mars3D 风格 API 与绘制/编辑/可视化路线讨论稿
- [P21 全阶段验收证据（受阻）](plans/p21-phase-acceptance-evidence.md) — 绑定 SHA "d310b\；**不**表示阶段已完成

### 工程约定

- [代码偏好与维护约定](engineering/code-preferences.md)
- [项目恢复草稿](engineering/project-recovery.md)：缓存规则、恢复/舍弃操作、自动化入口与原生验收边界。
- [本地场景资源协议](engineering/local-resource-protocol.md)：受控目录、嵌套依赖、MIME/Range 与当前原生证据。

### 设计参考图

位于 [`assets/`](assets/)：

- [界面参考图 01](assets/ui-reference-01.png)
- [界面参考图 02](assets/ui-reference-02.png)
- [界面参考图 03](assets/ui-reference-03.png)
- [界面参考图 04](assets/ui-reference-04.png)

## 推荐阅读顺序

1. 先阅读根目录 [`AGENTS.md`](../AGENTS.md) 的通用规则。
2. 修改代码前阅读 [代码偏好与维护约定](engineering/code-preferences.md)。
3. 处理具体功能时，只阅读 `specs/` 中与任务相关的规范。
4. 需要核对视觉方向时，再查看 `assets/` 中的参考图。

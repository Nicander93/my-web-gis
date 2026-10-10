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
- [全产品设计原则与改进计划（2026-10-08）](design/product-design-review-2026-10-08.md) — 用户设计理念、专业产品参考、全产品目标、12 批整改与验收；待实施
- [全量界面设计审计（2026-10-08）](design/product-interface-audit-2026-10-08.md) — 51 个界面／功能区、全部 18 个处理工具、问题证据与异常／恢复状态；源码审计，未逐项完成原生验收


### 阶段计划与验收

位于 [\plans/\](plans/)：

- [第一阶段执行计划](plans/phase-1-gis-workbench.md)
- [第一阶段进度交接](plans/phase-1-progress.md)
- [第二阶段：空间处理工作流](plans/phase-2-spatial-processing.md)
- [二维编辑捕捉](plans/editing-snapping.md)
- [GeoLibre 对标与下一阶段建议](plans/geolibre-gap-review-2026-10-03.md)
- [城市编辑器产品与核心能力演进](plans/city-editor-product-and-core.md) — 功能区交互、Mars3D 风格 API 与绘制/编辑/可视化路线讨论稿
- [P21 全阶段验收证据（受阻）](plans/p21-phase-acceptance-evidence.md) — 绑定 SHA "d310b\；**不**表示阶段已完成

### 工程约定

- [代码偏好与维护约定](engineering/code-preferences.md)

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

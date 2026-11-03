# 项目文档

根目录的 `AGENTS.md` 是 Agent 入口。按任务需要阅读下面的内容即可。

## 结构

- [产品](product/)：交互规范、统一工作台、用户功能清单
- [设计](design/)：设计系统、制图与三维编辑器技术设计、UI 组件规范
- [原型](prototypes/)：工作台 HTML、制图编辑器、UX 原型
- [架构](architecture/)：总览与架构图、分层规则、数据与编辑、场景文档、恢复与资源协议
- [工程约定](engineering/code-preferences.md)
- [界面参考图](assets/)
- [归档](archive/refactor-2026-11/)：2026-11 数据与编辑重构的阶段记录，现行文档不再依赖它们推进工作

## 产品

- [产品功能与交互规范](product/product-interaction-spec.md)
- [二维与三维统一工作台](product/unified-workbench.md)
- [用户功能清单](product/user-capabilities.md)

## 设计

- [Desktop 设计系统 V1](design/desktop-design-system-v1.md)
- [UI 与组件规范](design/ui-component-spec.md)
- [二维制图系统技术设计 V1.1](design/2d-cartography-technical-design-v1.1.md)，原型见 [索引](design/2d-cartography-prototype-index.md)
- [三维场景编辑器技术设计 V1](design/3d-scene-editor-technical-design-v1.md)

工作台视觉参考：[二维](prototypes/workbench/desktop-webgis-2d-final.html)、[三维](prototypes/workbench/desktop-webgis-3d-final.html)。

## 架构

- [总览与架构图](architecture/README.md)
- [分层规则](architecture/layers.md)：目录职责、依赖方向、新代码放在哪里
- [数据与编辑](architecture/data-and-editing.md)
- [统一场景文档 v3](architecture/scene-document-v3.md)
- [项目恢复草稿](architecture/project-recovery.md)
- [本地场景资源协议](architecture/local-resource-protocol.md)
- [分层与包边界整理计划](architecture/layering-plan.md)：目录迁移与执行记录

## 阅读顺序

1. 根目录 [`AGENTS.md`](../AGENTS.md)
2. 改代码前阅读 [代码偏好](engineering/code-preferences.md) 和 [分层规则](architecture/layers.md)
3. 需要理解系统怎么拆时阅读 [架构总览](architecture/README.md)
4. 处理具体功能时，只阅读 `product/`、`design/`、`architecture/` 中与任务相关的文档
5. 核对视觉时打开 `prototypes/` 和 `assets/`

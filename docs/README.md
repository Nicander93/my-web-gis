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

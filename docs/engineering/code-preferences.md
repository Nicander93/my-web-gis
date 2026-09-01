# 代码偏好与维护约定

本文档存放项目级代码约定。它是详细规则，只有在涉及代码实现或评审时按需读取；通用规则仍以根目录 `AGENTS.md` 为准。

## 实现原则

- 以最小功能闭环为优先，先解决当前需求，再考虑可复用抽象和边界扩展。
- 保持模块职责清晰：应用壳层负责组合和编排，Feature 负责业务 UI，基础 UI 不依赖 GIS 业务。
- 不为了迁移而机械翻译旧实现；迁移时保留已有 GIS packages 的边界，逐步接回能力。
- 不引入当前任务不需要的框架、第三方库或通用框架层。

## TypeScript 与 React

- 新的 Desktop UI 使用 React、TypeScript 和函数组件；优先使用明确的 props 和局部状态。
- Zustand 只保存跨组件共享状态。布局状态与 GIS Project、选中要素、OpenLayers Runtime 等业务状态分开。
- Command 表达完整的用户操作，负责调用 Store 或 Service；纯计算函数放在 `utils`，GIS 能力放在对应 package/service。
- UI 不直接散落操作 OpenLayers API；通过 runtime/service 或 command 连接外部能力。
- 面板容器负责开关、尺寸、恢复入口和布局；具体 Feature 通过 `children` 注入，不让容器反向 import Feature。

## 注释与命名

- 类、公开函数和非显然的关键逻辑添加简短注释，说明职责或原因。
- 不为显然的赋值、简单 JSX 或逐行复述代码添加注释。
- 命名优先表达用户意图和领域动作，避免使用空泛的 `Manager`、`Engine`、`Bus` 等抽象名。

## 验证与改动边界

- 修改前后检查 Git 状态，避免覆盖其他任务的改动。
- 优先运行受影响 package 的构建/测试；涉及 Desktop Shell 时至少运行 Desktop build。
- 不把应用设置误写入 GIS Project，不让布局调整触发 Project Dirty 或 Undo/Redo。
- 文档、图片和示例数据属于项目资料；整理目录时更新引用，不修改内容本身。

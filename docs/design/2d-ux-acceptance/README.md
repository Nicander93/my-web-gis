# 二维 UX 浏览器评审材料

日期：2026-10-22。截图来自本分支实际 React / OpenLayers 应用，采用项目灰白绿主题和默认紧凑密度；原型仅作布局和流程参考。

| 视口 | 属性表 | 字段计算器 |
| --- | --- | --- |
| 1440×900 | [桌面属性表](desktop-attribute-table.png) | [桌面计算器](desktop-field-calculator.png) |
| 1024×680 | [紧凑属性表](compact-attribute-table.png) | [紧凑计算器](compact-field-calculator.png) |

截图场景保留左右停靠面板，包含真实导入数据、属性表 Tab、表内工具栏，以及新建字段的配置、表达式、5 行结果预览。计算器使用统一 580px 默认高度；短视口减少表达式区与预览行距。属性表避开侧边面板，计算器底部应用/关闭按钮经过 `elementFromPoint` 可达性检查。

行为复验：在 `apps/desktop` 执行 `pnpm exec playwright test attribute-tabs ux-productization activity-panel --project desktop --project compact --workers 1 --output test-results/ux-review`。完整结果与边界见 [执行记录](../../plans/2d-ux-productization-implementation.md)。

这些图片供密度、信息层级和操作路径评审。它们是 Chromium 浏览器渲染证据，不能代表原生 Tauri、真实 GeoServer 或物理 GPU 验收，也不代表用户的视觉签收。

## 原生补测

`pnpm --filter @desktop-webgis/desktop test:native-ux` 使用独立 Tauri 标识和 WebView profile。四组业务检查通过：窗口最大化/还原、软件偏好持久化及工程隔离、任务/诊断共存、计算器按钮可达。请求窗口为 1024×680，实际 WebView CSS 内容区为 737×490，`devicePixelRatio` 约 1.593；原生截图和物理 DPI 未验收。

[原始报告](native-ux-report.json)保留运行器清理失败：沙箱内 `taskkill` 被系统凭据限制拒绝。随后主代理提权核对并终止该轮明确创建的测试进程树，复查无残留；未处理其他应用。业务断言通过与测试命令正常退出分别记录，不把这一轮称为完整原生签收。

# UX 原型索引 V1

> 这些是**交互方向与布局参考**，不是可以复制进 React 的前端实现。最终决策以 `my-web-gis-ux-productization-plan-v1.md` 第 1 节为准。

| 原型 | 状态 | 使用注意 |
|---|---|---|
| [工作区整体布局（结构方向参考）](../prototypes/ux-v1/my-web-gis-workspace-ux-v1.html) | 参考 | 地图优先，任务/诊断独立窗口。 |
| [左侧图层树](../prototypes/ux-v1/my-web-gis-layer-tree-ux-v1.html) | 待细节审阅 | 新增保守原型；不追加功能。 |
| [属性表主界面](../prototypes/ux-v1/my-web-gis-attribute-table-ux-v3.html) | 已认可 | 图标工具栏、数据密度；图层切换改为可关闭 Tab。 |
| [属性表搜索与筛选](../prototypes/ux-v1/my-web-gis-attribute-table-ux-v4.html) | 需按最终决策修订 | 只保留表格筛选！V4 里的图层筛选切换是旧方案，禁用/移除。 |
| [字段计算器](../prototypes/ux-v1/my-web-gis-field-calculator-ux-v1.html) | 已认可 | 三段式配置/表达式/结果预览，基础能力优先。 |
| [右侧图层属性/样式/标注](../prototypes/ux-v1/my-web-gis-right-inspector-ux-v3.html) | 需按最终决策修订 | 移除“要素”Tab；要素信息交给右侧信息面板。 |
| [紧凑样式编辑](../prototypes/ux-v1/my-web-gis-right-style-inspector-v2.html) | 基本认可 | 符号优先、复杂渲染按需展开。 |
| [右侧竖向切换栏](../prototypes/ux-v1/my-web-gis-right-toolrail-ux-v1.html) | 已认可 | 属性 / 信息 / 处理互斥，信息仅打开既有结果。 |
| [全局软件设置](../prototypes/ux-v1/my-web-gis-global-settings-ux-v1.html) | 基本认可 | 外观字号/密度、关于与更新；整体视觉需统一。 |
| [制图样式编辑器](../prototypes/ux-v1/my-web-gis-style-editor-v4.html) | 已认可的设计基线 | 渲染规则与参数密集编排。 |
| [专业线符号编辑器](../prototypes/ux-v1/my-web-gis-line-symbol-editor-v1.html) | 双栏结构已认可 | 双栏、符号层顺序、参数。 |
| [符号选择库](../prototypes/ux-v1/my-web-gis-symbol-library-v1.html) | 浏览形式参考 | 示例量并非已实装符号数量。 |

## 冲突的解决

1. 属性表 V4 虽展示图层筛选选项，但用户最终决定：**只需要表格筛选**。
2. 右侧 Inspector V3 含“要素”标签，但最终决定：**独立信息面板**。
3. 属性表 V3 使用了旧图层切换方案，但最终决定：**可关闭 Tab**。
4. 右侧“信息”竖栏仅切换面板；不能激活地图识别工具。
5. 符号库示例的数量不是生产阶段完成标准。

## 验收视图

截图在 `../prototypes/ux-v1/screenshots/`；原型有模拟数据，实际功能以仓库业务模块为准。

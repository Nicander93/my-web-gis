# 二维制图 UI 原型索引

> 项目：`my-web-gis` · 整理日期：2026-10-21
> 本目录属于**产品设计参考和独立交互原型**，不是当前仓库已经实现的运行时代码。原型里的数据和保存功能都是模拟的，不能据此认为 MapLibre、OpenLayers、GeoServer 相关能力已经实现。

## 一、交付原型与状态

| 文件 | 对应界面 | 讨论结论 | 截图 |
|---|---|---|---|
| [my-web-gis-style-editor-v4.html](../prototypes/2d-cartography/my-web-gis-style-editor-v4.html) | 样式主编辑面板 | **已认可的 UI 基线**：紧凑、图标少、没有冗余说明，复杂配置按需弹窗 | [主界面](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-preview.png)、[Zoom 弹窗](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-zoom-dialog.png)、[宽度扩展](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-expanded.png)、[窄屏](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-narrow.png) |
| [my-web-gis-line-symbol-editor-v1.html](../prototypes/2d-cartography/my-web-gis-line-symbol-editor-v1.html) | 专业线符号编辑弹窗 | **双栏结构已认可**：左侧是符号层，右侧是选中层的属性，顶部是符号预览 | [主界面](../prototypes/2d-cartography/screenshots/my-web-gis-line-symbol-editor-v1-preview.png)、[Zoom 弹窗](../prototypes/2d-cartography/screenshots/my-web-gis-line-symbol-editor-v1-zoom.png)、[窄屏](../prototypes/2d-cartography/screenshots/my-web-gis-line-symbol-editor-v1-narrow.png) |
| [my-web-gis-symbol-library-v1.html](../prototypes/2d-cartography/my-web-gis-symbol-library-v1.html) | 内置符号库选择器 | **供继续评审**：基本分类、搜索、收藏和浏览可以参考，正式的专业符号内容还需要校核 | [线](../prototypes/2d-cartography/screenshots/my-web-gis-symbol-library-v1-preview.png)、[点](../prototypes/2d-cartography/screenshots/my-web-gis-symbol-library-v1-point.png)、[面](../prototypes/2d-cartography/screenshots/my-web-gis-symbol-library-v1-polygon.png)、[窄屏](../prototypes/2d-cartography/screenshots/my-web-gis-symbol-library-v1-narrow.png) |

## 二、已确定的交互原则

- 维持 **QGIS 风格的信息密度**，避免说明型卡片、冗余图标和装饰性标题。
- 样式主面板只显示高频操作；复杂的符号、表达式、Zoom 节点和分类管理可以放到独立的弹窗里编辑。
- 一个 GIS Layer 可以关联多个 MapLibre Style Layer；颜色分类、数值分级、规则和 Zoom 参数可以组合生效。
- 修改即时生效，并通过项目级的 Undo/Redo 和 Ctrl+S 保存；原型里的本地保存机制不是最终的业务实现。
- 内置的专业符号库属于正式需求；系统预设、个人和项目符号都应该可以复用，但原型里的示例符号**没有经过行业标准验证**。
- 底层以 MapLibre Style Specification 为基准，用 OpenLayers 和 ol-mapbox-style 做 Canvas 渲染；SLD 单向导出给 GeoServer。

## 三、目前**没有**单独 HTML 原型的范围

标注规则与高级避让编辑器、完整的符号管理器（区别于符号选择器）、点与面的专业符号详细编辑器、GeoServer 发布向导、SLD 兼容报告界面。

这些能力已经在技术方案里描述过，但**不应要求开发 Agent 去找不存在的原型，也不应把线符号原型机械地复制成全部界面**。如果 UI 还没定，先按确定的设计原则开发低风险的基础设施，再做针对性的原型评审。

## 四、使用方式

把交付的 ZIP 解压到仓库根目录，使 `docs/design/` 和 `docs/prototypes/2d-cartography/` 成为真实的文件目录。在浏览器里打开这三个 HTML，配合技术方案的第 5 章阅读。

先依据《二维制图系统技术设计 V1.1》开展 P0 阶段的 `ol-mapbox-style` 技术验证。**不要在 P0 阶段直接照着 HTML 重写现有的 React 应用**，也不要把静态 HTML 的行为当作已经通过真实 OpenLayers 测试的结果。

# 二维制图 UI 原型索引

> 项目：`my-web-gis` · 整理日期：2026-10-21  
> 本目录属于**产品设计参考/独立交互原型**，不属于当前仓库已实现的运行时代码。原型数据和保存功能为模拟，不应当据此认定 MapLibre、OpenLayers、GeoServer 相关能力已实现。

## 一、交付原型与状态

| 文件 | 对应界面 | 讨论结论 | 截图 |
|---|---|---|---|
| [my-web-gis-style-editor-v4.html](../prototypes/2d-cartography/my-web-gis-style-editor-v4.html) | 样式主编辑面板 | **已认可的 UI 基线**；紧凑、低图标、无冗余说明；复杂配置按需弹窗 | [主界面](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-preview.png)、[Zoom 弹窗](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-zoom-dialog.png)、[宽度扩展](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-expanded.png)、[窄屏](../prototypes/2d-cartography/screenshots/my-web-gis-style-editor-v4-narrow.png) |
| [my-web-gis-line-symbol-editor-v1.html](../prototypes/2d-cartography/my-web-gis-line-symbol-editor-v1.html) | 专业线符号编辑弹窗 | **双栏结构已认可**；左侧符号层、右侧选中层属性、顶部符号预览 | [主界面](../prototypes/2d-cartography/screenshots/my-web-gis-line-symbol-editor-v1-preview.png)、[Zoom 弹窗](../prototypes/2d-cartography/screenshots/my-web-gis-line-symbol-editor-v1-zoom.png)、[窄屏](../prototypes/2d-cartography/screenshots/my-web-gis-line-symbol-editor-v1-narrow.png) |
| [my-web-gis-symbol-library-v1.html](../prototypes/2d-cartography/my-web-gis-symbol-library-v1.html) | 内置符号库选择器 | **供继续评审**；基本分类、搜索、收藏、浏览可参考，正式专业符号内容须校核 | [线](../prototypes/2d-cartography/screenshots/my-web-gis-symbol-library-v1-preview.png)、[点](../prototypes/2d-cartography/screenshots/my-web-gis-symbol-library-v1-point.png)、[面](../prototypes/2d-cartography/screenshots/my-web-gis-symbol-library-v1-polygon.png)、[窄屏](../prototypes/2d-cartography/screenshots/my-web-gis-symbol-library-v1-narrow.png) |

## 二、已确定的交互原则

- 维持 **QGIS 风格的信息密度**，避免说明型卡片、冗余图标和装饰性标题。
- 样式主面板只显示高频操作；复杂符号、表达式、Zoom 节点、分类管理等可在独立弹窗内编辑。
- GIS Layer 可关联多个 MapLibre Style Layer；颜色分类、数值分级、规则和 Zoom 参数能组合生效。
- 修改即时生效，并通过项目级 Undo/Redo 和 Ctrl+S 保存；原型的本地保存机制不是最终业务实现。
- 内置专业符号库作为正式需求；系统预设与个人、项目符号应可复用，但原型中的示例符号**未经过行业标准验证**。
- 未来底层以 MapLibre Style Specification 为基准，OpenLayers/ol-mapbox-style Canvas 渲染；SLD 单向导出给 GeoServer。

## 三、目前**没有**单独 HTML 原型的范围

标注规则与高级避让编辑器、完整符号管理器（区别于符号选择器）、点/面专业符号详细编辑器、GeoServer 发布向导、SLD 兼容报告界面。

这些能力已在技术方案中描述，但**不应要求开发 Agent 查找不存在的原型，也不应把线符号原型机械复制成全部界面**。如果 UI 未定，先按确定的设计原则开发低风险基础设施，再进行针对性原型评审。

## 四、使用方式

将交付 ZIP 解压到仓库根目录，使 `docs/design/` 与 `docs/prototypes/2d-cartography/` 成为真实文件目录。在浏览器中打开三个 HTML，配合技术方案第 5 章查看。

首先依据《二维制图系统技术设计 V1.1》开展 P0 `ol-mapbox-style` 技术验证。**不要在 P0 阶段直接照 HTML 重写现有 React 应用**，也不要将静态 HTML 的行为当作已通过真实 OpenLayers 测试。

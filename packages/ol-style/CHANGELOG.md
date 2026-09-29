# Changelog

本文件记录 `@desktop-webgis/ol-style` 的面向消费者的变更。真正 npm 发布前，包名/scope/版本仍可能调整。

## 0.1.0

### 新增

- 双入口：主入口（样式契约 + OpenLayers 编译）与 `./classification`（纯算法，无 OL 依赖）
- 样式模式：`single` / `categorized` / `graduated`（等间距、分位数、手动断点）
- 标注配置：`LabelConfig`（字段、字号、颜色、描边、偏移、缩放范围）
- 图例：`buildLegendItems` / `symbolPrimaryColor`（与已应用样式一致，不重新分类）
- 颜色与符号工厂：`rgb` / `rgba` / 色带、点线面与混合符号
- OpenLayers peer：`ol@^10.10.0`（仅主入口使用）

### 发布准备说明

- 包内不含 Desktop / gis-core / 工作区私有运行时依赖
- `files` 仅包含 `dist`、`LICENSE`、`CHANGELOG.md`、`README.md`
- 本版本未执行 npm publish；以 `pnpm pack` + 工作区外消费者校验为准

# @desktop-webgis/ol-style

OpenLayers 样式工具包：JSON 可序列化的样式契约、分类/分级算法、标注、图例，以及可选的 OpenLayers StyleFunction 编译。

> 本阶段完成 **发布准备**（`pnpm pack` + 工作区外消费者校验）。**未执行 npm publish**；真正发布前仍可能调整包名/scope/版本与许可证归属说明。

## 特性

- **分类算法**：等间距、分位数；`./classification` 入口不依赖 OpenLayers
- **样式契约**：`single` / `categorized` / `graduated`，可安全 JSON 序列化
- **标注**：字段标注（字号、颜色、描边、偏移、缩放范围）
- **图例**：`buildLegendItems` 与已应用样式一致，不重新分类
- **颜色 / 符号**：插值色带、点线面与混合符号工厂
- **OpenLayers 编译**：主入口 `compileStyle`（`ol` 为 peerDependency）

公开 API 仅使用样式领域术语（样式、符号、分类、分级、图例），不暴露 Desktop / 项目文件路径等应用内部概念。

## 安装

```bash
pnpm add @desktop-webgis/ol-style
pnpm add ol@^10.10.0   # peerDependency（与本包验证版本一致）
```

本地尚未发布到 npm 时，可用仓库内 pack：

```bash
pnpm --filter @desktop-webgis/ol-style build
pnpm --filter @desktop-webgis/ol-style pack:check
# 在工作区外的临时项目中：
pnpm add ./desktop-webgis-ol-style-0.1.0.tgz ol@^10.10.0
```

一键校验（pack → 工作区外安装 → 类型检查 → 运行示例）：

```bash
pnpm --filter @desktop-webgis/ol-style verify:consumer
```

## 使用

### 分类算法（无需 OpenLayers）

```typescript
import {
  classifyEqualInterval,
  classifyQuantile,
  classifyValue
} from '@desktop-webgis/ol-style/classification'

const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const equalResult = classifyEqualInterval(values, { numClasses: 5 })
console.log(equalResult.breaks)

const quantileResult = classifyQuantile(values, { numClasses: 5 })
console.log(quantileResult.breaks)

const classIndex = classifyValue(6.5, equalResult.breaks)
```

### 样式契约、标注与图例

```typescript
import {
  createSingleStyle,
  createCategorizedStyle,
  createGraduatedStyle,
  createPointSymbol,
  buildLegendItems,
  rgb,
  generateColorRamp
} from '@desktop-webgis/ol-style'

const singleStyle = createSingleStyle(
  createPointSymbol(5, rgb(255, 0, 0)),
  { field: 'name', fontSize: 12, color: rgb(20, 20, 20) }
)

const categorizedStyle = createCategorizedStyle(
  'type',
  [
    { value: 'A', symbol: createPointSymbol(5, rgb(255, 0, 0)) },
    { value: 'B', symbol: createPointSymbol(5, rgb(0, 255, 0)) }
  ],
  createPointSymbol(3, rgb(128, 128, 128)),
  { field: 'name', fontSize: 12, color: rgb(20, 20, 20) }
)

const colors = generateColorRamp(rgb(255, 255, 0), rgb(255, 0, 0), 5)
const graduatedStyle = createGraduatedStyle(
  'population',
  'quantile',
  colors.map((color, i) => ({
    value: (i + 1) * 1000,
    symbol: createPointSymbol(5, color)
  })),
  createPointSymbol(3, rgb(128, 128, 128))
)

const legend = buildLegendItems(categorizedStyle)
```

### 编译为 OpenLayers StyleFunction

```typescript
import { compileStyle } from '@desktop-webgis/ol-style'

const styleFunction = compileStyle(categorizedStyle)
vectorLayer.setStyle(styleFunction)
```

完整独立示例见 `examples/symbology-smoke`（分类 + 等间距/分位数分级 + 标注 + 图例）。

## 包入口

| 入口 | 内容 | OpenLayers |
| --- | --- | --- |
| `@desktop-webgis/ol-style` | 样式契约、工厂、编译器、图例、分类再导出 | peer |
| `@desktop-webgis/ol-style/classification` | 纯分类算法 | 无 |

## 发布清单（准备项）

| 项 | 状态 |
| --- | --- |
| `exports` / `types` / `files` | 已审查 |
| `peerDependencies.ol` | `^10.10.0`（已验证） |
| `sideEffects` | `false` |
| `license` + `LICENSE` | MIT |
| `CHANGELOG.md` | 已添加 |
| 工作区外 tarball 消费者 | `verify:consumer` |
| 真正 npm publish | **未执行**（有意） |

## 开发

```bash
pnpm install
pnpm --filter @desktop-webgis/ol-style build
pnpm --filter @desktop-webgis/ol-style test
pnpm --filter @desktop-webgis/ol-style verify:consumer
```

## 约束

- **不依赖**：Desktop、gis-core、scene-schema、React、Zustand、Tauri，以及任何 `workspace:*` 运行时依赖
- **OpenLayers**：仅作 peerDependency；classification 入口完全独立
- **JSON 可序列化**：样式契约为纯数据

## 许可证

MIT

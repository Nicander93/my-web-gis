# @desktop-webgis/ol-style

OpenLayers 样式工具包,提供分类算法和 JSON 可序列化的样式契约。

## 特性

- **分类算法**: 等间距、分位数分类,独立于 OpenLayers
- **样式契约**: JSON 可序列化的样式配置,支持单一符号、分类、分级
- **颜色工具**: 颜色插值和预定义色带
- **符号定义**: 点、线、面基础符号,支持混合几何
- **无依赖 classification 入口**: 纯算法实现,可在 Node.js 或浏览器中使用

## 安装

```bash
pnpm add @desktop-webgis/ol-style
pnpm add ol@^11.0.0  # peer dependency
```

## 使用

### 分类算法(无需 OpenLayers)

```typescript
import {
  classifyEqualInterval,
  classifyQuantile,
  classifyValue
} from '@desktop-webgis/ol-style/classification'

const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

// 等间距分类
const equalResult = classifyEqualInterval(values, { numClasses: 5 })
console.log(equalResult.breaks) // [3, 5, 7, 9, 10]

// 分位数分类
const quantileResult = classifyQuantile(values, { numClasses: 5 })
console.log(quantileResult.breaks) // [2.8, 4.6, 6.4, 8.2, 10]

// 值分类
const classIndex = classifyValue(6.5, equalResult.breaks)
console.log(classIndex) // 2
```

### 样式契约

```typescript
import {
  createSingleStyle,
  createCategorizedStyle,
  createGraduatedStyle,
  createPointSymbol,
  rgb,
  generateColorRamp
} from '@desktop-webgis/ol-style'

// 单一符号样式
const singleStyle = createSingleStyle(
  createPointSymbol(5, rgb(255, 0, 0))
)

// 分类样式
const categorizedStyle = createCategorizedStyle(
  'type',
  [
    { value: 'A', symbol: createPointSymbol(5, rgb(255, 0, 0)) },
    { value: 'B', symbol: createPointSymbol(5, rgb(0, 255, 0)) }
  ],
  createPointSymbol(3, rgb(128, 128, 128)) // fallback
)

// 分级样式
const colors = generateColorRamp(rgb(255, 255, 0), rgb(255, 0, 0), 5)
const graduatedStyle = createGraduatedStyle(
  'population',
  'quantile',
  colors.map((color, i) => ({
    value: (i + 1) * 1000,
    symbol: createPointSymbol(5, color)
  })),
  createPointSymbol(3, rgb(128, 128, 128)) // fallback
)
```

## API 文档

### 分类算法

#### `classifyEqualInterval(values, options)`

等间距分类,将数值范围平均分成 `numClasses` 个区间。

- **参数**:
  - `values: unknown[]` - 输入值数组
  - `options.numClasses: number` - 期望的分类数量
- **返回**: `ClassificationResult`
  - `breaks: number[]` - 断点数组(升序,已去重)
  - `ignoredCount: number` - 被忽略的无效值数量
  - `error?: string` - 错误信息

**规则**:
- 只接受有限的 `number` 类型值
- 空字符串不转换为 0
- null/undefined/NaN/Infinity 被忽略
- 常量数据返回单个断点
- 空数值集返回错误

#### `classifyQuantile(values, options)`

分位数分类,将数据按数量平均分成 `numClasses` 个组。

- **参数**: 同 `classifyEqualInterval`
- **返回**: `ClassificationResult`

**插值规则**:
- 对于 N 个值和分位数 q ∈ [0, 1]
- 位置 p = q × (N - 1)
- 如果 p 是整数,返回 sorted[p]
- 否则在 sorted[floor(p)] 和 sorted[ceil(p)] 之间线性插值

#### `classifyValue(value, breaks)`

根据断点对值进行分类。

- **参数**:
  - `value: unknown` - 待分类的值
  - `breaks: number[]` - 断点数组(升序)
- **返回**: `number` - 分类索引(0-based),无效值返回 -1

**区间规则**:
- 第一段包含最小值: value ≤ breaks[0]
- 其他段: breaks[i-1] < value ≤ breaks[i]

### 颜色工具

#### `rgb(r, g, b)` / `rgba(r, g, b, a)`

创建颜色对象。

#### `colorToString(color)`

将颜色转换为 CSS 字符串。

#### `generateColorRamp(startColor, endColor, count)`

生成色带。

- **参数**:
  - `startColor: Color` - 起始颜色
  - `endColor: Color` - 结束颜色
  - `count: number` - 颜色数量
- **返回**: `Color[]`

### 样式工厂

#### `createSingleStyle(symbol, label?)`

创建单一符号样式。

#### `createCategorizedStyle(field, categories, fallback, label?)`

创建分类样式。

#### `createGraduatedStyle(field, method, breaks, fallback, label?)`

创建分级样式。

## 类型定义

详见 `src/types.ts`:

- `LayerStyle` - 样式联合类型
- `SingleStyle` - 单一符号样式
- `CategorizedStyle` - 分类样式
- `GraduatedStyle` - 分级样式
- `Symbol` - 符号联合类型
- `Color` - RGBA 颜色
- `LabelConfig` - 标注配置

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 测试
pnpm test
```

## 约束

- **不依赖**: Desktop、gis-core、scene-schema、React、Zustand、Tauri
- **OpenLayers**: 作为 peerDependency,仅主入口使用
- **classification 入口**: 完全独立,无 OpenLayers 依赖
- **JSON 可序列化**: 所有样式契约可安全序列化

## 许可证

MIT

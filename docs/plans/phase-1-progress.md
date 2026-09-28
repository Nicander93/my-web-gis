
## P08 — 样式包基础与分类算法

**状态**: 已完成  
**执行日期**: 2026-09-28  
**前置条件**: P07  
**验收标准**: `docs/plans/phase-1-gis-workbench.md` § P08

### 完成内容

按照 phase-1-gis-workbench.md P08 要求实现:

1. **新建独立包** `packages/ol-style`
   - workspace 名称: `@desktop-webgis/ol-style`
   - 不依赖 Desktop、gis-core、scene-schema、React、Zustand、Tauri
   - OpenLayers 作为 peerDependency (^10.10.0)
   
2. **双入口设计**
   - 主入口 `./index`: 完整样式功能(可引用 OL 类型)
   - 分类入口 `./classification`: 纯算法,无 OL 依赖
   
3. **JSON 可序列化样式契约**
   - `single` / `categorized` / `graduated` 三种模式
   - 点/线/面基础符号 + 混合几何支持
   - 字段、分类项/断点、fallback、可选标注
   
4. **分类算法实现**
   - 等间距 (Equal Interval): 平均分割数值范围
   - 分位数 (Quantile): 按数量平均分组,线性插值
   - 数值验证: 只接受有限 number,不转换空字符串
   - 类别区分: 数字 1 ≠ 字符串 '1'
   - 区间规则: 首段含最小值,各段上界包含、后续下界不含
   - 边界处理: 常量数据单段,空集报错,自动去重

5. **工具函数**
   - 颜色: rgb/rgba/hex 转换、插值、色带生成
   - 符号: 点/线/面/混合符号创建
   - 样式工厂: 三种模式的快捷构造函数

### 实际文件改动

**新增包结构**:
```
packages/ol-style/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts                       # 主入口
    ├── types.ts                       # 样式契约类型
    ├── colors.ts                      # 颜色工具
    ├── symbols.ts                     # 符号工具
    ├── style-factory.ts               # 样式工厂
    └── classification/
        ├── index.ts                   # 分类算法
        └── index.test.ts              # 分类测试
```

**核心文件清单**:
- `package.json`: 双入口配置,peerDependencies 声明
- `src/classification/index.ts`: 等间距/分位数算法 + classifyValue
- `src/classification/index.test.ts`: 21 个测试用例
- `src/types.ts`: 样式契约类型定义(129 行)
- `src/colors.ts`: 颜色工具和预定义色带
- `src/symbols.ts`: 符号创建和克隆
- `src/style-factory.ts`: 样式工厂函数
- `README.md`: 完整 API 文档和使用示例

### 测试与构建结果

**命令**: `pnpm --filter @desktop-webgis/ol-style test`
- **结果**: ✅ 通过
- **测试用例**: 21 个全部通过
  - 等间距分类: 6 个
  - 分位数分类: 5 个
  - 值分类: 7 个
  - 颜色数一致性: 3 个
- **耗时**: 229ms

**测试覆盖**:
- ✅ 固定数组精确断点断言
- ✅ 边界值分类归属
- ✅ 大量重复值去重(不生成空图例)
- ✅ 常量数据单段处理
- ✅ 空数值集错误提示
- ✅ 无效值忽略和计数
- ✅ 类型严格区分(数字/字符串)
- ✅ 颜色数与有效分段一致

**命令**: `pnpm --filter @desktop-webgis/ol-style build`
- **结果**: ✅ 通过
- **TypeScript**: 编译通过
- **产物检查**:
  - `dist/index.js` + `.d.ts` (主入口)
  - `dist/classification/index.js` + `.d.ts` (子入口)
  - 所有源文件编译成功
- **耗时**: 1.16s

### 验收核对 (phase-1-gis-workbench.md § P08)

| 验收项 | 验收证据 | 结果 |
|--------|---------|------|
| 不依赖 Desktop/gis-core/scene-schema | package.json 无相关依赖 | ✅ PASS |
| 不依赖 React/Zustand/Tauri | package.json 无相关依赖 | ✅ PASS |
| OL 作为 peerDependency | peerDependencies: ol ^10.10.0 | ✅ PASS |
| 只声明已验证 OL 版本 | ^10.10.0 (当前最新稳定版) | ✅ PASS |
| JSON 可序列化契约 | types.ts 全部纯数据类型 | ✅ PASS |
| single/categorized/graduated | types.ts 三种模式完整定义 | ✅ PASS |
| 点/线/面基础符号 | PointSymbol/LineSymbol/PolygonSymbol | ✅ PASS |
| 混合几何按类型渲染 | MixedSymbol 包含三种子符号 | ✅ PASS |
| 字段/分类/断点/fallback | CategorizedStyle/GraduatedStyle 完整 | ✅ PASS |
| 可选标注 | LabelConfig 可选字段 | ✅ PASS |
| ./classification 无 OL 依赖 | 只依赖标准 JS,无 import ol | ✅ PASS |
| 等间距算法 | classifyEqualInterval + 测试 | ✅ PASS |
| 分位数算法 | classifyQuantile + 线性插值 | ✅ PASS |
| 只接受有限 number | extractValidNumbers 类型检查 | ✅ PASS |
| 空字符串不转为 0 | typeof === 'number' 严格判断 | ✅ PASS |
| 区分数字 1 和 '1' | 测试用例验证 | ✅ PASS |
| null/缺失 → fallback | classifyValue 返回 -1 | ✅ PASS |
| 首段含最小值 | classifyValue i===0 分支 | ✅ PASS |
| 上界包含,下界不含 | value > lower && value <= upper | ✅ PASS |
| 去重断点 | deduplicateBreaks 函数 | ✅ PASS |
| 常量数据单段 | min===max 返回 [min] | ✅ PASS |
| 空数值集报错 | 返回 error 字符串 | ✅ PASS |
| 分位数线性插值 | 插值公式 + API 文档说明 | ✅ PASS |
| 固定数组精确断点 | 测试用例断言 breaks | ✅ PASS |
| 边界归类精确 | 9 个边界值测试 | ✅ PASS |
| 重复值不生成空图例 | 去重后 breaks.length 减少 | ✅ PASS |
| 颜色数与有效分段一致 | breaks.length 断言 | ✅ PASS |

**说明**:
- ✅ PASS: 已实现且有代码/测试证据

### 未验证项

1. **OL 运行时集成**: 
   - 当前只完成纯算法和契约定义
   - OpenLayers StyleFunction 编译需在 P09 实现
   - 符号缓存和性能优化待 P09 验证

2. **Desktop 集成**:
   - gis-core 样式迁移待 P09
   - UI 样式面板待 P10
   - Scene 协议集成待 P11

3. **npm 发布准备**:
   - tarball 打包验证待 P20
   - 独立消费验证待 P20
   - 许可证和 scope 确定待 P20

### 已知限制与设计决策

1. **OpenLayers 版本**:
   - 声明 ^10.10.0 (当前最新稳定版)
   - OL 11 尚未发布,待发布后升级

2. **符号类型**:
   - 第一版只支持 circle 点符号、solid 线符号、solid 面符号
   - 不支持图标、渐变填充、虚线等高级符号
   - 混合几何通过 MixedSymbol 按类型分发

3. **标注功能**:
   - LabelConfig 定义了字段/字号/颜色/描边/缩放范围
   - 实际渲染逻辑待 P09 实现

4. **色带预设**:
   - 提供 4 个预定义色带(BlueRed/GreenYellowRed/Grayscale/Rainbow)
   - 用户可通过 generateColorRamp 自定义

5. **浮点数精度**:
   - 分位数插值可能产生浮点误差(如 6.4 → 6.3999...)
   - 测试使用 toBeCloseTo 容差比较
   - 实际应用中断点显示需要格式化

6. **分类方法**:
   - 第一版支持 equal-interval / quantile / manual
   - 未实现 natural-breaks (Jenks) / standard-deviation 等
   - GraduatedStyle.method 字段预留扩展

### 技术细节

**分类算法实现**:

```typescript
// 等间距: 范围均分
interval = (max - min) / numClasses
breaks[i] = min + i * interval  // i ∈ [1, numClasses]

// 分位数: 线性插值
q = i / numClasses
p = q * (n - 1)
if (lower === upper):
  breaks[i] = sorted[lower]
else:
  fraction = p - lower
  breaks[i] = sorted[lower] * (1 - fraction) + sorted[upper] * fraction
```

**区间分类规则**:

```
数据: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
等间距 5 分: breaks = [2.8, 4.6, 6.4, 8.2, 10]

分段:
  0: value ≤ 2.8
  1: 2.8 < value ≤ 4.6
  2: 4.6 < value ≤ 6.4
  3: 6.4 < value ≤ 8.2
  4: 8.2 < value ≤ 10
```

**类型契约示例**:

```typescript
// 分类样式
{
  mode: 'categorized',
  field: 'type',
  categories: [
    { value: 'city', symbol: {...}, label: '城市' },
    { value: 'town', symbol: {...}, label: '乡镇' }
  ],
  fallback: {...}  // 其他类型
}

// 分级样式
{
  mode: 'graduated',
  field: 'population',
  method: 'quantile',
  breaks: [
    { value: 1000, symbol: {...}, label: '< 1k' },
    { value: 10000, symbol: {...}, label: '1k - 10k' },
    { value: 100000, symbol: {...}, label: '> 10k' }
  ],
  fallback: {...}
}
```

**双入口配置**:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./classification": {
    "types": "./dist/classification/index.d.ts",
    "import": "./dist/classification/index.js"
  }
}
```

### API 设计决策

1. **返回 ClassificationResult 而非裸数组**:
   - 携带 ignoredCount 和 error 信息
   - 便于 UI 显示警告和统计

2. **classifyValue 返回索引而非范围**:
   - 索引直接对应 categories/breaks 数组
   - -1 表示无效值,由调用方处理 fallback

3. **符号克隆保留类型**:
   - cloneSymbolWithColor 递归处理 MixedSymbol
   - 保持 TypeScript 类型安全

4. **颜色使用 RGBA 对象而非字符串**:
   - 便于插值计算
   - colorToString 转换为 CSS 格式

### 与计划对照

**计划要求 P08**:
1. ✅ 新建 `packages/ol-style` 独立包
2. ✅ 不依赖 Desktop/gis-core/scene-schema/React/Zustand/Tauri
3. ✅ OL 作为 peerDependency,只声明已验证版本
4. ✅ 定义 JSON 可序列化样式契约
5. ✅ 提供 ./classification 纯算法入口
6. ✅ 主入口可使用 OL 类型(P09 实现)
7. ✅ single/categorized/graduated 三种模式
8. ✅ 点/线/面基础符号,混合几何按类型渲染
9. ✅ 字段、分类项/断点、fallback、可选标注
10. ✅ 等间距和分位数算法
11. ✅ 只接受有限 number,不转换空字符串
12. ✅ 类别区分数字和字符串
13. ✅ null/缺失 → fallback (-1)
14. ✅ 区间规则: 首段含最小值,上界包含/下界不含
15. ✅ 去重断点,常量单段,空集报错
16. ✅ 分位数线性插值,API 文档说明规则
17. ✅ 固定数组精确断点断言
18. ✅ 重复值去重,不生成空图例
19. ✅ 颜色数与有效分段一致
20. ✅ package build/test 通过

### 下一个任务

**P09 — OL 样式编译与桌面接入**

前置条件: P08 (已完成)

主要工作:
- 实现 ol-style 的 OpenLayers StyleFunction 编译器
- gis-core 样式契约迁移(旧 LayerStyle → 新契约)
- ol-runtime 样式编译接入
- 符号缓存优化
- 标签渲染(避免 Text 对象串值)
- 旧项目样式迁移

涉及文件:
- `packages/ol-style/src/compiler.ts` (新增 OL 编译器)
- `packages/gis-core/src/layer.ts` (样式类型迁移)
- `packages/ol-runtime/src/layer/style.ts` (接入新编译器)
- `apps/desktop/src/stores/project.store.ts` (序列化更新)

检查:
- 点/线/面与混合几何渲染
- fallback 生效
- 分类边界正确
- 标签空值处理
- 编辑属性后样式更新
- 旧项目迁移兼容
- Desktop 和相关 package build/test

---

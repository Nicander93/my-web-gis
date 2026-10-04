# @desktop-webgis/spatial-analysis

面向业务开发的空间汇总、连接、诊断与裁剪扩展。无 React、Zustand、OpenLayers 或项目 Store 依赖；处理输入为带字符串 `id`、GeoJSON 几何和 `properties` 的普通对象，输出为独立复制的要素；诊断仅需 ID 和待检查几何。当前包仅在工作区内使用，尚未发布到 npm。

## 几何诊断

`checkGeometries([{ id, geometry }])` 接受只带 ID 和未知几何的输入，返回 `{ checked, valid, invalid, unsupported, issues }`，不要求业务属性，也不修改数据。

每个问题包含 `featureId`、`inputIndex`（从零开始）、`status`、`code`、中文说明及可选的 WGS84 XY `location`。每个要素最多返回首个问题；报告不会因为一条坏几何停止整个批次。未支持的 GeometryCollection 等类型和跨日期变更线输入单独计数，不计为有效。投影坐标超出经纬度范围时报告坐标错误，调用方应先明确输入 CRS。

复用 JSTS IsValidOp 检查单个几何的有效性，包括自交面、孔洞越界或嵌套、重叠多面部件等；有限坐标、非空部件、最小坐标数及 XY 环闭合先做结构检查。第三维保留但不参与拓扑判定；普通自交线不一定是无效几何。它不检查独立要素间的重叠、缝隙、贴边或业务拓扑规则，也不自动修复。无可用诊断坐标时 `location` 为 null。

## 公共 API

### 测量与字段计算

```ts
import { measureGeometry, addGeometryMeasurements, calculateField, compileFieldExpression } from '@desktop-webgis/spatial-analysis'

const measured = addGeometryMeasurements(regions, {
  measurement: 'area', field: 'area_km2', unit: 'square-kilometers'
})
const density = calculateField(measured, {
  field: 'density', expression: 'round(coalesce(field("population"), 0) / field("area_km2"), 2)'
})
// For ordinary business records, compile once and evaluate independently of GIS.
const expression = compileFieldExpression('field("amount") * 2')
expression.evaluate({ amount: 10 }) // 20
```

`measureGeometry(geometry, options)` 返回数值；`addGeometryMeasurements(features, { ...options, field })` 返回带新字段的独立要素。面积仅支持面，单位为 square-meters、hectares、square-kilometers；长度仅支持线，周长仅支持面，单位为 meters、kilometers。多部件累加；面积扣除孔洞，周长包含孔洞边界。输入须为有效 WGS84 经纬度，复用 [Turf area](https://turfjs.org/docs/api/area) 和 [length](https://turfjs.org/docs/api/length) 7.3.4 计算球面 XY 测量；不参与高程，不是椭球测量或投影平面测量。不支持跨日期变更线。原几何含 Z 时保留原 Z。

`calculateField(features, { field, expression })` 生成新字段；表达式使用 [jsep](https://ericsmekens.github.io/jsep/) 1.4.0 解析，再由本包受限解释器执行。支持有限数值、文本、布尔、null，`+ - * / % **`、数值比较、`=== !==`、布尔 `&& || !`、三元条件。函数为 `field("字段名")`、`coalesce`、`round`、`abs`、`min`、`max`、`concat`。不支持对象/数组、成员访问、全局变量、赋值或任意函数调用；不使用 eval 或 Function。

数值运算不隐式转换文本或布尔；缺失字段值按 null 处理，数值运算空值传播，coalesce 可设默认值；引用字段必须在非空输入中至少存在一次。条件只接受布尔或 null（false）；concat 将 null 视为空文本。条件、布尔运算和 coalesce 按需计算分支，但所有分支都必须符合允许的语法。除零、非有限结果、复杂属性、字段冲突或任一要素失败会使整批失败，不返回部分结果。round 采用 JavaScript Math.round，保留位数 0–12，不用于十进制财务精度。表达式最长 2048 字符、512 个节点、40 层，文本结果最长 65536 字符。

两种字段工具都保留输入属性与几何，生成新 ID，metadata.sourceId 指向直接输入；字段名不能覆盖原字段或为 __proto__、constructor、prototype。开发者 API 不依赖 Worker；桌面在 Worker 中调用并生成可撤销、可保存的独立结果图层。预览仅计算当前范围前 5 条，不保证剩余输入有效。

### 线裁剪

`clipLines(lines, masks)` 接受 LineString/MultiLineString 输入和 Polygon/MultiPolygon 掩膜，复用 JSTS OverlayOp：先融合掩膜，再逐个裁剪输入，避免重叠掩膜重复输出。每个输入最多输出一个独立要素；一段为 LineString，多段为 MultiLineString，无线段则不输出。保留输入属性，生成新 ID，`metadata.sourceId` 指向直接输入；不带入掩膜属性。

沿外边界或孔洞边界的非零长度线段保留；孔洞内部、面外部及孤立接触点不输出。裁剪按 WGS84 XY 平面拓扑计算，结果不保留 Z/M，部件顺序、方向或节点数可能变化，不适合作为保留里程与行进顺序的路线切割。空输入或空掩膜返回空数组；几何无效或不支持时明确报错，不自动修复。输入和结果属性不共享可变对象。

多掩膜融合与复杂线裁剪尚未进行大数据性能验收。库抛出拓扑计算错误时整个任务失败，调用方可先检查或拆分复杂要素；不提供悄悄丢弃失败输入的模式。

```ts
import { summarizeByLocation, joinAttributes, joinByLocation } from '@desktop-webgis/spatial-analysis'

const statistics = summarizeByLocation(regions, sites, {
  predicate: 'intersects',
  countField: 'site_count',
  summaries: [
    { field: 'amount', operation: 'sum', output: 'amount_sum' },
    { field: 'amount', operation: 'mean', output: 'amount_mean' }
  ]
})

const labeled = joinAttributes(statistics, [{ code: 'A', label: '区域 A' }], {
  inputKey: 'code', joinKey: 'code', fields: ['label'], prefix: 'lookup_', mode: 'left'
})

const sitesWithRegions = joinByLocation(sites, regions, {
  predicate: 'within', fields: ['code'], prefix: 'region_', mode: 'left'
})
```

`joinAttributes` 的第二输入是普通记录数组，不要求几何，业务代码可直接连接表格或接口记录。桌面当前提供的是第二矢量图层属性连接入口；还没有独立无坐标表格导入界面。

## 契约

- 空间 API 支持点、线、面及多部件的 WGS84 经纬度；区域统计的第一输入必须为面。几何交给 JSTS 校验，不默默修复。暂不支持 GeometryCollection、跨日期变更线或投影坐标输入。
- `intersects` 包含边界接触；`within` 要求整个输入几何没有落在第二几何外，且内部相交。孔洞内部属于外部，孔洞边界属于边界。
- 统计不融合区域，每个完整要素在每区最多计一次，重叠区域各自计数。`countField` 计算几何匹配数量；数值统计仅接受有限 number，文本数字、空值和非有限值忽略。无有效值时 sum=0，mean/min/max=null；求和溢出报错。
- 属性连接按类型严格相等，文本不自动 trim 或转换大小写；null/undefined/复杂值不匹配。第二输入的重复非空键报错。左连接保留所有输入，内连接仅保留匹配输入。
- 空间连接每个匹配配对输出一条，按第一输入和第二输入原顺序排列；零匹配时左连接保留一次，内连接不输出。`metadata.sourceId` / `overlaySourceId` 标记双方。
- 汇总与连接 API 保留原几何，包括 Z，不剪切要素；拓扑关系只判断 XY。输出生成新 ID，不与输入共享可变对象。原字段、几何和数据不修改。线裁剪会生成新的 XY 几何，Z/M 不保留，详见线裁剪契约。
- 输出字段不能为空、重复或覆盖第一输入已有属性。缺失带入字段填 null；连接字段须至少在一条非空输入中存在。
- 索引使用 JSTS STRtree，几何关系使用 RelateOp；有交叠包围盒的候选仍需逐个精确判断，不能保证任意大数据规模的耗时。

## 构建与消费验证

```sh
pnpm --filter @desktop-webgis/spatial-analysis build
pnpm --filter @desktop-webgis/spatial-analysis test
pnpm --filter @desktop-webgis/spatial-analysis test:consumer
```

构建输出标准 ESM 和声明文件，打包 JSTS 内部模块以解决其深层 ESM 路径的扩展名兼容问题。`test:consumer` 使用包公开 exports 在 Node 中执行构建产物，并以 NodeNext 模式编译 TypeScript 消费示例；不使用源码 alias。运行环境需要 `structuredClone` 和 `crypto.randomUUID`，建议 Node 20+ 或现代安全上下文浏览器。

JSTS 2.7.1 许可证为 EDL-1.0 或 EPL-1.0。正式分发时需保留第三方许可与通知；本仓库尚未选择并发布此扩展包自身的对外发行许可证。

Turf 与 jsep 使用 MIT 许可证；正式分发同样需要保留其许可与版权通知。

## 算法规模基准

`pnpm --filter @desktop-webgis/spatial-analysis benchmark` 通过公开构建产物入口生成固定合成数据：100 个无重叠方格区域和区域内点，默认点数量为 100、1000、10000。可传入逗号分隔规模，如 `benchmark 1000,10000`，上限 100000。每项预热一次，再计时三次取中位数，验证结果数量、区域计数总和及输入属性不变；输出 Node、CPU、平台及 JSON 记录。

涵盖测量字段、字段计算、区域统计和空间连接，不包含复杂拓扑、线裁剪、面叠加、重叠区域配对爆炸或真实业务数据。耗时只覆盖 Node 中算法，不包含 Worker 结构化克隆、地图渲染、主线程响应或文件保存，也没有测量峰值内存。本脚本不设跨机器固定耗时门槛，不作为 GUI 性能通过的证据；基准记录用于确定后续优化方向。

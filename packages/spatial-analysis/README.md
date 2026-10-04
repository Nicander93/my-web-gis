# @desktop-webgis/spatial-analysis

面向业务开发的空间汇总与连接扩展。无 React、Zustand、OpenLayers 或项目 Store 依赖；输入为带字符串 `id`、GeoJSON 几何和 `properties` 的普通对象，输出为独立复制的要素。当前包仅在工作区内使用，尚未发布到 npm。

## 公共 API

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
- 所有 API 保留原几何，包括 Z，不剪切要素；拓扑关系只判断 XY。输出生成新 ID，不与输入共享可变对象。原字段、几何和数据不修改。
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

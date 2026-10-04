# 空间处理 Worker 基准

开发验收页面，不进入产品功能区，不读写项目。生产构建使用 Desktop 的实际 Worker 与取消服务；Node 和浏览器共用固定合成场景。

```sh
pnpm --filter @desktop-webgis/spatial-analysis build
pnpm --filter @desktop-webgis/spatial-analysis benchmark:complex 10000
pnpm --filter @desktop-webgis/desktop benchmark:build
pnpm --filter @desktop-webgis/desktop preview --config vite.benchmark.config.ts --configLoader runner --host 127.0.0.1 --port 5187 --strictPort
```

打开 http://127.0.0.1:5187/benchmarks/processing.html。开发模式使用 benchmark:browser，但开发服务耗时不能与生产构建混同。

- overlap-join：每点带 256 字符属性，匹配 12 个重叠区域。基准显式设 200000 上限，以测量 120000 条返回；产品默认上限为 100000。
- hole-clip：三维线穿过孔洞，必须返回两个 XY 段，范围 [0,4]、[6,10]，不保留 Z。
- dense-measure：最多 100 个面，每面 512 外环顶点与 128 孔洞顶点，面积为正。

Worker 耗时含创建、冷启动、双向结构化克隆、算法和结果交付。dispatchMs 是调用返回 Promise 前的同步耗时，不是算法时间。10ms 定时器最大间隔观察基准页主线程调度；记录空闲基线、标签可见性和浏览器 UA，不测地图渲染。浏览器单次采样；Node 预热一次、三次取中位数。

取消测试发送请求后约 50ms 调用 abort，检查 AbortError 和新任务恢复。Worker 可能还在冷启动，不能证明算法入口之后的取消或物理线程停止延迟。上限测试固定 10000 输入、100000 结果预算，期待整批错误，无结果返回；落库原子性由应用命令测试验证。

原始证据：[Worker JSON](../../../docs/plans/processing-worker-baseline-2026-10-04.json)、[Node JSON](../../../docs/plans/processing-complex-baseline-2026-10-04.json)。均为合成数据；尚未验收原生 WebView、真实业务数据、峰值内存及地图同步。浏览器可见扩展注入，记录仅用于定位线索，不作跨环境性能保证。

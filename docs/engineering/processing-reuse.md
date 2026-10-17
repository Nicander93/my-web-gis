# 二维处理工具复用评估

审计基准：`d5dd0fb`，2026-10-16。用户确认：成熟算法优先复用，扩展计算能力，不替换现有 OpenLayers/Cesium 工作区。E06 是集成与结果验收，不是重新编写空间算法。

## 现有 18 项工具

| 工具 | 当前计算来源 | 接入层需要维护的契约 |
|---|---|---|
| 面积字段、长度字段、周长字段 | Turf area/length 7.3.4 | WGS84 球面 XY、单位、孔洞/多部件、保留原几何 |
| 字段计算 | jsep 1.4.0 + 受限解释器 | 表达式白名单、类型/空值、逐行错误、整批原子提交 |
| 几何检查 | JSTS IsValidOp 2.7.1 | 坐标/结构预检、问题定位、明确不支持类型，不自动修复 |
| 缓冲区 | Turf buffer 7.3.4 | 距离/单位、极区及日期变更线限制、属性与独立结果 |
| 顶点质心 | Turf centroid 7.3.4 | 顶点均值，不冒充面积加权中心 |
| 整体外包矩形 | Turf envelope 7.3.4 | 全范围、退化输入和日期变更线限制 |
| 多部件拆分 | Turf flatten 7.3.4 | 属性复制、原要素对应关系 |
| 面裁剪、面相交、面差集 | Turf intersect/difference/union 7.3.4 | 掩膜融合、属性策略、边界接触、空结果 |
| 线裁剪 | JSTS OverlayOp 2.7.1 | 多掩膜融合、孔洞/边界、多线输出、明确不保留 Z/M |
| 面融合 | Turf union 7.3.4 | 全量/字段分组、不暗中汇总属性 |
| 按位置提取 | JSTS RelateOp 2.7.1 | 整要素关系、去重、属性保留 |
| 按区域统计 | JSTS + STRtree 2.7.1 | 空区域、重叠计数、数值统计和字段冲突 |
| 属性连接 | 已有按类型匹配的业务实现 | 重复键明确报错、前缀、左/内连接；无需另引几何引擎 |
| 空间连接 | JSTS + STRtree 2.7.1 | 每匹配配对一条、结果预算、稳定顺序和来源 |

来源：`packages/gis-core/src/processing.ts`、`packages/spatial-analysis/src/`、`apps/desktop/src/features/processing/executeProcessing.ts`。保留这些实现，先补端到端验收；没有为了换库而统一替换已验证算法。

## GeoLibre 引擎结论

- 使用官方 npm 包 **geolibre-wasm 1.7.1**，精确锁定。发布 gitHead：`b8d67e84241c3f8d312e1a21a8682193936478d0`；完整性写入 `pnpm-lock.yaml`。
- [官方工具包](https://github.com/opengeos/geolibre-rust)提供两层：`.` 为 wasm-bindgen 内存 API，`./tools` 为 WASI 工具执行器。此次使用 `initTools` / `listManifests` / `runTool` 的实际公开接口。
- 对已安装版本执行 `listManifests()` 得到 **1065 项清单**。这是引擎目录数量，不等于产品已接入工具数。新增简化后，本产品处理目录为 **19 项**。
- 引擎无需服务端或 Python。Worker 按需加载本地 WASM；Vite 排除该包的依赖预构建，Worker 使用 ES 模块分包。生产目录包含 CLI WASM 24,111,247 字节和 library WASM 6,663,421 字节。运行简化只需加载 CLI，发行包当前同时带上两个资源，不依赖第三方 CDN。
- npm 及上游标明 MIT。对应发布提交的完整许可保存在 `apps/desktop/public/third-party/geolibre-wasm-LICENSE.txt` 并随构建分发。工具 manifest 的 source/license_tier 仍需逐项看，不能将目录全部算作已验证、可用功能。

## 首个完整案例：几何简化

调用真实 `simplify_features`（Whitebox 来源，open tier），使用上游 Douglas–Peucker 实现。接入层只处理数据、校验及项目事务，不实现简化算法。

- 从当前图层按全部/过滤/选中范围取得输入，后台 Worker 执行。取消或项目 epoch 变化会终止 Worker，包含 WASM 加载期间；不引入另一套任务与取消系统。
- 首版仅接受二维 LineString/MultiLineString/Polygon/MultiPolygon。输入必须符合已有 WGS84 经纬度契约；不支持 Z/M、GeometryCollection 输入和跨日期变更线。
- 容差明确为 **度**，有限数值、`0 < tolerance <= 180`，不是米，不按当前地图 EPSG:3857 的显示单位猜测。暂不提供米制简化或共享边拓扑保证。
- 真实文件接口探测发现嵌套属性被转成字符串、原 ID 不保留。因此只向引擎发送几何和内部输入序号；返回后检查序号唯一、数量与类型，再恢复原始属性副本及 metadata.sourceId，创建新 ID。用户同名 source_index 属性也不经过引擎，不会被内部序号覆盖。
- 上游将多部件序列化为同类 GeometryCollection；适配层只还原对应 MultiLineString/MultiPolygon 容器，再执行现有几何校验。不是逐点重写或替换算法。
- 输出结构错误、对应关系丢失、类型变化或无效几何时整批失败，不添加部分结果。过大容差下，上游可能保留原有效面，顶点数不保证一定减少；没有伪造成功的简化率。
- 使用现有独立本地图层命令，一步 Undo/Redo；原图层保持不变。ProcessingRecord 保存引擎 ID、版本、工具 ID、容差/单位及输入来源，随项目保存重开。
- 新增参数使用 Ant Design InputNumber。已有处理窗口的其他旧控件仍属于通用控件余项，不能宣称整个窗口已完成 Ant Design 迁移。

## 扩展顺序

1. 保留已验证的 18 项工具，补 E06 的缓冲/叠加处理集成验收。
2. 按首例结果再扩展矢量工具；先核对 manifest、输入输出格式、单位、属性/ID、退化输出和取消，不直接批量启用整个目录。
3. 栅格、地形、水文等需先定义结果资源模型、文件体积与内存边界，再复用相同 runner；不强行转成矢量图层。
4. 多工具形成稳定需求后，再提取清单驱动的统一参数表单；本轮没有预先搭建千项工具 UI 或额外框架。

浏览器、生产静态构建、Tauri 宿主分别记录证据；算法单测成功不替代产品链路验收。视觉细节交由用户，本轮不截图。

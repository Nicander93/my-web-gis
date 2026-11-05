# 统一场景文档 v3（实施中的协议）

当前范围：共享文档用于保留内容，以及 JSON 与 ZIP 的导入导出，不保证同一份文档在两个引擎中渲染出相同的画面。二维的 `vector` 和 `tile` 节点只在二维工作区显示，三维原生的 `geojson` 和影像节点继续在三维工作区显示。

实现入口是 [scene-schema/document.ts](../../packages/scene-schema/src/document.ts)，纯操作入口是 [scene-core/document.ts](../../packages/scene-core/src/document.ts)。本规范对应 S04 的第一批可执行实现，尚未满足 S04 的全部验收条件，也不作为已经稳定发布的公共协议。

## 文档与兼容入口

`SceneDocument.version` 为 3。`resources`、`nodes`、`views`、`activeView` 是新的内容结构。现有的 `SceneManifest` v1/v2 和 `parseScene` 保留兼容；`migrateSceneDocument` 把旧地图场景和独立的 CityScene v1/v2 转成 v3，`parseSceneDocument` 只接受 v3。两者都在同一个 schema 包里，不另外新增应用专有的协议包。

| 字段 | 当前定义 |
| --- | --- |
| resources | 按稳定 ID 存储 GeoJSON、XYZ、Provider、WMS、WMTS、WFS、3D Tiles 和 glb 资源。WFS 同时保存原始服务定义和本地快照；多个显示节点可以引用同一个资源 |
| nodes | 按从下到上的顺序描述 vector、tile、3dtiles、model、geojson、graphic、water 或 group。资源引用统一用 `resource` 字段，组织关系的引用统一用 `parentId` |
| views | 二维的投影、中心、缩放和旋转与三维相机分别定义；三维位置使用 WGS84 度和椭球米 |
| activeView | 必须引用已存在的视图；切换视图不会改写另一个引擎的相机 |
| environment | 保留原有的三维底图、地形、雾、辉光、光照和时间。设备 DPI、GPU 缓存实例和自动降级不放在这里 |
| extensions | 命名空间字典，每项包含正整数 `version`、`required` 和 JSON 格式的 `data`。未知内容会被保留，消费者通过 `getUnsupportedSceneExtensions` 报告不支持的版本 |

二维的样式、标注和 Popup 沿用已有的共享样式结构。三维对象保留原有的变换、精度、缓存预算、图形属性和高度模式。vector 的 `filter` 是字段条件数组，使用受限的操作符和 JSON 值；文档层的操作不会把过滤结果烘焙进去，也不会删掉未显示的数据。

点 Graphic 可以带 `style.billboard: { image, width, height }`，图标和 `label`/`labelField` 同时显示。几何仍然是单个 WGS84 点，继续使用原有的坐标编辑、Popup 和历史。宽高单位是像素，范围 1 到 512；图标底部锚定在该点上，保留图片原本的颜色。没有 billboard 时仍然渲染原来的圆点。`createBillboardStyle()` 每次返回独立的默认值，不会改动已有的图形。

图片支持内嵌的 PNG/JPEG/WebP/GIF、URI 编码的 SVG，以及不带凭据的 HTTP(S) 地址。内嵌字符串最长 3,000,000 个字符；Desktop 上传限制为 2 MB，解码之后才进入属性草稿。blob 和 file URL 不进入持久化契约；网络图片由 Cesium 加载，依赖网络状况和图片服务器的跨域配置。矩形、椭圆这类参数化几何不用 Billboard 表示。

`GraphicGeometry` 新增了 `rectangle` 和 `ellipse` 两个分支，两者的 `positions` 都恰好是两个对角控制点，不是面环，也不是离散采样点。经纬差必须非零，经度跨度不超过 180°，不会自动跨越日期变更线；椭圆限制经纬跨度各不超过 10°，控制点纬度在 ±85° 以内。两点的高度必须一致，绘制时采用第一个点的椭球高度，编辑第一个点的高度会同步到另一个点；贴地显示仍由 Cesium 的地表决定。

矩形是经纬方向上的包围范围，使用原生的 RectangleGraphics。椭圆以该范围的中点为圆心，用圆心到东西、南北边界中点的 WGS84 测地距离计算两条以米为单位的半轴，使用原生的 EllipseGraphics。长轴按南北或东西方向排列，不支持任意旋转。两个控制点可以移动或用数值编辑，不提供插入和删除。`graphicMinimum()` 和 `isParametricGraphic()` 供工具和 UI 使用；旧的点、线、面数据不做转换。图形组件的组合方式参考 `cesium-demo`，绘制事务、范围校验、参数计算和生命周期由正式 package 独立实现。

## 校验与迁移约束

- 拒绝循环引用、非有限数、类实例、函数，以及 JSON 序列化时会丢失的 undefined。顶层和环境中的未知字段必须放进扩展。
- 节点 ID 全局唯一；`parentId` 只能引用 group，且不能形成循环。资源和活动视图必须存在。
- 图层样式、资源配置、三维几何、变换、相机和环境沿用已有的协议校验器，并在创建原生对象之前执行。
- 迁移时优先保留二维 ID，三维中冲突的 ID 依次加数字后缀；三维的资源引用和分组引用同步重映射。各资源仍保持独立身份，不会因为 URL 相同就自动去重。
- 分组保留本地的显隐和锁定状态；移动或迁移时不会把父组的状态覆盖到子节点。
- 可选的未知扩展可以继续保留；如果遇到标记为必需的未知扩展，运行时必须阻止“完整恢复成功”的承诺。JSON 里不携带用于执行扩展的代码。

旧的发布场景可能已经被过滤、截断过 WFS，或压平过分组。迁移只能保留文件里实际存在的内容，无法还原它缺失的项目数据。完整 ProjectSnapshot 的转换必须使用后续的全量适配器，而不是默认会应用过滤的发布编译器。

当前 `parse` 返回的是分离的文档，更新时会深复制。大资源共享存储和增量变化集还没有完成，不能宣称已经满足大数据量下的手势性能预算。

## 尚未达成的协议要求

1. v3 的 JSON Schema 与 TypeScript 类型、运行时校验三者保持一致；继续完善 GeoJSON 几何、WMTS 矩阵等既有校验器的语义边界。
2. 完整 ProjectSnapshot 的双向转换已覆盖 WFS 服务与快照、字段类型、二维分组和过滤前的数据；还需要支持当前项目无法表达的完整文档配置，并接入资源准备和事务式导入。
3. 资源元数据、包内路径与依赖清单、凭据引用的完整映射、迁移问题，以及 ID 重映射报告。
4. 双引擎工厂消费 v3、按视图报告支持能力、必需扩展阻止恢复、单一内容真源，以及历史适配。
5. 完整 JSON 与资源包往返、替换与合并事务、外部 tarball 消费，以及原生验收。

本批测试覆盖旧样式迁移、全量内嵌数据、Popup、跨引擎 ID 冲突、三维分组与相机及环境、过滤定义、无效引用、循环分组、扩展保留、输入不可变和文档往返。以上缺口仍按完整的实施计划推进。

# 统一场景文档 v3（实施中的协议）

实现入口：[scene-schema/document.ts](../../packages/scene-schema/src/document.ts)，纯操作入口：[scene-core/document.ts](../../packages/scene-core/src/document.ts)。本规范对应 S04 的第一批可执行实现，尚未满足 S04 的全部验收，不作为已稳定发布的公共协议。

## 文档与兼容入口

`SceneDocument.version` 为 3。`resources`、`nodes`、`views`、`activeView` 是新的内容结构。现有 `SceneManifest` v1/v2 和 `parseScene` 保留兼容；`migrateSceneDocument` 将旧地图场景及独立 CityScene v1/v2 转为 v3，`parseSceneDocument` 仅接受 v3。二者位于同一个 schema 包，不新增应用专有协议包。

| 字段 | 当前定义 |
| --- | --- |
| resources | 按稳定 ID 存储 GeoJSON、XYZ、Provider、WMS、WMTS、WFS、3D Tiles、glb 资源。WFS 同时保存原始服务定义与本地 snapshot；多个显示节点可引用同一资源 |
| nodes | 按从下至上顺序描述 vector、tile、3dtiles、model、geojson、graphic、water 或 group；资源引用统一为 resource，组织引用统一为 parentId |
| views | 二维投影、中心、缩放、旋转，与三维相机分别定义；三维位置使用 WGS84 度和椭球米 |
| activeView | 必须引用存在的视图；切换视图不改写另一引擎的相机 |
| environment | 保留已有三维底图、地形、雾、辉光、光照和时间。设备 DPI、GPU 缓存实例及自动降级不属于这里 |
| extensions | 命名空间字典，每项有正整数 version、required、JSON data；未知内容保留，消费者通过 getUnsupportedSceneExtensions 报告不支持版本 |

二维样式、标注和 Popup 延续既有共享样式结构。三维对象保留原有变换、精度、缓存预算、图形属性和高度模式。vector 的 filter 是字段条件数组，使用受限操作和 JSON 值；文档操作不会烘焙过滤或删掉未显示数据。

## 校验与迁移约束

- 拒绝循环、非有限数、类实例、函数和 JSON 会丢弃的 undefined。顶层及环境的未知字段须进入扩展。
- 节点 ID 全局唯一；parentId 只能引用 group，不能形成循环。资源和活动视图必须存在。
- 图层样式、资源配置、三维几何、变换、相机和环境复用既有协议校验器，并在创建原生对象前执行。
- 迁移时二维 ID 优先保留，三维冲突 ID 依次加数字后缀；三维资源引用及分组引用同步重映射。各资源仍保持独立身份，不根据 URL 自动去重。
- 分组保留本地显隐与锁定；移动或迁移不把父组状态覆写到子节点。
- 可选未知扩展可继续保留；必需未知扩展必须由运行时阻止“完整恢复成功”的承诺。JSON 不携带执行扩展的代码。

旧发布场景可能已经过滤、截断 WFS 或压平分组。迁移只能保留文件实际包含的内容，不能恢复其缺失的工程数据。完整 ProjectSnapshot 的转换必须使用后续全量适配器，而不是默认会应用过滤的发布编译器。

## 纯操作

scene-core 提供 createSceneDocument、add/replace/removeSceneResource、add/replace/remove/moveSceneNode、setSceneDocumentView、setSceneEnvironment 和 serializeSceneDocument。调用不会修改输入；所有结果重新校验。资源被引用时不能直接移除，分组存在后代时不能直接移除，递归删除必须显式请求 cascade。替换节点保持 ID，移动节点检查父级循环。

当前 parse 返回分离的文档，更新会深复制。大资源共享存储和增量变化集尚未完成，不能宣称满足大数据手势性能预算。

## 尚待完成的协议门槛

1. v3 JSON Schema 与 TypeScript、运行时校验的一致性；进一步完善 GeoJSON 几何、WMTS 矩阵等既有校验器的语义边界。
2. 完整 ProjectSnapshot 双向转换已覆盖 WFS 服务与快照、字段类型、二维分组和过滤前数据；尚需支持当前工程无法表达的完整文档配置，并接入资源准备与事务式导入。
3. 资源元数据、包内路径和依赖清单、凭据引用的完整映射、迁移问题及 ID 重映射报告。
4. 双引擎工厂消费 v3、按视图支持能力报告、必需扩展恢复阻断、单一内容真源与历史适配。
5. 完整 JSON／资源包往返、替换／合并事务、外部 tarball 消费及原生验收。

本批测试覆盖旧样式迁移、全量内嵌数据、Popup、跨引擎 ID 冲突、三维分组／相机／环境、过滤定义、无效引用、循环分组、扩展保留、输入不可变与文档往返。以上缺口仍按完整实施计划推进。

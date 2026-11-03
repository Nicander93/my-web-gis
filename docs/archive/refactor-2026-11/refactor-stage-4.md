# 阶段 4：地图/场景增量同步与工具生命周期

## 2026-11-02

`OlMapRuntime.syncDocument`：同一投影下复用已有 `VectorSource`，对变化行调用 `applyGisFeature` 更新几何与属性，删除缺失 ID，追加新行。Draw/Modify 持有的 Feature 引用在原地更新后仍然有效。投影变更或无前序 Source 时仍新建 Source。

失败的后续 sync 不丢已安装内容；取消中的异步准备仍按 revision 丢弃。

验证：`packages/ol-runtime` 文档同步测试（含 patch 不换 Source）；Desktop `map-canvas-runtime` / architecture-baseline。Cesium 路径未改语义，仍从 `Project.content` 取场景。

未完成：宿主侧“仅数据变化时跳过 document 结构 reconcile”的更细路由；百万级空间分块；删除全部旧 `syncLayers` 消费者前的全量审计。

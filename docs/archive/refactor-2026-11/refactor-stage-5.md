# 阶段 5：大数据验证、清理与最终文档

## 2026-11-02

- 最终职责说明：[README.md](README.md)。
- 基线：`apps/desktop/src/__tests__/architecture-baseline.test.ts` 对 100 / 10_000 / 100_000 / 1_000_000 要素测量配置操作成本；配置显隐/样式不把要素拷进 ProjectStore。
- 100k：显隐/单点几何 <1ms；`captureActiveSessions` 约 0.1–0.4s（拷原始源）。未跑 100k 场景投影。
- 1m：加载快照约 15–19s；显隐 + edit-state 约 0.6ms。未测场景投影、范围查询、地图交互，不能宣称百万级编辑流畅。
- OL Source 在要素变更时原地 patch，避免“改一行换一层 Source”。
- 旧 `featuresByDataset` 读入兼容保留；工程默认保存已改为配置+原始源/引用，不再把 pending 有效行当权威落盘。
- 数据保存/放弃：工具栏与图层菜单提供「保存数据」「放弃数据」；`discardDatasetEdits` 按源清 Buffer 与对应历史。
- 清理：未删除项目旧格式读路径；并行权威模型未再引入。

遗留：百万级场景投影与交互、浏览器 sidecar 写入、原生 dataset-storage 全链路本批未重跑。浏览器补了一条 `dataset-save-discard.e2e.ts`（放弃按源、浏览器拒绝本地写），不是完整 13 项回归。

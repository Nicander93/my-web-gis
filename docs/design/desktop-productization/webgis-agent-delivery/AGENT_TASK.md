# 给实现 Agent 的主任务（可整段复制）

请读取本目录下全部文档与两个 HTML 原型，然后对 `https://github.com/Nicander93/my-web-gis` 的**最新默认分支代码**开展二维、三维桌面 GIS 全面产品化重构。

## 执行原则

1. **先拉最新代码，创建独立工作分支，不直接改 main/master**。先运行 build/test/E2E 并记录基线，再按 `docs/04-Agent-分阶段实施与验收计划.md` 分阶段实施，完成后提交 PR。
2. 将 `prototypes/desktop-webgis-2d-final.html` 和 `prototypes/desktop-webgis-3d-final.html` 作为最终 UI/UX 基准；产品细节按 `docs/01-产品功能与交互规范.md`、`docs/02-UI-UX-设计与组件规范.md`；架构按 `docs/03-技术架构与重构方案.md`。不要要求用户再次评价原型。
3. 用户明确决定：**二维/三维是独立项目；统一 Shell，不做一个项目多视图；地图 Canvas 全铺底；自由 Docking；项目默认引用大型本地数据，不做项目资源打包；3D POI/线/面是独立 Graphic，不要求先建 GraphicLayer。**
4. 保留仓库已有真实能力与已有 package 的独立发布方向，不能为了 UI 重构删除导入、图层管理、属性表、空间处理、撤销、项目保存或服务连接功能。
5. 完成真正的二维 GIS 数据编辑和三维 Cesium 模型/标绘/裁剪/压平，不许用 HTML 的模拟行为代替真实结果。`https://github.com/Nicander93/cesium-demo` 中 `src/views/tile-local-flatten/useTileLocalFlat.ts`、`src/views/draw-util/drawUtil.ts`、`src/views/mask1/texture-mask.ts` 可参考，但需工程化重做，不得直接复制其固定高度与资源清理问题。
6. 阶段内必须建立测试并验证，尤其是旧项目兼容、工具 Esc、全宽底部属性表、模型变换、3D Tiles 独立裁剪、压平坐标空间/高程、资源重定位和恢复草稿。GPU 真实模型测试无法运行要明确报告并提供运行步骤，不得假报通过。
7. 尽可能自行推进到完成；只有涉及不可逆数据改动、架构性阻塞或真实 3D 压平算法无法达标时，再提供具体证据及需要决策的问题。遵守原方案，不要频繁回头讨论细微 UI。

## 交付标准

每阶段提供“做了什么 / 代码位置 / 测试证据 / 未完成和风险 / commit”；最终提交 PR，并附 2D、3D 实机截图、测试结果、20 项端到端验收矩阵、文档变更与已知限制。**不得把仅展示按钮或样式替换称为重构完成。**

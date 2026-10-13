# Desktop WebGIS — 最终原型与 Agent 实施资料

**版本**：Implementation Baseline 1.0 · 2026-10-13  
**目标仓库**：<https://github.com/Nicander93/my-web-gis>  
**参考仓库**：<https://github.com/Nicander93/cesium-demo>  
**状态**：用户已确认沿用本交付包内两个 HTML 作为最终原型，接下来由 Agent 完成二、三维产品化重构。

## 文件目录

```text
webgis-agent-delivery/
├── README.md                         # 当前说明 / 冲突优先级
├── AGENT_TASK.md                     # 可直接复制给 Agent 的主任务
├── docs/
│   ├── 01-产品功能与交互规范.md
│   ├── 02-UI-UX-设计与组件规范.md
│   ├── 03-技术架构与重构方案.md
│   └── 04-Agent-分阶段实施与验收计划.md
└── prototypes/
    ├── desktop-webgis-2d-final.html   # 已认可的二维 HTML 原型
    ├── desktop-webgis-3d-final.html   # 已认可的三维 HTML 原型
    ├── check-2d.png                  # 截图参考（非真实 GIS 运行）
    └── check-3d.png                  # 截图参考（非真实 GIS 运行）
```

## Agent 如何使用

1. 先阅读 `AGENT_TASK.md`（主指令）。
2. 完整阅读四份文档，尤其理解各文档的**MUST、P0 与不可做事项**。
3. 打开两个 HTML 观察窗口布局、属性编辑、Ribbon、场景树、属性表、绘制和诊断 UI。HTML 完全离线可打开，但只包含交互模拟，没有真实 OpenLayers/Cesium/Tauri 文件服务；不要借助其演示数据验收实际运算。
4. 获取当前最新 `my-web-gis` 代码后按 M0-M9 阶段实施，保留当前已经实现的 GIS 能力，最后提交 PR 和证据。

## 冲突优先级

1. 本交付包 `01-产品功能与交互规范.md` 的产品行为、功能边界、数据安全，以及 `04-实施与验收计划` 的明确门槛。
2. `02-UI-UX-设计与组件规范.md` 的视觉结构与交互规范。
3. 两个已经确认的 HTML 的可视化外观、窗口交互示例。
4. `03-技术架构与重构方案.md` 的技术建议；如果发现新的代码事实，应提出更合理的等价方案，但保持既定产品行为和已发布 API 兼容性。
5. 此前项目旧文档和聊天讨论。早期 PRD V0.1 中的 **Vue / Pinia / 仅二维 / 非自由 Docking 等约束已经过时**；当前实际仓库是 React、Tauri、OpenLayers、Cesium。

如果 HTML 的模拟行为与正式产品规范冲突，**以正式规范为准**；例如 HTML 中“操作完成”的 toast 不构成真正的算法实现，三维效果必须通过真实 Tileset 验证。

## 已决定的产品边界（不要再次讨论）

- 单个项目独立二维或三维；新建时决定类型；共用外壳和项目服务；暂不做 2D/3D 联动及单项目多视图。
- Ribbon 顶部三行结构；Docking 覆盖地图，画布完整铺底；左树默认开，右/底默认关；无常驻恢复小按钮。
- 单击选择、双击定位、右键完整属性；Esc 退出工具模式。连续 POI 无需每次确认属性。
- 三维 Folder 可自由嵌套，独立 Graphic 自己保存样式，不强制 GraphicLayer，也不强制样式继承。
- 大型本地模型按引用使用相对/绝对路径，项目另存与数据缺失重定位；不做资源打包与自动复制。
- 正式属性/业务数据修改需可撤销、可保存、可恢复。3D Tiles 裁剪/压平为场景效果，不改动原始瓦片。
- 窗口诊断性能/资源/调试共用，按不同渲染引擎适配。

## 参考代码与静态阅读范围

- `my-web-gis` main 审阅 SHA：`015774120577546514baadd30cc22b1c79d9dbe4`（2026-10-11），Agent 开始时必须再次拉取最新代码。
- `cesium-demo` main 审阅 SHA：`418dd9a9735bb43e8c1402e71e26c34d8fb8a15d`（2026-01-27）。
- 已核对：`packages/cesium-layer/src/graphic-layer.ts` 支持多 Graphic；桌面 `CitySceneRuntime` 现有 `createLayer(graphic)` 仍是一 Graphic 一个 GraphicLayer；`cesium-demo` 的压平算法为实验代码、有坐标空间/固定高度/资源管理问题，不应直接拷贝。

## 验收时不能混淆的两种“完成”

- **交互原型完成**：HTML 能展示和模拟操作；本包已包含。
- **产品功能实现完成**：实际项目数据、算法、持久化、错误处理与测试完整闭环；本包是交给 Agent 的执行规范，不代表仓库代码已经实现。

本包未修改 GitHub 仓库、未运行完整产品构建或真实模型测试。代码实施和结果验收属于下一阶段工作。

# 代码分层与包边界

本文档说明 Desktop 的目录分层、依赖方向，以及 `packages/` 中哪些包可以独立发布。新增或移动代码前先对照这里。目录迁移记录见 [分层计划](layering-plan.md)。

不使用“领域层”“Domain”之类的说法，目录和文档直接用职责命名。

## Desktop 目录

```text
apps/desktop/src/
  shell/        外壳与整体布局：App、Workspace、SceneWorkspace、Header、面板、docking、StatusBar
  features/     各功能界面（按功能分子目录，保持现状）
  commands/     用户操作入口：一个函数对应一次完整的用户操作
  runtime/      地图与三维引擎宿主：创建引擎、把工程和数据交给引擎、收集引擎诊断
  exchange/     外部格式与外部服务：导入、导出、WFS/GeoServer、场景文档/归档、代码导出
  view-state/   界面状态：选择、属性表、检查器、工具、布局、任务记录；关掉工程即可丢弃
  session/      工程会话：当前工程配置、单一编辑历史、工程保存、数据保存与放弃、恢复草稿
  data/         要素数据运行时：Provider/Buffer 的持有者、要素订阅 hook、数据文件读写
  platform/     运行环境：Tauri 与浏览器差异、文件与对话框、凭据、HTTP、资源路径、状态消息
  ui/           通用组件与样式，不认识工程和要素
  __tests__/    跨层集成测试（保持现状）
```

`cartography-spike/`、`cartography-visual-baseline/`、`cartography-webgl/` 是独立 HTML 入口，不纳入分层检查。仓库脚本 `pnpm check:architecture` 会检查分层方向、`project` 包内部方向，以及可发布包是否只依赖可发布包。

### 依赖方向

从上到下排列，每层只能依赖排在它下面的层：

```text
shell
features
commands
runtime
exchange
view-state
session
data
platform
```

`ui` 不在这条链上：`shell` 和 `features` 可以用它；它自己只能依赖 `view-state`（读取界面密度、字号等偏好）和 `platform`。所有层都可以依赖 `packages/` 中的包。

几条容易混淆的规则：

- `features` 可以订阅 `session`、`data`、`view-state` 的状态，但修改工程或数据要通过 `commands`。
- `session` 不认识 `view-state`。工程被替换、图层被删除后需要清理选择或属性表时，由 `session` 发出通知，`view-state` 或 `shell` 订阅后自己清理。
- `data` 不认识 `session`。数据提交后改写历史属于 `session` 的职责。
- `runtime` 不调用 `commands`，也不决定何时执行编辑；它把用户在地图上的操作交给上层回调。

### 新代码放在哪里

按顺序判断，第一个符合的就是答案：

1. 只是一个可复用的界面控件，不知道工程是什么：`ui/`。
2. 只在桌面端和浏览器端有差别，或直接调用 Tauri：`platform/`。
3. 读写要素行、Provider/Buffer：`data/`。
4. 涉及工程配置、编辑历史、工程或数据的保存与恢复：`session/`。
5. 关掉工程就可以丢弃的界面状态：`view-state/`。
6. 处理外部文件格式或外部服务：`exchange/`。
7. 创建或驱动 OpenLayers/Cesium 实例：`runtime/`。
8. 用户能触发的一次完整操作：`commands/`。
9. 某个功能的界面：`features/<功能>/`。
10. 布局、面板、菜单栏这些把功能组合起来的部分：`shell/`。

不跨层的纯计算函数放在使用它的层里；被多层用到且不依赖应用状态时，考虑放进对应的包。

## packages

### 可发布包与内部包

规则：**可发布包只能依赖可发布包**；内部包可以依赖任何包；任何包都不能依赖 `apps/`。是否可发布以 `package.json` 中有没有 `"private": true` 为准。

可发布（只要求达到可发布状态，不执行 `npm publish`）：

- `ol-style`：依赖 `@maplibre/maplibre-gl-style-spec`、`ol-mapbox-style`、`@xmldom/xmldom`；`ol` 为 peer。
- `ol-selection`：viewer 和 `ol-runtime` 共用；`ol` 为 peer。
- `vector-io`：自带 GeoJSON 类型，不再依赖 `scene-schema`。
- `ogc-io`：依赖 `ol-style`。
- Cesium 套件：`cesium-scene-schema`、`cesium-layer`、`cesium-popup`、`cesium-measure`、`cesium-effects`、`cesium-tileset-edit`、`cesium-tileset-effects`。

内部：

- `project`：工程配置、要素数据和编辑历史。依赖 `ol-style`、`cesium-scene-schema`、`spatial-analysis`。
- `ol-runtime`：依赖 `project`、`ol-style`、`ol-selection`、`ogc-io`、`ol-scene-runtime`。
- `spatial-analysis`：几何处理与量算，含缓冲区、叠加等 turf/jsts 实现。
- 场景文档套件：`scene-schema`、`scene-core`、`scene-publisher`、`scene-codegen`、`ol-scene-runtime`、`cesium-scene-runtime`。只给本仓库的 desktop 和 viewer 使用。

### `project` 包的内部目录

```text
packages/project/src/
  clone.ts, id.ts   基础工具，不依赖其它文件
  data/             要素与数据集：GisFeature/Geometry/DatasetField 等类型、Provider/Buffer、
                    MemoryFeatureStore、数据集字段与校验、GeoJSON 解析、字段身份、过滤、排序、统计
  config/           工程配置：Project/Layer/Dataset 等类型、工程创建与格式迁移、图层树、样式、
                    制图、字段引用重定位、数据源能力、工程分享、ProcessingRecord
  history/          编辑历史与命令：EditHistory、配置命令、三维命令、编辑目标与锁定
  index.ts          对外导出，几何处理函数转自 spatial-analysis
```

依赖方向：`history → config → data → 基础工具`。`data` 不能 import `config` 或 `history`。`config` 不能 import `history`。

## 相关文档

- [架构总览与架构图](README.md)
- [数据与编辑架构](data-and-editing.md)
- [分层与包边界整理计划](layering-plan.md)

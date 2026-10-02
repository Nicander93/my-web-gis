# 城市三维样例

`city-sample` 是本仓库自行生成的 16 栋低模城市街区和独立 GLB 塔楼，无在线服务或 ion token 依赖；用于交互验证，不是真实城市数据。通过 `node examples/city-3d/generate-sample.mjs` 重建。坐标位于北京附近，建筑高度 35–125 米。样例模型与生成器使用 MIT 许可（参见 Cesium 扩展包 LICENSE）。

## 编辑器

仓库根目录执行 `pnpm install`、`pnpm build`、`pnpm dev`，切换「城市三维」，点击「加载城市样例」。支持整体 ENU 移动、旋转、缩放、一次拖动一次撤销、参数输入、显隐、Popup、水面参数和边界坐标、雾/辉光、初始视角、保存工程、导入和导出场景。GLB 图层可从列表拖到地图上生成副本。

导入自有 3D Tiles 时填写 tileset.json 的 HTTP(S) URL，GLB 使用模型 URL，GeoJSON 使用数据 URL。跨域资源需服务端允许 CORS。模型加载失败会显示原因，可点击「重新加载资源」。本阶段不提供本地文件系统资源浏览器；相对资源必须能由当前 Web 服务访问。

## 独立消费者

执行 `pnpm --filter @desktop-webgis/city-consumer-example dev`。`consumer` 使用底层图层、Popup、编辑和特效 API，无编辑器、React、Zustand、Tauri 或 OpenLayers 依赖。Vite 配置展示 Cesium 静态资源复制，main.js 展示 `addTo/bindPopup/setMode/onCommit/destroy`。

## 静态 Viewer 与发布

`scene.json` 为可发布样例，`resources.json` 映射本地 tileset 根文件，发布器递归收集子 tileset / GLB / glTF 显式依赖。

```sh
pnpm build
node packages/scene-publisher/dist/cli.js --scene examples/city-3d/scene.json --viewer apps/viewer/dist --resources examples/city-3d/resources.json --out publish/city-demo
```

输出目录须不存在或为空。使用 HTTP 静态服务器打开输出目录的 index.html（不能以 file:// 打开）。Viewer 默认显示三维，提供「查看二维地图」入口。线上资源保持在线引用；本地资源缺失、越界或覆盖 Viewer 文件会在写出前报错。地形与影像服务只支持在线发布，不打包服务目录；本地隐式瓦片、i3dm、cmpt、subtree 暂不支持依赖收集，可使用在线 URL。

## 包边界与开源准备

六个 Cesium 包均有 ESM、声明文件、exports、README 和 MIT LICENSE，Cesium 使用 peer dependency。运行 `pnpm --filter '@desktop-webgis/cesium-*' pack --pack-destination <目录>` 可构建本地 tarball，pnpm 会将 workspace 引用改写为版本号。对外发布前需确认 npm scope 所有权、发布顺序、版本兼容矩阵及 API 稳定性。当前未执行 npm 发布。

本地包验证（pnpm 11）：将 tarball 输出到仓库根 `.artifacts/packages`，执行 `node scripts/prepare-city-pack-smoke.mjs`，进入 `.artifacts/packed-consumer` 执行 `pnpm install`、`node smoke.mjs`。该目录独立维护 pnpm-workspace.yaml，通过 overrides 指向尚未发布的本地包，不引用工作区源码。

尚未实现镜面反射水面、单建筑网格编辑、二三维相机/样式实时联动或任意本地城市目录导入。参考 [cesium-demo](https://github.com/Nicander93/cesium-demo) 的交互思路；没有复制其反混淆水面源码。

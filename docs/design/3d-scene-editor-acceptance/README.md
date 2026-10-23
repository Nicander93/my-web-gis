# 三维场景编辑器 V1 验收记录

日期：2026-10-23。实施基线：`main@619fb3c`；实施分支：`codex/3d-scene-editor-v1`；目标 Cesium：1.145.0。阶段范围见 [实施记录](../../plans/3d-scene-editor-implementation.md)。原技术设计保留审查时的历史状态，以实施记录描述当前进展。

## 单元、构建与浏览器

机器可读汇总：[verification-summary.json](verification-summary.json)。

| 执行入口 | 结果与范围 |
| --- | --- |
| `pnpm -r test` | 22 个测试包，1,032 通过、6 跳过；包含 Desktop 398 通过、5 跳过 |
| `pnpm -r build` | 全仓包、示例、Viewer 和 Desktop 构建通过；最后导出清理修复后另行重建 Codegen 与 Desktop 通过 |
| `pnpm --filter @desktop-webgis/desktop test:e2e:scene-editor` | 1440×900、1024×680 专用集 28/28 通过，见 [浏览器日志](browser-regression.txt) |
| `pnpm --filter @desktop-webgis/desktop exec playwright test --config playwright.scene-editor.config.ts cesium-native-export.e2e.ts --output ../../.artifacts/scene-editor-v1/export-final --reporter line` | 最终生成代码两档视口 2/2 通过，见 [独立模块日志](native-export.txt) |

专用集包含三维工作栏、模型属性窗固定目标/冲突保护、参数提交与单次历史、非法草稿保护、样式预览/取消/清除、选择高亮、保存/重开，以及二维制图编辑、检查器与悬停/按压几何稳定性。独立模块使用原生 Cesium Viewer 加载真实 Tileset 与 GLB，检查原生 Style、256 MiB 缺省缓存、Graphic、环境和 ENU 位移（误差小于 1 cm），并确认销毁本次创建的资源。

Codegen 单元覆盖省略/显式参数、原生变换与弹窗、既有 Viewer 中途加载失败、尚未挂载的 primitive/GeoJSON 回收，以及自有影像图层销毁和调用方资源保留。构建保留已有的大 chunk 与 Tauri 静态/动态 import 提示。浏览器运行使用真实 WebGL2 上下文；此处不将浏览器用例推导为原生资源或生产数据性能结论。

受限 Windows 沙箱中，28 项用例完成后开发服务器的结束操作被权限限制，核对父进程与端口后仅清理该次自有服务器，命令最终退出 0。最后两项独立模块复验在允许结束自有子进程的执行环境正常退出 0。

## Windows / WebView2 实际资源验收

执行 `pnpm --filter @desktop-webgis/desktop test:native-scene-editor`，9 组场景通过。完整机器可读结果：[native-report.json](native-report.json)。报告是本轮实际运行产物的原样副本，引用的临时资源目录只用于定位该次运行，不作为可移植部署地址。

原生报告 SHA-256：`44f6b10e7f508e876ae080a88bf06ac5d6bd81f38802a9fa8b33b71df21533e9`。

- 真实嵌套 Tileset JSON/GLB、GLTF 外部 binary/纹理和 GeoJSON 通过本地资源协议加载；包含中文、空格与保留字符的路径。
- 三维工作栏、原生 Style 草稿/历史、SSE 参数与完整属性操作，在实际 CSS 尺寸 1440×900 和 1024×680 下可达。
- 工程保存为相对引用，结束进程后重启，样式与参数恢复；单资源及父目录重定位后，子瓦片实际重新加载，GeoJSON 数据源不重复。
- 跨目录另存快照保留工作状态和原文件字节；复制工程拒绝未授权根目录，重新授权不增加工程历史。
- 实际图形上下文为 WebGL 2，渲染器为 ANGLE / NVIDIA GeForce RTX 5070 / Direct3D 11。未执行截图或逐像素签收。

验收器使用隔离的应用标识与用户目录。仅测试入口临时授予窗口调尺寸能力，产品默认 capability 不增加权限；结束后恢复正常构建配置并停止验收进程。

## 证据边界与待办

此报告使用仓库生成的真实资源样本；没有据此得出生产倾斜摄影、大模型、影像或地形的加载规模、内存与帧率结论。此类数据尚未提供，需要单独验证。

系统文件选择器、Windows 系统 125% 缩放未验证。浏览器行为、原生资源协议、实际 GPU 与用户的界面/交互签收分别报告，不能相互替代。P3 当前仅为 Tileset 参数试点；独立 CesiumJS 导出会对未支持的裁剪/压平、水面、参数图形、图标/标注和扩展阻止保存。

历史 `workspace-state.e2e.ts` 的两个视口用例仍依赖二维旧版“符号颜色”直接输入与草稿提示，与当前制图面板即时编辑入口不一致；本轮未修改二维生产行为来迎合该断言，也不宣称全部历史 E2E 已通过。当前专用验收集包含二维制图编辑、检查器和共享控件回归。

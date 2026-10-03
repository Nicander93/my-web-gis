# P21 验收前置：启动与构建修复

日期：2026-09-30（Asia/Shanghai）。基线：`main@4311b46c3bcb7330e99357dda0ceaf3da6736eac`。

用户已要求拉取最新代码并沿方案继续。`git pull --ff-only` 返回已是最新；未跟踪的 `scripts/` 和原 stash 保留。

## 实际发现与修复

在 Codex 内置浏览器打开 `http://127.0.0.1:5173/`，应用停在加载状态，控制台报告 `getSnapshot should be cached` 和 `Maximum update depth exceeded`。

Inspector 的 Zustand selector 在没有会话时返回新建的 `{}`，导致 React 反复更新。改为直接订阅会话（不存在时为稳定的 `undefined`），在组件读取页签时处理缺省值。没有改变会话持久化、工程 Dirty 或编辑历史。

随后 Desktop build 发现 TS2345：凭据引用收集函数的 source 类型只包含可选 credentialRef，不能接受本地 GeoJSON 文件数据源。source 类型补充可选的 type 字段，使本地和服务数据源都能传入；本地 source 仍不产生凭据引用。已有用例改用真实 `VectorDataset` 文件来源验证这个边界。

## 验证

- Desktop test：17 个文件，89 个用例通过，5 个可选 live 用例跳过。
- Desktop build：TypeScript 和 Vite 构建通过。仍有较大产物及动态/静态导入混用警告。
- 实际浏览器：刷新后正常显示地图、工具栏、图层面板和检查器；检查器收起后可恢复，空工程继续显示“请选择一个图层”。
- [修复后的界面截图](../assets/p21-startup-recovery-2026-09-30.jpg)。截图对应本轮未提交修复，不代表基线代码已经正常启动。

## 尚未验收与下一步

P21 继续为受阻。本轮没有完成场景 E/L。

点击添加数据和选择文件后没有出现浏览器文件选择器。源码 `services/files.ts` 直接调用 Tauri plugin-dialog 与 invoke，没有浏览器文件选择实现。当前工具只提供浏览器控制，原生应用控制不可用，因此无法用这条路径完成真实样本导入、绘制、字段编辑和导出。下一步应在可控制的 Tauri 桌面环境完成 E/L，或按方案中浏览器文件通道的要求补齐浏览器入口后继续验收；不能用现有单测代替场景通过。

真实桌面窗口重启、离线工程、真实令牌 OGC 重连、其他完整场景与性能证据仍未关闭；npm 发布继续暂缓。

# 场景协议与核心 tarball 消费验收

本脚本验证 `cesium-scene-schema` → `scene-schema` → `scene-core` 的实际 tarball
依赖链。它不验证 OL/Cesium 渲染，也不代表所有候选包已达到发布门槛。

从仓库根目录执行：

```powershell
rtk proxy pnpm --filter @desktop-webgis/scene-core... build
rtk proxy node scripts/prepare-scene-pack-smoke.mjs
```

依次在 `packages/cesium-scene-schema`、`packages/scene-schema`、
`packages/scene-core` 下执行：

```powershell
rtk proxy pnpm pack --pack-destination ../../.artifacts/scene-packages
```

然后在 `.artifacts/scene-packed-consumer` 下执行：

```powershell
rtk proxy pnpm install --offline
rtk proxy node smoke.mjs
rtk proxy node ../../node_modules/typescript/bin/tsc consumer.ts --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022
```

消费者拥有独立 workspace 清单，只从 tarball 安装公共包；没有源码 alias。
TypeScript 编译器来自开发工具目录，声明解析来自消费者的 node_modules。
脚本检查 Schema 文件导出、JS API、完整序列化往返、合并 ID 修复及发布依赖
中无 `workspace:`。生成物保存在已忽略的 `.artifacts`。

本轮结果：三个 tarball 离线安装、Node 运行和严格声明消费检查均通过。
scene-schema、scene-core 的许可证决策仍未完成，不执行 npm 发布。

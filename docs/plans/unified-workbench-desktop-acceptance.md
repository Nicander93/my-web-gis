# 统一工作台桌面端交接验收

验收日期：2026-10-06（Asia/Shanghai）。

## 补丁与基线

- 远程 main 基线：`c32d9c232ad97c2607551808e0e12159d6ea76a8`。
- 交接原提交：`25eb23a99d42fdefcebd0c04066cf0eb98cd7305`。
- 通过 `git am --3way` 无冲突应用为 `034daa6eed9b304ad9f1a732c6dfbbf87815fbad`，未重新实现功能。
- 应用后文件树：`cb4a5b30478f3ddb6ebbbca6b09d680096be0241`，与交接 README 的验证版本一致。
- 原分支上的空间处理提交、未跟踪 P17/P18 脚本保留，未包含在本次提交中。

## 构建与测试

- `pnpm install --frozen-lockfile`：通过。
- `pnpm --filter '@desktop-webgis/desktop^...' build`：通过。
- `pnpm --filter @desktop-webgis/desktop test`：29 个测试文件通过，144 个测试通过，5 个环境相关测试跳过。
- `pnpm --filter @desktop-webgis/desktop build`：TypeScript 与 Vite 生产构建通过；仍有大包及混合静态/动态导入提示。

## 原生 Windows 验收

使用仓库已有的 Tauri debug 可执行文件（2026-10-02），加载本次补丁的 Vite 开发服务 `http://127.0.0.1:5173/`。通过 Windows 原生窗口操作验收，未重新生成安装包。

1. 创建二维项目，显示紧凑 Ribbon，右侧与底部默认关闭。
2. 从添加数据入口打开 Windows 原生文件对话框，导入 `examples/stations.geojson`，确认解析并加入 2 个要素。
3. 原生保存项目到 `native-map.webgis.json`，通过原生打开对话框重新打开，图层保留且编辑目标清除。
4. 从图层省略号菜单选择导出，原生保存 `native-layer.geojson`，文件含 2 个要素。
5. 创建三维项目，加载仓库城市示例；原生视图真实呈现并定位到 16 栋建筑的 3D Tiles 模型，显示资源已加载。
6. 对象省略号菜单提供对象属性、定位、数据源和导出对象等入口；选择对象后工具区绑定该编辑目标。
7. 对象属性中设置东向平移 12 米并应用，显示对象属性已应用；执行撤销，东向恢复为 0，重做可用。
8. 从对象菜单原生保存 `native-object.scene.json`；文件含 1 个对象与引用资源地址 `./city-sample/tileset.json`。
9. 从项目菜单原生保存整体场景 `native-scene.scene.json`；核对撤销后的对象平移为 `[0,0,0]`。
10. 从项目菜单导入之前导出的对象场景文件；显示场景已导入，建筑对象、资源地址与变换保留，模型仍呈现。

验收文件位于本地忽略目录 `.artifacts/unified-workbench/`，不提交项目数据。交接包原有 Chromium 验收记录仍归属于交接环境，本次未重新执行完整浏览器验收。真实远程服务、全新 Rust 编译及安装包验收未覆盖；上述原生结果针对已有 debug 宿主与当前前端。

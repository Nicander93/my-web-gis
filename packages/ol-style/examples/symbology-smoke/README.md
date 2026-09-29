# symbology-smoke

独立示例：分类样式、等间距分级、分位数分级、标注与图例。

本目录不是 pnpm workspace 包；真正的工作区外消费验证由 `pnpm --filter @desktop-webgis/ol-style verify:consumer` 执行（`pnpm pack` → 临时目录安装 tarball + `ol@^10.10.0` → 类型检查与运行）。

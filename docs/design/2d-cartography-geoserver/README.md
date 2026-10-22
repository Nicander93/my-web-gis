# 二维制图 GeoServer 验收

2026-10-21，隔离本机实例 `127.0.0.1:18085`，GeoServer **2.28.2**，官方二进制包配合 Java 17。仅使用发行包内 sf 示例数据，不连接用户服务。

发行包 SHA-256：`1A9DFC36E1BDD88E1117EF552F96E64B4B88514F7F2006F0E45A8B9223B170B4`。

## REST / WMS

入口：`apps/desktop/scripts/cartography-geoserver-acceptance.mjs`。脚本只允许上述实验地址，密码从环境读取。运行前构建 `ol-style` 和 `ogc-io`。

```powershell
$env:CARTOGRAPHY_GEOSERVER_URL='http://127.0.0.1:18085/geoserver'
$env:CARTOGRAPHY_GEOSERVER_PASSWORD='<isolated lab password>'
node scripts/cartography-geoserver-acceptance.mjs
```

在 `apps/desktop` 下运行。归档 [rest/results.json](rest/results.json) 含服务器实际版本、目标资源、实际发布版本名、哈希、兼容性级别、步骤日志与非透明像素统计。同目录每例保留 `.sld`、`.report.json`、`.wms.png`、`.legend.png`。

11 例：道路描边、河流、行政边界、虚线、标注 halo、SVG 图标、面图案、迁移分类、迁移分级、固定 Zoom、字段驱动线宽。全部经真实上传、XML 规范化回读、图层关联回读及 WMS/GetLegendGraphic PNG 验证。SVG/面图案另断言实际资源颜色，避免把服务器缺图替代符号误认为成功。

该服务不返回 ETag。已有同名样式不执行 PUT，创建新版本、保留旧哈希并关联实际版本名；归档包含 `oldStylePreserved`。服务端图层配置仍是 GET/PUT 乐观检查，不提供跨请求事务。

## 证据边界

REST 脚本证明真实服务接受并绘制常用子集。[浏览器工作流结果](browser-workflows.results.json) 的 10 项中包含真实发布向导，采用 Node 路由桥接 CORS；Rust HTTP 6 项和 Windows 系统凭据单独测试。上述证据不代表原生 Tauri 界面人工验收或跨渲染器像素一致。

[配对图像基线](baseline/README.md) 的独立 Playwright 验收通过：1 项测试、5 个场景（实线、虚线、透明填充、文字 halo、双层主干道）。使用相同 WFS 数据、EPSG:3857 范围、分辨率、256×256 尺寸与 1 倍像素比；保留 OL/WMS PNG、差异图和运行元数据。字体、抗锯齿、标签避让与沿线文字的差异保留，不将自动化通过作为主观视觉签收。

## 官方参考

- [GeoServer REST styles](https://docs.geoserver.org/stable/en/user/rest/api/styles/)
- [GeoServer filter functions](https://docs.geoserver.org/stable/en/user/filter/function_reference/)
- [GeoServer 2.28.2 官方发行目录](https://sourceforge.net/projects/geoserver/files/GeoServer/2.28.2/)

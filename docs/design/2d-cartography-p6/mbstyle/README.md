# GeoServer MBStyle 路线验收

MBStyle 是独立的可选导出路线，SLD 仍是向导默认格式。导出器只放行经过约束的标准 Style v8 子集；无法保真或未在本项目 GeoServer 版本验证的属性会报告为 `approximated` 或 `unsupported`。严格模式遇到 `unsupported` 不生成可发布 JSON。

## 本次真实服务验证

验收目标是隔离的 GeoServer 2.28.2，地址 `http://127.0.0.1:18085/geoserver`。能力探测只读 `version` 与 `manifest`，并且只将 `gs-mbstyle-*` 扩展模块版本与 GeoServer 版本比较；`gt-mbstyle-*` 是 GeoTools 模块，版本号语义不同。单测分别覆盖两种模块顺序。

正向样例从既有样式用 `migrateLayerStyle` 生成标准图层，保留 `geometry-type` 过滤，发布到真实 GeoServer，读取原生 JSON 回读并校验哈希，关联到图层，再请求 WMS。验收脚本使用浏览器解码返回的 256×256 PNG，断言画面有非透明像素且存在预期符号颜色：

| 样例 | GeoServer 图层 | 保留的几何过滤 | 非透明像素 | 预期颜色像素 |
| --- | --- | --- | ---: | ---: |
| 单符号圆点 | `sf:bugsites` | `geometry-type == Point` | 11,877 | 5,439 |
| 单符号线 | `sf:roads` | `geometry-type == LineString` | 21,217 | 20,251 |

这些结果证明该服务版本能接收、读回并渲染这两个迁移样式；不代表本地 OpenLayers 与 GeoServer 的像素等价，也不代表桌面原生环境验收。

负向样例为迁移分类样式，其中含 `typeof` 类型守卫。当前导出器明确报告不支持并在严格模式拒绝发布，没有删掉守卫后继续渲染。其他 MapLibre 动态表达式和资源引用也不因语法有效就默认视作 GeoServer 已支持。

运行证据归档在本目录：`run-metadata.json` 保存能力模块、远端哈希、发布步骤与解码像素计数；WMS 和图例 PNG 是服务返回的原始图像；分类拒绝报告解释了不支持原因。样式 JSON、远端读回和兼容报告也一并保留。脚本从任意工作目录运行均将临时输出写入忽略目录 `apps/desktop/test-results/cartography-mbstyle-acceptance/`。

在仓库根目录执行真实验收：

```powershell
$env:CARTOGRAPHY_GEOSERVER_URL='http://127.0.0.1:18085/geoserver'
$env:CARTOGRAPHY_GEOSERVER_USER='admin'
$env:CARTOGRAPHY_GEOSERVER_PASSWORD='(隔离实验服务密码)'
pnpm exec node apps/desktop/scripts/cartography-mbstyle-acceptance.mjs
```

脚本拒绝非 `127.0.0.1:18085` 的目标。它会创建并关联实验样式，所以只应对该隔离实例运行。

## REST 行为依据

GeoServer 官方 REST API 将 `application/vnd.geoserver.mbstyle+json` 列为上传 MIME，并说明通过该 Accept MIME 请求样式定义内容；普通 `.json` 路径返回样式元数据，因此客户端通过无扩展样式 URL 加原生 MBStyle Accept 头读回。能力探测依据 GeoServer 的只读 Manifests API，并在未知/缺少版本时保持不支持。

- [GeoServer MBStyle styling](https://docs.geoserver.org/main/en/user/styling/mbstyle/)
- [GeoServer Styles REST API specification](https://github.com/geoserver/geoserver/blob/main/doc/en/api/1.0.0/styles.yaml)
- [GeoServer Manifests REST API](https://docs.geoserver.org/main/en/user/rest/api/manifests/)

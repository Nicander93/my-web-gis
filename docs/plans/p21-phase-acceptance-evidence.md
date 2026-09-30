# P21 全阶段验收证据（诚实记录 / 受阻）

> **状态**: 受阻（不可标为阶段已完成）  
> **证据绑定 SHA**: `42d310beb9e64d205f4a841bb07cf6521528fdfd`（origin/main，MapCanvas wiring squash / PR #26）  
> **执行时间**: 2026-09-30 08:05–08:10 CST  
> **分支**: `local/p21-phase-acceptance-evidence`  
> **本轮性质**: 只做验收证据与交接文档；**未**实现 selection/edit 挂载、keychain、npm publish、live WFS smoke。

## 1. 结论（先读）

P21 **不能**在本 SHA 关闭。硬阻塞项已核实，不得粉饰为 PASS：

1. **桌面未挂载** `OlSelectionRuntime` / `OlToolRuntime`（`map-runtime-host.ts` 仅 `new OlMapRuntime()`）→ 场景 **E**（地图选择联动）、**L**（绘制/编辑）受阻。
2. **无公开 live WFS 冒烟** → 场景 **H** 完整产品验收受阻（仅有 fixture/unit 路径）。
3. **凭据仍为会话内存**（`credentials.ts`：`persistCredentialSecurely` 恒返回 false；注释明确 OS keychain 未接线）→ 场景 **I** 中认证持久化部分受阻。
4. **未 npm publish**（有意；P20/本轮仅 tarball + `verify:consumer`）→ 不阻塞场景 K 的 tarball 口径，但阶段交付仍缺正式发布。

因此：计划表 P21 = **受阻**；阶段总状态仍 **未完成**。

## 2. 本轮实际执行的检查

### 2.1 `pnpm -r test`（根，Scope 13/14 有 test 脚本的包）

在 `D:\\my-code-repo\\my-web-gis` @ `42d310b` 执行，**全部通过**。包级计数：

| 包 | Tests |
| --- | ---: |
| style-assistant | 2 |
| ol-style | 40 |
| ogc-io | 25 |
| scene-schema | 11 |
| gis-core | 41 |
| vector-io | 35 |
| scene-codegen | 3 |
| ol-scene-runtime | 8 |
| scene-core | 7 |
| ol-runtime | 13 |
| scene-publisher | 3 |
| desktop | 67 |
| **合计** | **255** |

原始日志：工作区 `_p21_test_log.txt`（未提交；仅本地证据缓存）。

### 2.2 `pnpm -r build`

**全部 OK**（13/14 有 build 的包；含 `apps/desktop` `tsc --noEmit && vite build`、`apps/viewer` vite build）。  
desktop 有 chunk 体积告警与 vector-io 动静导入提示，**非失败**。

### 2.3 `pnpm --filter @desktop-webgis/ol-style verify:consumer`

**OK**（本 SHA 重跑）：pack → 工作区外 `npm install` → typecheck → 运行 `examples/symbology-smoke` demo。  
peer `ol@^10.10.0`；tarball `desktop-webgis-ol-style-0.1.0.tgz`。

### 2.4 未执行 / 明确未声称

| 项 | 状态 |
| --- | --- |
| 交互式 Tauri/桌面 UI 冒烟（场景 A–J、L 完整路径） | **未执行** |
| 1 万点 + 复杂线面性能计时 | **未执行** |
| 公网 live WFS GetFeature 冒烟 | **未执行**（禁止本轮补做） |
| OS keychain / 凭据持久化 | **未实现**（禁止本轮补做） |
| npm publish | **未执行**（禁止本轮补做） |
| selection/edit runtime 挂载 | **未实现**（禁止本轮补做） |
| cargo / Tauri 原生通道本轮变更验证 | **N/A**（本 SHA 相对 P20 的 MapCanvas 合入未改 Rust） |

## 3. 场景 A–L 矩阵（绑定 `42d310b`）

判定口径：

- **PASS**：本轮对该场景有直接证据且满足计划“必须满足”。
- **受阻**：已知产品缺口使该场景无法在本 SHA 诚实通过。
- **未验证**：能力链路可能存在（单测/实现），但本轮未做计划要求的完整交互验收，**不得标 PASS**。

| 编号 | 结果 | 证据 / 原因 |
| --- | --- | --- |
| A | 未验证 | SHP fixtures + vector-io/desktop 单测存在；**未**在本 SHA 做“导入含中文及投影的 SHP ZIP、选两个源图层、地图位置目视”完整 UI。 |
| B | 未验证 | CSV fixtures + `csv-import` 单测存在；**未**做预览跳过无效行的完整 UI。 |
| C | 未验证 | GeoJSON/DXF fixtures + 解析单测存在；DXF 对 SPLINE/bulge/DWG/BINARY 等会 warning 跳过（见 `packages/vector-io/src/dxf.ts`）；**未**做完整 UI。 |
| D | 未验证 | ol-style/分类/图例/桌面样式命令单测存在；MapCanvas 已能 `syncLayers` 专题样式；**未**做应用后撤销重做+图例一致的完整 UI。 |
| E | **受阻** | 需要地图选择 → 表格定位。`OlSelectionRuntime` 在 `packages/ol-runtime` 存在并导出，但 **desktop `map-runtime-host` 未挂载**；`apps/desktop` 无 `OlSelectionRuntime` / `OlToolRuntime` 引用。属性过滤/导出单测不能替代地图点选。 |
| F | 未验证 | view.commands 面板测试存在；**未**做“搜索表格、滚动、样式草稿、收起全部再恢复”完整 UI。 |
| G | 未验证 | WMS/WMTS 添加与 runtime sync 单测 + MapCanvas 已挂 `OlMapRuntime`（含 retry）；**未**做添加→调序透明度→保存重开完整 UI；**无**公网服务冒烟。 |
| H | **受阻** | WFS 有界加载 fixture/unit（ogc-io 8 + desktop p18 5）存在；计划要求的刷新失败/复制编辑验收缺 **公开 live WFS smoke**，本轮禁止补做。 |
| I | **受阻**（认证持久化）/ 未验证（断网本地） | 项目序列化单测覆盖本地数据与 `credentialRef` 不泄漏；但 `canPersistCredentialsSafely()===false`，Token 仅会话内存 → “恢复联网后凭据仍可用”无法诚实 PASS。断网打开本地部分本轮未做 UI。 |
| J | 未验证 | scene-core/codegen/ol-scene-runtime/desktop P19 单测存在；**未**做“同一专题生成 Scene 并在 Viewer 打开”完整冒烟。 |
| K | **PASS**（tarball 口径） | 本 SHA 重跑 `verify:consumer` OK：独立临时项目安装 tarball + 声明 OL，类型检查与示例运行通过，不依赖桌面仓库。**非** npm registry 发布签收。 |
| L | **受阻** | 绘制/修改/删除需地图编辑工具。`OlToolRuntime` 未在 desktop 挂载；不能声称“新界面完成原有绘制无回归”。 |

## 4. 支持矩阵与已知限制（本阶段如实声明）

### 4.1 已有实现（单测/代码层，≠ 场景签收）

- 文件：GeoJSON、Shapefile ZIP（多层可选）、CSV 点、ASCII DXF（基础实体）
- 服务：WMS 1.3.0/1.1.1、WMTS、WFS 2.0/1.1 有界快照（fixture 路径）
- 样式包：`@desktop-webgis/ol-style` pack + 工作区外消费（K）
- 地图画布：`OlMapRuntime` 已挂载（矢量/WMS/WMTS sync、basemap、zoom/fit/retry、保存 live mapState）

### 4.2 明确未支持 / 未接线

| 项 | 说明 |
| --- | --- |
| 地图选择 runtime | 未挂载 `OlSelectionRuntime` |
| 绘制/编辑 tool runtime | 未挂载 `OlToolRuntime` |
| DXF | 不支持：BINARY DXF、DWG、BLOCK/INSERT、HATCH、SPLINE、带 bulge 的 polyline；CIRCLE/ARC 为折线近似 |
| WFS | 无 WFS-T；无本轮公网 live smoke；快照只读 |
| 凭据 | 仅会话内存；无 OS keychain；`persistCredentialSecurely` 未实现 |
| npm | **未** publish ol-style（或其他包） |
| 性能 | 无 1 万点固定样本计时记录 |

### 4.3 README / 公开说明

- `packages/ol-style/README.md` 已写明未 npm publish、`verify:consumer` 用法（P20）。
- `examples/phase-1/README.md` 样本清单仍有效。
- 本文件为阶段验收证据主记录；**不**把阶段标为已完成。

## 5. 关闭 P21 前必须完成的后续工作（不在本 PR 实施）

1. 在 desktop 挂载 selection + edit/tool runtime，并补场景 E、L 交互证据。
2. （可选但计划期望）固定公网或可复现的 live WFS smoke，记录场景 H。
3. OS keychain / 安全持久化凭据，或明确产品降级文案后重验场景 I。
4. 交互式跑通 A–D、F、G、J，并记录截图/步骤绑定 tip SHA。
5. 性能：固定 1 万点 + 复杂线面样本，记录机器环境与耗时。
6. 真正 npm publish 前另开发布任务（非 P21 冒充）。

## 6. 显式非声称

- **不**声称第一阶段产品验收通过。
- **不**声称场景 A–J、L 为 PASS。
- **不**声称已做 live WFS / keychain / npm publish。
- **不**声称 MapCanvas wiring = P21。
- 场景 K 的 PASS **仅**覆盖 tarball 独立消费，**不**等于已发布到 npm。

## 附录: follow-up independent PR mount debt (not this evidence pack completion)

> Independent task `local/mapcanvas-selection-edit-runtime` mounts `OlSelectionRuntime` / `OlToolRuntime` in code (clears E/L not-mounted debt).
> **This P21 evidence pack status remains 受阻**; do not treat as phase 已完成. E/L still need interactive smoke; H/I and other blockers unchanged.

## 附录: live WFS GetFeature smoke landed（≠ full H；≠ P21 已完成）

> Independent task `local/wfs-live-smoke` adds opt-in public live WFS GetFeature smoke under `@desktop-webgis/ogc-io` (env `DESKTOP_WEBGIS_LIVE_WFS=1` / `test:live-wfs`).
> Primary `ahocevar.com` / `topp:states` returned **403** on this LM; alternate `demo.mapserver.org` / `ms:cities` returned **10** GeoJSON features (HTTP 200).
> **P21 evidence pack status remains 受阻**; do **not** mark P21 已完成.
> Scenario H: live GetFeature path smoke only — **refresh-fail UI** and **copy-edit-export** still open; **≠ full H PASS**.
> No OS keychain; no npm publish. See [wfs-live-smoke-evidence.md](./wfs-live-smoke-evidence.md).

## 附录: OS keychain / credential persistence landed（≠ scenario I PASS；≠ P21 已完成）

> Independent task `local/credential-persistence` wires Tauri desktop credentials to OS secure storage (`keyring` → Windows Credential Manager).
> Auto-persist on successful service connect when `canPersistCredentialsSafely()`; hydrate from secure store on project open / WFS load miss.
> **P21 evidence pack status remains 受阻**; do **not** mark P21 已完成. Scenario I still needs interactive re-verify after restart/reconnect.

## 附录: Scene I credential re-verify after PR#30（≠ full I PASS；≠ P21 已完成）

> Independent task `local/scene-i-credential-reverify` (base `1defc84`) adds opt-in live OS Credential Manager re-verify:
> - A OS CM round-trip **PASS**
> - B restart hydrate (`wipeSessionMemoryOnly` → `hydrateCredentialsFromRefs` / `ensureCredentialLoaded`) **PASS**
> - C restore-network at auth-builder / mock HTTP layer **PASS** (not live tokenized OGC)
> - D full Tauri UI restart + E offline-open UI: **未验证**
>
> **P21 evidence pack status remains 受阻**; do **not** mark P21 已完成.
> Scenario I may be described as **partial** (persist wired + automated restart hydrate PASS) but **not** full PASS / 通过.
> See [scene-i-credential-reverify-evidence.md](./scene-i-credential-reverify-evidence.md).

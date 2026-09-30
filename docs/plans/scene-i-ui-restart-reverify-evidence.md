# Scene I UI / process restart credential re-verify evidence（true process restart；非 full GUI；≠ full I PASS）

- **Status**: Draft
- **Time**: 2026-09-30 19:11 CST (Asia/Shanghai)
- **Branch**: `local/scene-i-ui-restart-reverify`
- **Base**: main `52d2226f443788a5da334aa72e3fdce58da5260e`（PR#31 squash：Scene I partial A/B/C）
- **Tip**: 与本 PR 分支头一致；以门禁当时的 GitHub PR head 为准（本文件不内嵌自引用 SHA）
- **Scope**: Honest **再验** of persisted credentials after a **true OS process restart** boundary on this Windows LM（writer 进程完全退出 → 新进程 hydrate）。**不是** `wipeSessionMemoryOnly` 同进程模拟。
- **Non-claims**:
  - **≠ P21 已完成**
  - **≠ full scenario I PASS**（UI offline-open + live tokenized OGC reconnect **未验证**）
  - **≠ full Tauri GUI window quit + relaunch**（本 LM 无 Playwright/WebDriver/Tauri driver 自动化；未做桌面窗口真正关闭再打开）
  - No localStorage for secrets; no token values logged
  - Left repo-root `?? scripts/` untouched; no npm publish; no CloudAgent; no A–D/F/G/J interactive（此处 D 指场景交互矩阵，非本刀 process-restart 子项）

## Why this knife

开发主管 next after PR#31：only **true UI restart** — after the desktop app is really closed and reopened, persisted credentials still work.

本刀在本 LM 上：**未能诚实自动化完整 GUI quit/relaunch**（无 e2e/playwright/tauri driver；亦无已构建可驱动的 `desktop-webgis` GUI 会话钩子）。因此实现并签收最强可复现路径：**true process restart** — 与桌面应用相同的 Windows Credential Manager service（`desktop-webgis` / `secure-credential-probe`）跨真实进程生死边界仍可 hydrate。明确记录：GUI 窗口级 relaunch **未做**。

## Sub-checks (this LM)

| ID | Check | Result | Notes |
| --- | --- | --- | --- |
| A | OS CM round-trip（既有 live-keychain） | **PASS**（regression） | `test:live-keychain` cargo + vitest A |
| B | `wipeSessionMemoryOnly` restart simulate（既有） | **PASS**（regression） | 同进程模拟；本刀 **不** 把它当作 true restart |
| C | restore-network auth-builder / mock HTTP（既有） | **PASS**（regression） | 非 live tokenized OGC |
| **D-proc** | **True process restart**：writer Node 进程 `probe set` 后 **完全退出**（PID 已死）→ 另一短生命 `probe get` → **全新 vitest 进程**（空 vault，**从不**调用 `wipeSessionMemoryOnly`）`hydrateCredentialsFromRefs` / `ensureCredentialLoaded` | **PASS** | 见下方 PID 摘要；`guiRelaunchAutomated: false` |
| D-GUI | Full Tauri desktop **window** quit + relaunch + UI 可见凭据可用 | **未验证** | 无 GUI automation |
| E | Interactive offline-open of local project | **未验证** | Out of this knife |

### D-proc PID evidence（本机一次成功跑）

```json
{
  "writerPid": 34600,
  "readerPid": 31040,
  "orchestratorPid": 7508,
  "writerAliveAfterExit": false,
  "usedWipeSessionMemoryOnly": false,
  "guiRelaunchAutomated": false
}
```

- writer ≠ reader ≠ orchestrator
- writer 退出后 `process.kill(pid, 0)` 失败 → 确认进程已死
- hydrate 子进程从未持有 vault 中的 secret，仅从 OS CM 加载

## Commands + results

```text
pnpm --filter @desktop-webgis/desktop test
# → 89 passed | 5 skipped (94)  （含本刀 gate；live 默认 skip）

pnpm --filter @desktop-webgis/desktop exec vitest run src/__tests__/credentials-secure.test.ts src/__tests__/credentials-live-keychain.test.ts src/__tests__/credentials-ui-restart-process.test.ts
# → 15 passed | 5 skipped (20)

pnpm --filter @desktop-webgis/desktop test:live-keychain
# cargo live_os_keychain_round_trip → 1 passed
# vitest credentials-live-keychain → 4 passed (A/B/C + gate)

pnpm --filter @desktop-webgis/desktop test:ui-restart
# builds secure-credential-probe
# vitest credentials-ui-restart-process → 2 passed | 1 skipped
#   D: writer exits; fresh vitest hydrates → PASS (~1.5s)
```

Default CI / `pnpm test` does **not** touch Credential Manager（`DESKTOP_WEBGIS_LIVE_KEYCHAIN` unset → live cases skipped）。

## How to reproduce (Windows LM)

1. `pnpm --filter @desktop-webgis/desktop test:ui-restart`
   - Sets `DESKTOP_WEBGIS_LIVE_KEYCHAIN=1`, builds probe, runs process-restart orchestrator + hydrate child.
2. Or manually:
   - `cargo build --bin secure-credential-probe --manifest-path apps/desktop/src-tauri/Cargo.toml`
   - set `DESKTOP_WEBGIS_LIVE_KEYCHAIN=1`
   - set `DESKTOP_WEBGIS_KEYCHAIN_PROBE=apps\desktop\src-tauri\target\debug\secure-credential-probe.exe`
   - `pnpm --filter @desktop-webgis/desktop exec vitest run src/__tests__/credentials-ui-restart-process.test.ts`

## Files

- `apps/desktop/src/__tests__/credentials-ui-restart-process.test.ts` — orchestrator D-proc + hydrate child phase
- `apps/desktop/scripts/ui-restart-writer-child.mjs` — writer process（probe set → handshake → exit）
- `apps/desktop/run-ui-restart-reverify.mjs` — Windows-friendly runner
- `apps/desktop/package.json` — `test:ui-restart`
- 复用既有：`secure-credential-probe`、`credentials.ts` hydrate API（**未改** vault 语义）

## vs P21 / scenario I

- P21 remains **受阻**（do not mark 已完成）.
- Scenario I: persist wired（PR#30）+ A/B/C automated（PR#31）+ **true process-restart hydrate PASS**（本刀）.
- Still open for full I: **GUI** quit/relaunch、UI offline-open、live tokenized service reconnect.
- Therefore scenario I remains **partial** — **not** 通过 / full PASS.

## Soft issues

- Vitest on Windows: `shell: true` + args 触发 Node `DEP0190` deprecation warning（不影响结果）.
- 本刀验证的是 **与 Tauri 相同的 OS CM / probe 路径** + **credentials.ts hydrate**，不是 WebView 内 invoke 的端到端 GUI 会话。
# WFS live GetFeature smoke evidence (independent; not P21 complete)

- **Status**: Draft
- **Time**: 2026-09-30 18:11 CST (Asia/Shanghai)
- **Branch**: `local/wfs-live-smoke`
- **Base**: main `6ce41c874d7b631e77584e8355a39487b06e86c3` (confirmed after `git fetch`)
- **Tip**: 72722ac9d16811e7a71c1b96dd4d85132e532250
- **Scope**: scenario H **live GetFeature path only** via `@desktop-webgis/ogc-io`
- **Non-claims**: **≠ P21 已完成**; **≠ full scenario H PASS** (refresh-fail UI + copy-edit-export still open); no OS keychain; no npm publish; no Cursor CloudAgent; left repo-root `?? scripts/` and stash untouched.

## Endpoint probe (this Windows LM)

| Candidate | Role | Reachability | Notes |
| --- | --- | --- | --- |
| `https://ahocevar.com/geoserver/wfs` `topp:states` | Primary (suggested) | **HTTP 403** | Blocked from this LM (PowerShell + node `fetch`) |
| `https://demo.mapserver.org/cgi-bin/wfs` `ms:cities` | Alternate (public anonymous MapServer WFS) | **OK** | Used for PASS |

## Live result (opt-in)

| Field | Value |
| --- | --- |
| Endpoint | `https://demo.mapserver.org/cgi-bin/wfs` |
| typeName | `ms:cities` |
| version | WFS 2.0.0 |
| outputFormat | `application/json; subtype=geojson` |
| maxFeatures / COUNT | 10 |
| HTTP status | 200 |
| feature count | **10** (≥1) |
| ExceptionReport | none |
| Auth | none (anonymous) |
| shareable URL secrets | none |

## Commands

```text
pnpm --filter @desktop-webgis/ogc-io test
# → 25 passed | 1 skipped (live gated)

pnpm --filter @desktop-webgis/ogc-io test:live-wfs
# → 1 passed (primary 403 → alternate OK, features=10)

pnpm --filter @desktop-webgis/ogc-io build
# → OK
```

## How to reproduce

1. `pnpm --filter @desktop-webgis/ogc-io test:live-wfs`
   - Sets `DESKTOP_WEBGIS_LIVE_WFS=1` via `packages/ogc-io/run-live-wfs-smoke.mjs` (Windows-friendly; no `cross-env`).
2. Or manually: `set DESKTOP_WEBGIS_LIVE_WFS=1&& pnpm --filter @desktop-webgis/ogc-io exec vitest run src/wfs-live-smoke.test.ts`

## Files

- `packages/ogc-io/src/wfs-live-smoke.test.ts` — env-gated live smoke
- `packages/ogc-io/run-live-wfs-smoke.mjs` — sets env + runs that file only
- `packages/ogc-io/package.json` — `test:live-wfs` script

## vs P21 / scenario H

- P21 remains **受阻** (interactive A–D/F/G/J, refresh-fail UI, copy-edit-export, keychain, npm still open as applicable).
- This task only clears the **无公开 live WFS 冒烟** debt for the **live GetFeature path**.
# Scene I credential re-verify evidence (restart + restore-network; not full I PASS)

- **Status**: Draft
- **Time**: 2026-09-30 18:44 CST (Asia/Shanghai)
- **Branch**: `local/scene-i-credential-reverify`
- **Base**: main `1defc842dee0f1de2da95a09d61b1d5cb67ff787` (credential persistence squash / PR#30 land)
- **Tip**: 3e66c8b9f54010363705d29e0061cc5b2a490caa
- **Scope**: Honest **再验** of persisted credentials after PR#30: **app-restart hydrate** and **restore-network auth-builder** paths on this Windows LM
- **Non-claims**:
  - **≠ P21 已完成**
  - **≠ full scenario I PASS** (UI offline-open + live reconnect to a real tokenized OGC service **未验证**)
  - No full Tauri UI restart automation on this LM
  - No localStorage for secrets; no token values logged
  - Left repo-root `?? scripts/` untouched; no npm publish; no CloudAgent; no A–D/F/G/J interactive

## Why this knife

Product/dev: merge ≠ I signed. Must re-verify **restart** + **reconnect** after credential persistence landed. Until then do **not** write scenario I as 通过.

## Sub-checks (this LM)

| ID | Check | Result | Notes |
| --- | --- | --- | --- |
| A | Real OS Credential Manager round-trip (store → get → delete) via `keyring` / `os_secure_credential_*` + probe | **PASS** | Rust live unit + TS probe backend; test keys cleaned up |
| B | Restart simulate: `wipeSessionMemoryOnly` then `hydrateCredentialsFromRefs` / `ensureCredentialLoaded` with project-like `credentialRef` keys | **PASS** | Memory wiped; OS CM untouched; secret usable again |
| C | Restore-network: after hydrate, reconnect/fetch uses loaded cred **without re-entering token** | **PASS** (auth-builder / mock HTTP layer) | Local mock HTTP required `Authorization: Bearer <secret>`; 200 after hydrate. **Not** a live authenticated public OGC service |
| D | Full Tauri UI app restart + offline project open + live reconnect UI | **未验证** | Not automated on this LM |
| E | Interactive offline-open of local project (scenario I offline half) | **未验证** | Out of this knife |

## Commands + results

```text
pnpm --filter @desktop-webgis/desktop exec vitest run src/__tests__/credentials-secure.test.ts src/__tests__/credentials-live-keychain.test.ts
# → 14 passed | 3 skipped (live suite gated off by default)

pnpm --filter @desktop-webgis/desktop test
# → 88 passed | 3 skipped (91)

pnpm --filter @desktop-webgis/desktop test:live-keychain
# builds apps/desktop/src-tauri secure-credential-probe
# cargo test live_os_keychain_round_trip → 1 passed (real CM)
# vitest credentials-live-keychain.test.ts → 4 passed (A/B/C + gate)
```

Default CI / `pnpm test` does **not** touch Credential Manager (`DESKTOP_WEBGIS_LIVE_KEYCHAIN` unset → live cases skipped).

## How to reproduce (Windows LM)

1. `pnpm --filter @desktop-webgis/desktop test:live-keychain`
   - Sets `DESKTOP_WEBGIS_LIVE_KEYCHAIN=1`, builds probe, runs Rust + Vitest live cases.
2. Or manually:
   - `cargo build --bin secure-credential-probe --manifest-path apps/desktop/src-tauri/Cargo.toml`
   - `set DESKTOP_WEBGIS_LIVE_KEYCHAIN=1`
   - `set DESKTOP_WEBGIS_KEYCHAIN_PROBE=apps\desktop\src-tauri\target\debug\secure-credential-probe.exe`
   - `pnpm --filter @desktop-webgis/desktop exec vitest run src/__tests__/credentials-live-keychain.test.ts`

## Files

- `apps/desktop/src/services/credentials.ts` — `wipeSessionMemoryOnly()` (restart model; OS store untouched)
- `apps/desktop/src/__tests__/credentials-secure.test.ts` — unit coverage for wipe/hydrate
- `apps/desktop/src/__tests__/credentials-live-keychain.test.ts` — env-gated live A/B/C
- `apps/desktop/run-live-keychain-reverify.mjs` — Windows-friendly runner
- `apps/desktop/package.json` — `test:live-keychain`
- `apps/desktop/src-tauri` — `os_secure_credential_*` pubs, probe bin, gated Rust live test

## vs P21 / scenario I

- P21 remains **受阻** (do not mark 已完成).
- Scenario I: persist wired (PR#30) + automated restart hydrate **PASS** + restore-network at **credential available to auth builder** layer **PASS**.
- Still open for full I: UI offline-open, full Tauri restart, live tokenized service reconnect.
- Therefore scenario I is **partial** — **not** 通过 / full PASS.
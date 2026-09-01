# Desktop WebGIS

Lightweight 2D desktop GIS workspace based on Tauri 2, React, TypeScript and OpenLayers.

## What is included

- `packages/gis-core`: project, dataset, layer, feature, selection, GeoJSON, edit commands and undo/redo history.
- `packages/ol-runtime`: OpenLayers map runtime, layer registry, feature adapter, selection runtime and edit tool runtime.
- `packages/scene-schema` / `scene-core`: versioned JSON scene contract and immutable scene operations.
- `packages/ol-scene-runtime`: public OpenLayers adapter for XYZ, Tianditu, Google Map Tiles and GeoJSON scenes.
- `packages/scene-publisher`: static Viewer artifact builder and `scene-publish` CLI.
- `packages/vector-io`: SHP ZIP and ASCII DXF import plus Shapefile export.
- `packages/scene-codegen`: OpenLayers ESM code generation without embedded provider secrets.
- `packages/style-assistant`: deterministic smart styling and a validated, provider-neutral AI adapter.
- `apps/desktop`: React Desktop shell with a map-first workspace, overlay panels, Ribbon-style header and lightweight commands; GIS capabilities are being reconnected incrementally.
- `apps/viewer`: framework-independent static Scene Viewer for URL publishing.
- `examples`: sample GeoJSON files for manual import testing.

## Main workflows

- New/Open/Save/Save As project.
- Import `.geojson`, zipped Shapefile or ASCII `.dxf` as dataset and layer.
- Create empty point, line and polygon layers and draw immediately.
- Switch OpenStreetMap, Tianditu and Google Map Tiles basemaps with runtime-only credentials.
- Toggle, rename, reorder and activate layers.
- Select features from map or table.
- Edit attribute values inline.
- Draw Point, LineString and Polygon.
- Modify geometry and delete selected features.
- Undo and redo edit commands.
- Export active layer as GeoJSON or zipped Shapefile.
- Export/import Scene JSON, generate OpenLayers ESM code and build a static Viewer artifact.
- Switch application/published-scene themes and apply local or model-backed smart cartography.

## Run

```bash
pnpm install
pnpm dev
```

Then open the local Vite URL. For desktop mode, run `pnpm tauri dev` from the repository root.

The native shell is scaffolded in `apps/desktop/src-tauri`. Existing GIS packages remain framework-agnostic so the React shell can reconnect them in stages.

## Sample data

Use:

- `examples/rivers.geojson`
- `examples/stations.geojson`

## Project documents

- [`docs/README.md`](docs/README.md): project document index and progressive reading order.
- [`docs/specs/`](docs/specs/): product, architecture, UI and scene specifications.
- [`docs/engineering/code-preferences.md`](docs/engineering/code-preferences.md): code and maintenance conventions.
- [`docs/assets/`](docs/assets/): UI reference images.

## Current verification note

Verified locally:

- all 30 Vitest tests across 12 test files;
- strict TypeScript builds for all packages;
- TypeScript and production React desktop build;
- Tauri debug build;
- production static Viewer build;
- real `scene-publish` artifact with file hashes and a public URL;
- native ESM imports and `npm pack --dry-run` for all seven public packages;
- `cargo fmt --check` for the Tauri shell.

Pending external verification:

- `cargo check --offline` for the Tauri shell cannot run until the `tauri` crate is present in the local Cargo registry cache. Rust desktop compilation still needs one successful Cargo dependency download.

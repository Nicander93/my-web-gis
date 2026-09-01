# Desktop WebGIS V0.1

Lightweight 2D desktop GIS workspace based on Tauri 2, Vue 3, TypeScript and OpenLayers.

## What is included

- `packages/gis-core`: project, dataset, layer, feature, selection, GeoJSON, edit commands and undo/redo history.
- `packages/ol-runtime`: OpenLayers map runtime, layer registry, feature adapter, selection runtime and edit tool runtime.
- `packages/scene-schema` / `scene-core`: versioned JSON scene contract and immutable scene operations.
- `packages/ol-scene-runtime`: public OpenLayers adapter for XYZ, Tianditu, Google Map Tiles and GeoJSON scenes.
- `packages/scene-publisher`: static Viewer artifact builder and `scene-publish` CLI.
- `packages/vector-io`: SHP ZIP and ASCII DXF import plus Shapefile export.
- `packages/scene-codegen`: OpenLayers ESM code generation without embedded provider secrets.
- `packages/style-assistant`: deterministic smart styling and a validated, provider-neutral AI adapter.
- `apps/desktop`: Vue workspace UI with start page, toolbar, layer panel, map canvas, attribute table, feature inspector, command palette and status bar.
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

Then open the local Vite URL. For desktop packaging, install Tauri CLI and run the Tauri command from `apps/desktop`.

The desktop shell is already scaffolded in `apps/desktop/src-tauri`. In desktop mode, the Vue app uses the Tauri dialog plugin for file selection and small Rust commands for reading and writing selected text or binary project/data files.

## Sample data

Use:

- `examples/rivers.geojson`
- `examples/stations.geojson`

## Product and architecture documents

- `01-PRD-V0.1.md`: current two-dimensional editor product requirements.
- `02-Technical-Architecture-V0.1.md`: current application and package boundaries.
- `03-UI-UX-Design-Guidelines-V0.1.md`: interaction and visual direction.
- `04-UI-Implementation-Design-Spec-V0.1.md`: desktop UI implementation guidance.
- `05-Scene-Manifest-and-Publishing-V0.1.md`: declarative scene protocol, reusable package boundaries, P0/P1 roadmap and static publishing contract.

## Current verification note

Verified locally:

- all 30 Vitest tests across 12 test files;
- strict TypeScript builds for all packages;
- Vue type-check and production desktop build;
- production static Viewer build;
- real `scene-publish` artifact with file hashes and a public URL;
- native ESM imports and `npm pack --dry-run` for all seven public packages;
- `cargo fmt --check` for the Tauri shell.

Pending external verification:

- `cargo check --offline` for the Tauri shell cannot run until the `tauri` crate is present in the local Cargo registry cache. Rust desktop compilation still needs one successful Cargo dependency download.

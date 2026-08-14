# Desktop WebGIS V0.1

Lightweight 2D desktop GIS workspace based on Tauri 2, Vue 3, TypeScript and OpenLayers.

## What is included

- `packages/gis-core`: project, dataset, layer, feature, selection, GeoJSON, edit commands and undo/redo history.
- `packages/ol-runtime`: OpenLayers map runtime, layer registry, feature adapter, selection runtime and edit tool runtime.
- `apps/desktop`: Vue workspace UI with start page, toolbar, layer panel, map canvas, attribute table, feature inspector, command palette and status bar.
- `examples`: sample GeoJSON files for manual import testing.

## Main workflows

- New/Open/Save/Save As project.
- Import `.geojson` or `.json` as dataset and layer.
- Toggle, rename, reorder and activate layers.
- Select features from map or table.
- Edit attribute values inline.
- Draw Point, LineString and Polygon.
- Modify geometry and delete selected features.
- Undo and redo edit commands.
- Export active layer as GeoJSON, including selected-only export from the command palette.

## Run

```bash
pnpm install
pnpm dev
```

Then open the local Vite URL. For desktop packaging, install Tauri CLI and run the Tauri command from `apps/desktop`.

The desktop shell is already scaffolded in `apps/desktop/src-tauri`. In desktop mode, the Vue app uses the Tauri dialog plugin for file selection and two small Rust commands for reading and writing selected project/data files.

## Sample data

Use:

- `examples/rivers.geojson`
- `examples/stations.geojson`

## Current verification note

Verified locally:

- `vitest run packages/gis-core/src packages/ol-runtime/src`
- `tsc -p packages/gis-core/tsconfig.json`
- `tsc -p packages/ol-runtime/tsconfig.json`
- `vue-tsc --noEmit`
- `vite build`
- Vite dev server responds with HTTP 200 at `http://127.0.0.1:5173/`

Pending external verification:

- `cargo check` for the Tauri shell could not complete because crates.io and the tested sparse mirrors failed at HTTPS/TLS connection time while downloading the Rust registry config. The project includes `.cargo/config.toml` with Cargo mirror and Windows TLS compatibility settings, but Rust desktop compilation still needs a working Cargo registry connection.

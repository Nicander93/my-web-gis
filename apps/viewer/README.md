# Viewer scene documents

The read-only Viewer loads canonical SceneDocument v3, legacy SceneManifest v1/v2 and standalone CityScene v1/v2 through the shared schema migration. It uses `OlDocumentRuntime` for maps and `createCesiumDocumentRuntime` for native city content. There is no Desktop or React dependency.

After workspace dependencies and package builds are available:

```sh
pnpm --filter @desktop-webgis/viewer dev
pnpm --filter @desktop-webgis/viewer exec tsc --noEmit
pnpm --filter @desktop-webgis/viewer build
```

Open `/?scene=./examples/v3/scene.json` for the supplied v3 point/Popup example. `scene` is resolved against the Viewer page; declared resource URLs are resolved against the final HTTP scene response URL, including redirects. Nested model/tileset references remain engine-managed and are not a downloadable resource bundle.

Canonical files open their declared active view. `mode=2d` or `mode=3d` selects an engine, preferring the active view when it matches. Old mixed manifests retain their former default 3D opening behavior. Native city views offer a link to 2D when a map view exists.

Map layer/group visibility, legend, widgets, theme and safe text/HTTP Popup fields remain available. Provider secrets come from optional `runtime-config.json` rather than the scene. Runtime-authenticated WMS/WMTS and GeoJSON need a transport adapter and are explicitly rejected by the v3 factory. WFS displays its saved cache. Unsupported engine objects remain in the document and are reported in the status area; required unknown extensions block loading.

Selectable map nodes use the shared `ol-selection` package in click-only mode, keeping drag-to-pan available. Accepted selection honors typed IDs, filters, visibility and locks. Visibility changes clear disallowed highlights. Selection is local view state; it does not change saved content or edit history. Page exit disposes the selection controller and owned runtime. Direct native mutations and camera navigation are not exported as document edits.

Browser verification lives in `apps/desktop/e2e/viewer-document.e2e.ts` with the separate `playwright.viewer.config.ts`. It exercises real OL/Cesium browser rendering at 1024×680, 1440×900 and 1920×1080. It is not Windows native/DPI or hardware GPU acceptance. Full publication packaging, resource archives, broader capability parity and public tarball engine consumers remain implementation-plan work.

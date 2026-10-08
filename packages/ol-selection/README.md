# @desktop-webgis/ol-selection

Controlled OpenLayers click and rectangular selection without React, Store, project types or edit-history dependencies. This is a private release candidate; it has not been published. The peer range is provisional until the independent version matrix is verified.

```ts
import { createSelectionController } from '@desktop-webgis/ol-selection'

const selection = createSelectionController({
  map,
  targets: [{ layerKey: 'parcels', layer: parcels }],
  onSelectionRequest(request) {
    // Apply host permission/filter rules here before accepting the proposed state.
    selection.setSelection(request.selection)
  }
})
selection.setActive(true)
// On unmount:
selection.dispose()
```

Use stable feature IDs (string or number). A reference is `{ layerKey, featureId }`; numeric and string IDs remain distinct. There is no array-index fallback. `getFeatureId` can provide a domain ID. Targets must have unique layer keys. Classic OL Features in vector layers are supported; RenderFeatures, clusters and vector tiles are outside the initial contract.

Plain click or primary-button drag replaces selection; Shift adds, Alt removes (Alt wins over Shift). Small movements retain click behavior. A completed drag produces one request, including zero hits; a request does not mutate accepted selection. `setSelection` is silent. `setTargets`, externally accepted selection changes, source changes, hiding a layer, Esc, blur or disabling the controller cancel an in-flight drag. Box intersections account for rotation, polygon holes and wrapped worlds. Only loaded source features participate; this package does not download all WFS features.

`setActive(false)` stops interactions and retains the accepted highlight. `setTargets` rebonds listeners; the host must update targets when replacing layer objects. `resolveSelectedFeature` optionally resolves accepted references outside the current interactive targets; the host must return only visible/allowed features and resynchronize when external layers change. The default resolver observes target sources.

The controller owns a temporary unmanaged highlight layer, DragBox interaction and its listeners. It does not mutate input feature styles or destroy the map, viewer, source or user layers. Dispose is idempotent. Runtime creation needs browser DOM; importing the package does not create DOM. A custom `style` and `hitTolerance` can be supplied. No CSS file or arbitrary HTML is injected.

`SelectionRequest` includes the proposed full collection, added/removed references, click/box source, operation and targetRevision. Requests are synchronous; async host acceptance must reject stale revisions. The package does not open tables, edit data, write credentials or implement Undo/Redo.

Box intersection honors the effective layer extent, including parent group clipping, by intersecting the actual drag quadrilateral with that extent before testing feature geometry. Wrapped features are tested against the clipping extent in map coordinates.

Current verification: pure set/geometry tests (including clipped rotated boxes, holes, multipart lines, collections and circles), Desktop mouse/keyboard integration at three window sizes, a framework-independent browser lifecycle fixture and external tarball JS/type consumption with OL 10.10.0. These do not yet prove the complete release gate: broader geometry/performance cases, browser group-clipping acceptance, native acceptance and the remaining implementation-plan checks still apply. `pnpm verify:consumer` builds, packs and installs into the OS temporary directory, outside the workspace.

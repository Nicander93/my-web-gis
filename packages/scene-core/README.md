# @desktop-webgis/scene-core

Framework-independent constructors, immutable updates and deterministic serialization for `SceneManifest` documents.

This package contains domain operations rather than a miscellaneous collection of OpenLayers wrappers.

`SceneController` owns one canonical v3 document. `addResource` / `addNode`, replacement, deletion, grouping, views, environment, visibility, locking, opacity and tileset transforms all update that same content. `addTileset` commits its resource and node together and supports explicit reuse of a matching resource. `getDocument()` returns a detached copy; `exportJson()` includes all API-created content.

`transaction(label, draft => { ... })` batches related changes into one validated commit and one notification. Preparation must finish before the synchronous transaction: asynchronous callbacks and nested controller writes are rejected. Invalid or thrown changes leave the document intact. Identical content produces no notification. `subscribe` provides isolated before/after documents for a host history adapter; observer errors are returned in `SceneCommitResult.observerErrors` after content commits. Observers cannot synchronously write another transaction.

The controller owns no Map, Viewer, selection, file IO or undo stack. Engine preparation, application Store/history binding, asynchronous import transactions and large-document performance remain separate implementation gates.

The root and `./scene` entry points depend only on the scene schema. Project-specific publishing conversion lives in Desktop's `features/scene/compile-project.ts`; it is not part of this package's public API. Internal callers previously importing `compileProjectToScene` from this package must use that application adapter instead.
# Resource references

`prepareSceneGeoJsonResources(document, { loadGeoJson, signal, resourceIds })`
prepares URL GeoJSON into complete inline data on a detached document. The host
supplies transport and response limits. Duplicate resource IDs load once;
validation failures and cancellation reject without exposing partial results.
`resourceIds` allows engine-specific preparation; omission prepares all URL
GeoJSON. This is content preparation, not fetching model/tileset dependencies.

`collectSceneResourceReferences(document)` lists declared resource URLs, WMTS
alternate URLs, basemap and terrain references with field paths. It does not
fetch resources or discover dependencies inside model or tileset files.

`resolveSceneResourceReferences(document, documentUrl)` returns a detached,
validated document with relative references resolved against an HTTP(S) scene
file URL. XYZ template braces are preserved. Inputs must satisfy the current
scene protocol, including its restrictions on local relative resource paths.
Local file directories require a host resource adapter; this function does not
convert private filesystem paths into public URLs.

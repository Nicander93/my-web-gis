# @desktop-webgis/scene-core

Framework-independent constructors, immutable updates and deterministic serialization for `SceneManifest` documents.

This package contains domain operations rather than a miscellaneous collection of OpenLayers wrappers.

`SceneController` owns one canonical v3 document. `addResource` / `addNode`, replacement, deletion, grouping, views, environment, visibility, locking, opacity and tileset transforms all update that same content. `addTileset` commits its resource and node together and supports explicit reuse of a matching resource. `getDocument()` returns a detached copy; `exportJson()` includes all API-created content.

`transaction(label, draft => { ... })` batches related changes into one validated commit and one notification. Preparation must finish before the synchronous transaction: asynchronous callbacks and nested controller writes are rejected. Invalid or thrown changes leave the document intact. Identical content produces no notification. `subscribe` provides isolated before/after documents for a host history adapter; observer errors are returned in `SceneCommitResult.observerErrors` after content commits. Observers cannot synchronously write another transaction.

The controller owns no Map, Viewer, selection, file IO or undo stack. Engine preparation, application Store/history binding, asynchronous import transactions and large-document performance remain separate implementation gates.

The root and `./scene` entry points depend only on the scene schema. Project-specific publishing conversion lives in Desktop's `features/scene/compile-project.ts`; it is not part of this package's public API. Internal callers previously importing `compileProjectToScene` from this package must use that application adapter instead.
# Resource references

`SceneController.prepareAndReplaceDocument(input, { prepare, signal, label })`
validates a detached candidate, awaits host preparation and commits once. New
loads, content writes, cancellation or disposal invalidate pending results even
if the loader ignores its signal. Failed preparation leaves current content and
observers untouched. Hosts still own native engine staging and rollback;
post-commit observers are not a native preparation transaction.

`mergeSceneDocuments(target, incoming)` returns a validated merged document and
incoming-to-result ID maps for nodes, resources, views and credential references.
The target identity and active view remain selected. Incoming display order is
appended; shared settings that disagree cause an atomic rejection. Opaque
extensions with ID collisions require a host extension merge adapter. This pure
operation does not modify a mounted engine, project store or undo history.

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
# Runtime projection binding

```ts
import { SceneController, bindSceneRuntime } from '@desktop-webgis/scene-core'

const controller = new SceneController(document)
const binding = bindSceneRuntime(controller, runtime)
const initial = await binding.settled()
controller.setNodeVisible('roads', false)
const updated = await binding.settled()
binding.dispose()
```

The target implements `updateDocument(document, signal)`. The binding projects initial content and subsequent controller commits, coalesces obsolete work before it starts, aborts older revisions and ignores their late success/error status. A target must prevent native publication after abort; binding status alone cannot undo a non-cooperative target's native side effects. `OlDocumentRuntime` satisfies this transport cancellation contract. A raw legacy Cesium `updateScene` is not an adapter for this interface.

`getState()` exposes requested/applied revisions and loading/ready/error/disposed status. `settled()` follows replacements even when an obsolete request never settles. Rendering failures keep committed controller content authoritative and report the last applied revision; they do not automatically undo user edits. `refresh()` retries the current document without changing content or history. Hosts own error UI and native staging/rollback when atomic imports are required.

Disposal cancels only the binding's signal and subscription. It does not destroy the controller, map or runtime. This API remains framework/engine-independent and can be imported and used without DOM.

# Host-owned content

`createHostedSceneController(host)` exposes the same declarative and convenience
APIs while reading content directly from an authoritative application host. It
does not keep another writable document. The host supplies `read()`, synchronous
atomic `commit(document, label)` and `subscribe(observer)` with complete
`{ label, before, after }` changes, including external commands and undo/redo.
Host validation and draft guards must run before publishing content. Host
commits own history; the controller publishes successful API commits once and
does not add a second undo stack.

Reads and exports reflect current host content. External edits invalidate
pending preparation, and a transaction rejects its draft if its callback changes
the host directly. Observer snapshots are isolated; external changes made during
notification are delivered after the current change. Disposing the controller
unsubscribes without disposing the host. `bindSceneRuntime` works with owned and
hosted controllers alike. Engine copies remain projections, and native edits
still need to be translated into host content commands.

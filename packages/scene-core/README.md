# @desktop-webgis/scene-core

Framework-independent constructors, immutable updates and deterministic serialization for `SceneManifest` documents.

This package contains domain operations rather than a miscellaneous collection of OpenLayers wrappers.

The root and `./scene` entry points depend only on the scene schema. Project-specific publishing conversion lives in Desktop's `features/scene/compile-project.ts`; it is not part of this package's public API. Internal callers previously importing `compileProjectToScene` from this package must use that application adapter instead.

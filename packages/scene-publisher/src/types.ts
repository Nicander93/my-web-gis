import type { SceneManifest } from '@desktop-webgis/scene-schema'

export interface BuildStaticSceneOptions {
  scene: SceneManifest
  viewerDirectory: string
  outputDirectory: string
  /** Maps relative URLs used by the scene to absolute or workspace-local source files. */
  resources?: Record<string, string>
  /** Optional runtime secrets. Only written when the caller explicitly supplies them. */
  runtimeCredentials?: Record<string, string>
  runtimeVersion?: string
  /** Optional deployment root used to record the final public Viewer URL. */
  publicBaseUrl?: string
}

export interface PublishedFile {
  path: string
  bytes: number
  sha256: string
}

export interface PublishManifest {
  artifactVersion: 1
  sceneId: string
  sceneVersion: number
  runtimeVersion: string
  builtAt: string
  publicUrl?: string
  files: PublishedFile[]
}

export interface BuildStaticSceneResult {
  outputDirectory: string
  manifest: PublishManifest
  warnings: string[]
}

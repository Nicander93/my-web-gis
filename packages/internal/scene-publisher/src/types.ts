import type { SceneManifest } from '@desktop-webgis/scene-schema'

export interface BuildStaticSceneOptions {
  scene: SceneManifest
  viewerDirectory: string
  outputDirectory: string
  /** 把场景里用到的相对 URL 映射到绝对路径或工作区内的源文件。 */
  resources?: Record<string, string>
  /** 可选的运行时密钥，只在调用方显式提供时才写入。 */
  runtimeCredentials?: Record<string, string>
  runtimeVersion?: string
  /** 可选的部署根地址，用来记录最终公开的 Viewer URL。 */
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

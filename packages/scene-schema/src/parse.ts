import { normalizeScene } from './normalize.js'
import { upgradeSceneManifest } from './migrate.js'
import type { SceneManifest, SceneManifestInput, ValidationIssue } from './types.js'
import { validateScene } from './validate.js'

export class SceneValidationError extends Error {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super(issues.map((entry) => `${entry.path}: ${entry.message}`).join('\n'))
    this.name = 'SceneValidationError'
    this.issues = issues
  }
}

function decodeInput(input: unknown): unknown {
  if (typeof input !== 'string') return input
  try {
    return JSON.parse(input) as unknown
  } catch (error) {
    throw new SceneValidationError([
      {
        path: '$',
        code: 'json.syntax',
        message: error instanceof Error ? `JSON 解析失败：${error.message}` : 'JSON 解析失败'
      }
    ])
  }
}

/** Parses, validates, migrates to version 2, and normalizes a SceneManifest. */
export function parseScene(input: unknown): SceneManifest {
  const decoded = decodeInput(input)
  const result = validateScene(decoded)
  if (!result.valid) throw new SceneValidationError(result.issues)
  return normalizeScene(upgradeSceneManifest(decoded as SceneManifestInput))
}

/**
 * Migration entry point.
 * Accepts version 1 or 2; always returns the canonical version 2 document.
 */
export function migrateScene(input: unknown): SceneManifest {
  return parseScene(input)
}
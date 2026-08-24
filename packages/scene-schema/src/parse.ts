import { normalizeScene } from './normalize.js'
import type { SceneManifest, ValidationIssue } from './types.js'
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

/** Parses, validates and normalizes a SceneManifest. */
export function parseScene(input: unknown): SceneManifest {
  const decoded = decodeInput(input)
  const result = validateScene(decoded)
  if (!result.valid) throw new SceneValidationError(result.issues)
  return normalizeScene(decoded as SceneManifest)
}

/** Migration entry point. It currently accepts v1 and rejects all unsupported versions. */
export function migrateScene(input: unknown): SceneManifest {
  return parseScene(input)
}

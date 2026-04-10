import path from 'path'

export class PathTraversalError extends Error {
  constructor(message: string, public attemptedPath: string, public baseDir: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

/**
 * Validates that targetPath resolves within baseDir.
 * Throws PathTraversalError if outside, UNC, or contains traversal sequences.
 * Returns the resolved absolute path on success.
 */
export function validatePathInBase(targetPath: string, baseDir: string): string {
  // Check UNC paths first — path.resolve on a UNC path behaves unexpectedly on Windows
  if (targetPath.startsWith('\\\\') || targetPath.startsWith('//')) {
    throw new PathTraversalError(
      `Network paths not allowed: "${targetPath}"`,
      targetPath, baseDir
    )
  }

  const resolvedBase   = path.resolve(baseDir)
  const resolvedTarget = path.resolve(targetPath)

  // Target must be inside base (startsWith base + sep, or equal to base)
  if (resolvedTarget !== resolvedBase &&
      !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new PathTraversalError(
      `Path outside allowed directory: "${targetPath}" is not inside "${baseDir}"`,
      targetPath, baseDir
    )
  }

  return resolvedTarget
}

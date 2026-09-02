import { chmodSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const APP_DIR_NAME = '.lpgp'

/** Owner-only permissions: the config dir holds private keys and passphrases. */
export const PRIVATE_DIR_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600

/**
 * Restrict a path to owner-only access. Silently ignored on platforms or
 * filesystems that do not support POSIX modes (e.g. Windows).
 */
export function ensurePrivate(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch {
    // Best effort; permissions are not enforceable everywhere
  }
}

/**
 * Get the application config directory path.
 * Creates the directory if it doesn't exist.
 *
 * - Unix-like (macOS, Linux): ~/.lpgp
 * - Windows: C:\Users\<username>\.lpgp
 */
export function getConfigDir(): string {
  const configDir = join(homedir(), APP_DIR_NAME)

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: PRIVATE_DIR_MODE })
  }
  ensurePrivate(configDir, PRIVATE_DIR_MODE)

  return configDir
}

/**
 * Get the database file path.
 */
export function getDbPath(): string {
  return join(getConfigDir(), 'data.db')
}

/**
 * Get the path to a file within the config directory.
 */
export function getConfigPath(filename: string): string {
  return join(getConfigDir(), filename)
}

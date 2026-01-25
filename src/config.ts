import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const APP_DIR_NAME = '.lpgp'

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
    mkdirSync(configDir, { recursive: true })
  }

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

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface SystemKey {
  fingerprint: string
  uid: string
  email: string
  name: string
  keyId: string
  type: 'public' | 'secret'
}

/**
 * Check if GPG is installed on the system
 */
export function isGpgInstalled(): boolean {
  try {
    execSync('gpg --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * List all GPG keys from the system keyring
 */
export function listGpgKeys(): { publicKeys: SystemKey[]; secretKeys: SystemKey[] } {
  const publicKeys: SystemKey[] = []
  const secretKeys: SystemKey[] = []

  try {
    // List public keys
    const publicOutput = execSync('gpg --list-keys --with-colons', { encoding: 'utf-8' })
    publicKeys.push(...parseGpgOutput(publicOutput, 'public'))

    // List secret keys
    const secretOutput = execSync('gpg --list-secret-keys --with-colons', { encoding: 'utf-8' })
    secretKeys.push(...parseGpgOutput(secretOutput, 'secret'))
  } catch (error) {
    // GPG might not be installed or have no keys
  }

  return { publicKeys, secretKeys }
}

/**
 * Parse GPG --list-keys output
 */
function parseGpgOutput(output: string, type: 'public' | 'secret'): SystemKey[] {
  const keys: SystemKey[] = []
  const lines = output.split('\n')

  let currentKey: Partial<SystemKey> | null = null

  for (const line of lines) {
    const fields = line.split(':')
    const recordType = fields[0]

    if (recordType === 'pub' || recordType === 'sec') {
      // New key
      if (currentKey && currentKey.fingerprint) {
        keys.push(currentKey as SystemKey)
      }

      currentKey = {
        type,
        keyId: fields[4] || '',
      }
    } else if (recordType === 'fpr' && currentKey) {
      // Fingerprint
      currentKey.fingerprint = fields[9] || ''
    } else if (recordType === 'uid' && currentKey) {
      // User ID (name and email)
      const uid = fields[9] || ''
      currentKey.uid = uid

      // Parse email from uid (format: "Name <email@example.com>")
      const emailMatch = uid.match(/<([^>]+)>/)
      if (emailMatch && emailMatch[1]) {
        currentKey.email = emailMatch[1]
      } else {
        currentKey.email = ''
      }

      // Parse name from uid
      const nameMatch = uid.match(/^([^<]+)/)
      if (nameMatch && nameMatch[1]) {
        currentKey.name = nameMatch[1].trim()
      } else {
        currentKey.name = uid
      }
    }
  }

  // Add the last key
  if (currentKey && currentKey.fingerprint) {
    keys.push(currentKey as SystemKey)
  }

  return keys
}

/**
 * Export a GPG key by fingerprint or key ID
 */
export function exportGpgPublicKey(keyId: string): string | null {
  try {
    const output = execSync(`gpg --armor --export ${keyId}`, { encoding: 'utf-8' })
    return output.trim()
  } catch (error) {
    return null
  }
}

/**
 * Export a GPG secret key by fingerprint or key ID
 */
export function exportGpgSecretKey(keyId: string): string | null {
  try {
    const output = execSync(`gpg --armor --export-secret-keys ${keyId}`, { encoding: 'utf-8' })
    return output.trim()
  } catch (error) {
    return null
  }
}

/**
 * Check if a GPG home directory exists
 */
export function getGpgHomeDir(): string | null {
  const homeDir = os.homedir()
  const gpgDir = path.join(homeDir, '.gnupg')

  if (fs.existsSync(gpgDir)) {
    return gpgDir
  }

  return null
}

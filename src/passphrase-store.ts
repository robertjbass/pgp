import {
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
} from 'fs'
import { homedir, hostname, userInfo } from 'os'
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'crypto'
import { getConfigPath } from './config.js'

const CACHE_FILE = getConfigPath('.cache')
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12
const SALT_LENGTH = 16
const TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100_000

type CacheData = Record<string, string>

function deriveKey(salt: Buffer): Buffer {
  const machineSecret = [hostname(), userInfo().username, homedir(), 'lpgp'].join(
    '|',
  )
  return pbkdf2Sync(machineSecret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

function encryptCache(data: CacheData): Buffer {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(salt)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const plaintext = Buffer.from(JSON.stringify(data), 'utf-8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([salt, iv, tag, ciphertext])
}

function decryptCache(blob: Buffer): CacheData {
  const salt = blob.subarray(0, SALT_LENGTH)
  const iv = blob.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const tag = blob.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
  )
  const ciphertext = blob.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)

  const key = deriveKey(salt)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return JSON.parse(plaintext.toString('utf-8')) as CacheData
}

function readCache(): CacheData {
  if (!existsSync(CACHE_FILE)) return {}
  try {
    const blob = readFileSync(CACHE_FILE)
    return decryptCache(blob)
  } catch {
    return {}
  }
}

function writeCache(data: CacheData): void {
  const blob = encryptCache(data)
  writeFileSync(CACHE_FILE, blob)
  try {
    chmodSync(CACHE_FILE, 0o600)
  } catch {
    // Permissions may not be settable on Windows
  }
}

export function getCachedPassphrase(fingerprint: string): string | null {
  const cache = readCache()
  return cache[fingerprint] ?? null
}

export function cachePassphrase(fingerprint: string, passphrase: string): void {
  const cache = readCache()
  cache[fingerprint] = passphrase
  writeCache(cache)
}

export function removeCachedPassphrase(fingerprint: string): void {
  const cache = readCache()
  if (fingerprint in cache) {
    delete cache[fingerprint]
    writeCache(cache)
  }
}

export function hasCachedPassphrase(fingerprint: string): boolean {
  return getCachedPassphrase(fingerprint) !== null
}

export function clearAllCachedPassphrases(): void {
  try {
    if (existsSync(CACHE_FILE)) unlinkSync(CACHE_FILE)
  } catch {
    // Ignore
  }
}

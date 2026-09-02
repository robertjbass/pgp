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
import { getConfigPath, ensurePrivate, PRIVATE_FILE_MODE } from './config.js'

const CACHE_FILE = getConfigPath('.cache')
const SECRET_FILE = getConfigPath('.cache-key')
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12
const SALT_LENGTH = 16
const TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100_000

type CacheData = Record<string, string>

/**
 * The cache is encrypted with a key derived from a random secret stored next
 * to it (owner-only). This does not protect against someone who can read the
 * whole directory, but it stops the cache from being trivially decodable and,
 * unlike the previous hostname-based derivation, survives network/hostname
 * changes.
 */
function loadOrCreateSecret(): Buffer {
  if (existsSync(SECRET_FILE)) {
    try {
      const secret = readFileSync(SECRET_FILE)
      if (secret.length >= KEY_LENGTH) return secret
    } catch {
      // fall through and recreate
    }
  }
  const secret = randomBytes(KEY_LENGTH)
  writeFileSync(SECRET_FILE, secret, { mode: PRIVATE_FILE_MODE })
  ensurePrivate(SECRET_FILE, PRIVATE_FILE_MODE)
  return secret
}

function deriveKey(salt: Buffer, secret: Buffer | string): Buffer {
  return pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

/** Key derivation used by caches written before the random secret existed. */
function legacyMachineSecret(): string {
  return [hostname(), userInfo().username, homedir(), 'lpgp'].join('|')
}

function encryptCache(data: CacheData): Buffer {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(salt, loadOrCreateSecret())

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const plaintext = Buffer.from(JSON.stringify(data), 'utf-8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([salt, iv, tag, ciphertext])
}

function decryptCache(blob: Buffer, secret: Buffer | string): CacheData {
  const salt = blob.subarray(0, SALT_LENGTH)
  const iv = blob.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const tag = blob.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
  )
  const ciphertext = blob.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)

  const key = deriveKey(salt, secret)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return JSON.parse(plaintext.toString('utf-8')) as CacheData
}

/**
 * Read the cache. Returns null (not `{}`) when a cache file exists but cannot
 * be decrypted, so writers do not silently overwrite entries they cannot see.
 */
function readCache(): CacheData | null {
  if (!existsSync(CACHE_FILE)) return {}
  let blob: Buffer
  try {
    blob = readFileSync(CACHE_FILE)
  } catch {
    return null
  }
  try {
    return decryptCache(blob, loadOrCreateSecret())
  } catch {
    // Not written with the current secret; try the pre-secret derivation and
    // migrate on success.
    try {
      const data = decryptCache(blob, legacyMachineSecret())
      writeCache(data)
      return data
    } catch {
      return null
    }
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
  return cache?.[fingerprint] ?? null
}

export function cachePassphrase(fingerprint: string, passphrase: string): void {
  const cache = readCache()
  if (cache === null) {
    // Unreadable cache: keep the file for forensics, start a fresh one.
    console.error(
      'Warning: the passphrase cache could not be read and was replaced. Other cached passphrases will be asked for again.'
    )
  }
  const next = cache ?? {}
  next[fingerprint] = passphrase
  writeCache(next)
}

export function removeCachedPassphrase(fingerprint: string): void {
  const cache = readCache()
  if (cache && fingerprint in cache) {
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

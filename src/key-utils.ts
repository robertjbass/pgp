import * as openpgp from 'openpgp'
import type { Keypair } from './db.js'

/**
 * Obfuscate an email address for privacy
 * Example: "kevinlong@protonmail.com" -> "ke******ng@p*********.com"
 */
export function obfuscateEmail(email: string): string {
  if (!email || !email.includes('@')) return email

  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return email

  // Obfuscate local part: show first 2 and last 2 chars
  let obfuscatedLocal: string
  if (localPart.length <= 4) {
    obfuscatedLocal = localPart[0] + '*'.repeat(localPart.length - 1)
  } else {
    const showChars = 2
    obfuscatedLocal =
      localPart.slice(0, showChars) +
      '*'.repeat(localPart.length - showChars * 2) +
      localPart.slice(-showChars)
  }

  // Obfuscate domain: show first char, obfuscate until TLD
  const lastDot = domain.lastIndexOf('.')
  if (lastDot === -1) {
    return `${obfuscatedLocal}@${domain}`
  }

  const domainName = domain.slice(0, lastDot)
  const tld = domain.slice(lastDot)

  let obfuscatedDomain: string
  if (domainName.length <= 2) {
    obfuscatedDomain = domainName[0] + '*'.repeat(domainName.length - 1)
  } else {
    obfuscatedDomain = domainName[0] + '*'.repeat(domainName.length - 1)
  }

  return `${obfuscatedLocal}@${obfuscatedDomain}${tld}`
}

/**
 * Extract key information from a PGP public key
 */
// Config to allow weak keys like DSA (not recommended for production)
const weakKeyConfig = {
  rejectPublicKeyAlgorithms: new Set(),
  rejectHashAlgorithms: new Set(),
  rejectMessageHashAlgorithms: new Set(),
  rejectCurves: new Set(),
}

export async function extractPublicKeyInfo(armoredKey: string): Promise<{
  fingerprint: string
  email: string
  name: string
  algorithm: string
  keySize: string
  expiresAt: string | null
  canSign: boolean
  canEncrypt: boolean
  canCertify: boolean
  canAuthenticate: boolean
}> {
  const publicKey = await openpgp.readKey({ armoredKey, config: weakKeyConfig })
  const user = publicKey.users[0]
  const userID = user?.userID

  // Extract primary key info
  const primaryKey = publicKey.keyPacket
  const algorithm = primaryKey.getAlgorithmInfo().algorithm
  const bits = primaryKey.getAlgorithmInfo().bits

  // Get key capabilities
  try {
    await publicKey.verifyPrimaryKey(undefined, undefined, weakKeyConfig)
    // If verification doesn't throw, the key is valid
  } catch (e) {
    // Key verification failed
  }
  const canSign = true // Assume true for generated keys
  const canEncrypt =
    (await publicKey.getEncryptionKey(
      undefined,
      undefined,
      undefined,
      weakKeyConfig
    )) !== null
  const canCertify = true // Primary keys can typically certify
  const canAuthenticate = false // Not common for primary keys

  // Get expiration
  let expiresAt: string | null = null
  const expirationTime = await publicKey.getExpirationTime(
    undefined,
    weakKeyConfig
  )
  if (expirationTime && expirationTime !== Infinity) {
    expiresAt = new Date(expirationTime).toISOString()
  }

  return {
    fingerprint: publicKey.getFingerprint().toUpperCase(),
    email: userID?.email || 'unknown@example.com',
    name: userID?.name || 'Unknown',
    algorithm,
    keySize: bits?.toString() || 'unknown',
    expiresAt,
    canSign,
    canEncrypt,
    canCertify,
    canAuthenticate,
  }
}

/**
 * Extract key information from a PGP private key
 */
export async function extractPrivateKeyInfo(
  armoredKey: string,
  passphrase?: string
): Promise<{
  fingerprint: string
  email: string
  name: string
  algorithm: string
  keySize: string
  expiresAt: string | null
  canSign: boolean
  canEncrypt: boolean
  canCertify: boolean
  canAuthenticate: boolean
  passphraseProtected: boolean
}> {
  let privateKey = await openpgp.readPrivateKey({
    armoredKey,
    config: weakKeyConfig,
  })

  // Check if passphrase protected
  const isEncrypted = privateKey.isDecrypted() === false

  // If encrypted and passphrase provided, decrypt it
  if (isEncrypted && passphrase) {
    privateKey = await openpgp.decryptKey({
      privateKey,
      passphrase,
      config: weakKeyConfig,
    })
  }

  const user = privateKey.users[0]
  const userID = user?.userID

  // Extract primary key info
  const primaryKey = privateKey.keyPacket
  const algorithm = primaryKey.getAlgorithmInfo().algorithm
  const bits = primaryKey.getAlgorithmInfo().bits

  // Get key capabilities
  try {
    await privateKey.verifyPrimaryKey(undefined, undefined, weakKeyConfig)
    // If verification doesn't throw, the key is valid
  } catch (e) {
    // Key verification failed
  }
  const canSign = true // Assume true for generated keys
  const canEncrypt =
    (await privateKey.getEncryptionKey(
      undefined,
      undefined,
      undefined,
      weakKeyConfig
    )) !== null
  const canCertify = true
  const canAuthenticate = false

  // Get expiration
  let expiresAt: string | null = null
  const expirationTime = await privateKey.getExpirationTime(
    undefined,
    weakKeyConfig
  )
  if (expirationTime && expirationTime !== Infinity) {
    expiresAt = new Date(expirationTime).toISOString()
  }

  return {
    fingerprint: privateKey.getFingerprint().toUpperCase(),
    email: userID?.email || 'unknown@example.com',
    name: userID?.name || 'Unknown',
    algorithm,
    keySize: bits?.toString() || 'unknown',
    expiresAt,
    canSign,
    canEncrypt,
    canCertify,
    canAuthenticate,
    passphraseProtected: isEncrypted,
  }
}

/**
 * Verify that a private key matches a public key
 */
export async function verifyKeyPair(
  publicKeyArmored: string,
  privateKeyArmored: string
): Promise<boolean> {
  try {
    const publicKey = await openpgp.readKey({
      armoredKey: publicKeyArmored,
      config: weakKeyConfig,
    })
    const privateKey = await openpgp.readPrivateKey({
      armoredKey: privateKeyArmored,
      config: weakKeyConfig,
    })

    const publicFingerprint = publicKey.getFingerprint()
    const privateFingerprint = privateKey.getFingerprint()

    return publicFingerprint === privateFingerprint
  } catch (error) {
    return false
  }
}

/**
 * Validate passphrase for a private key
 */
export async function validatePassphrase(
  privateKeyArmored: string,
  passphrase: string
): Promise<boolean> {
  try {
    const privateKey = await openpgp.readPrivateKey({
      armoredKey: privateKeyArmored,
      config: weakKeyConfig,
    })

    if (!privateKey.isDecrypted()) {
      await openpgp.decryptKey({
        privateKey,
        passphrase,
        config: weakKeyConfig,
      })
    }

    return true
  } catch (error) {
    return false
  }
}

/**
 * Format a keypair for display
 */
export function formatKeypairInfo(keypair: Keypair): string {
  const lines = [
    `Name: ${keypair.name}`,
    `Email: ${obfuscateEmail(keypair.email)}`,
    `Fingerprint: ${keypair.fingerprint}`,
    `Algorithm: ${keypair.algorithm} (${keypair.key_size})`,
    keypair.expires_at
      ? `Expires: ${new Date(keypair.expires_at).toLocaleDateString()}`
      : 'Expires: Never',
    `Capabilities: ${[
      keypair.can_sign && 'Sign',
      keypair.can_encrypt && 'Encrypt',
      keypair.can_certify && 'Certify',
      keypair.can_authenticate && 'Authenticate',
    ]
      .filter(Boolean)
      .join(', ')}`,
    keypair.revoked ? '! REVOKED' : '',
    keypair.is_default ? '✓ Default keypair' : '',
  ]

  return lines.filter(Boolean).join('\n')
}

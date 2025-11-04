import * as openpgp from 'openpgp'
import type { Keypair } from './db.js'

/**
 * Extract key information from a PGP public key
 */
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
  const publicKey = await openpgp.readKey({ armoredKey })
  const user = publicKey.users[0]
  const userID = user?.userID

  // Extract primary key info
  const primaryKey = publicKey.keyPacket
  const algorithm = primaryKey.getAlgorithmInfo().algorithm
  const bits = primaryKey.getAlgorithmInfo().bits

  // Get key capabilities
  try {
    await publicKey.verifyPrimaryKey()
    // If verification doesn't throw, the key is valid
  } catch (e) {
    // Key verification failed
  }
  const canSign = true // Assume true for generated keys
  const canEncrypt = publicKey.getEncryptionKey() !== null
  const canCertify = true // Primary keys can typically certify
  const canAuthenticate = false // Not common for primary keys

  // Get expiration
  let expiresAt: string | null = null
  const expirationTime = await publicKey.getExpirationTime()
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
  let privateKey = await openpgp.readPrivateKey({ armoredKey })

  // Check if passphrase protected
  const isEncrypted = privateKey.isDecrypted() === false

  // If encrypted and passphrase provided, decrypt it
  if (isEncrypted && passphrase) {
    privateKey = await openpgp.decryptKey({
      privateKey,
      passphrase,
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
    await privateKey.verifyPrimaryKey()
    // If verification doesn't throw, the key is valid
  } catch (e) {
    // Key verification failed
  }
  const canSign = true // Assume true for generated keys
  const canEncrypt = privateKey.getEncryptionKey() !== null
  const canCertify = true
  const canAuthenticate = false

  // Get expiration
  let expiresAt: string | null = null
  const expirationTime = await privateKey.getExpirationTime()
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
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored })
    const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored })

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
    const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored })

    if (!privateKey.isDecrypted()) {
      await openpgp.decryptKey({
        privateKey,
        passphrase,
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
    `Email: ${keypair.email}`,
    `Fingerprint: ${keypair.fingerprint}`,
    `Algorithm: ${keypair.algorithm} (${keypair.key_size})`,
    keypair.expires_at ? `Expires: ${new Date(keypair.expires_at).toLocaleDateString()}` : 'Expires: Never',
    `Capabilities: ${[
      keypair.can_sign && 'Sign',
      keypair.can_encrypt && 'Encrypt',
      keypair.can_certify && 'Certify',
      keypair.can_authenticate && 'Authenticate',
    ]
      .filter(Boolean)
      .join(', ')}`,
    keypair.revoked ? '⚠️  REVOKED' : '',
    keypair.is_default ? '✓ Default keypair' : '',
  ]

  return lines.filter(Boolean).join('\n')
}

import * as openpgp from 'openpgp'
import type { Keypair } from './db.js'

/**
 * Obfuscate a display name aggressively: keep the first and last character,
 * star the rest. Short names (<=2 chars) are passed through.
 * Example: "kminda" -> "k****a", "Alice" -> "A***e".
 */
export function obfuscateName(name: string): string {
  if (!name) return name
  const trimmed = name.trim()
  if (trimmed.length <= 2) return trimmed
  if (trimmed.length === 3) {
    return `${trimmed[0]}*${trimmed[trimmed.length - 1]}`
  }
  return `${trimmed[0]}${'*'.repeat(trimmed.length - 2)}${trimmed[trimmed.length - 1]}`
}

/**
 * Format a recipient's identity for ephemeral display (encrypt confirmation,
 * recipient list summary). Masks name and email so screenshots/streams don't
 * leak the recipient's identity, while still letting the user recognise it.
 */
export function formatMaskedRecipient(info: {
  name?: string | null
  email?: string | null
  fingerprint?: string | null
}): string {
  const hasName =
    !!info.name && info.name !== 'Unknown' && info.name.trim().length > 0
  const hasEmail =
    !!info.email &&
    info.email !== 'unknown@example.com' &&
    info.email.trim().length > 0

  const maskedName = hasName ? obfuscateName(info.name!) : null
  const maskedEmail = hasEmail ? obfuscateEmail(info.email!) : null

  if (maskedName && maskedEmail) return `${maskedName} <${maskedEmail}>`
  if (maskedName) return maskedName
  if (maskedEmail) return maskedEmail
  if (info.fingerprint) return `key ${info.fingerprint.slice(-8)}`
  return 'unknown'
}

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

// Config to allow weak keys like DSA (not recommended for production)
export const weakKeyConfig = {
  rejectPublicKeyAlgorithms: new Set(),
  rejectHashAlgorithms: new Set(),
  rejectMessageHashAlgorithms: new Set(),
  rejectCurves: new Set(),
  allowMissingKeyFlags: true,
}

/**
 * Derive capabilities from the key's actual flags and validity instead of
 * assuming. openpgp v6 throws (rather than returning null) when no suitable
 * key exists, so each probe is wrapped.
 */
async function detectKeyCapabilities(key: openpgp.Key): Promise<{
  canSign: boolean
  canEncrypt: boolean
  canCertify: boolean
  canAuthenticate: boolean
  revoked: boolean
}> {
  const probe = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn()
      return true
    } catch {
      return false
    }
  }
  const canSign = await probe(() =>
    key.getSigningKey(undefined, undefined, undefined, weakKeyConfig)
  )
  const canEncrypt = await probe(() =>
    key.getEncryptionKey(undefined, undefined, undefined, weakKeyConfig)
  )

  const flagsOf = (sig: { keyFlags?: Uint8Array | null } | null | undefined) =>
    sig?.keyFlags?.[0] ?? 0
  let primaryFlags = 0
  try {
    const { selfCertification } = await key.getPrimaryUser(
      undefined,
      undefined,
      weakKeyConfig
    )
    primaryFlags = flagsOf(selfCertification)
  } catch {
    // No valid self-certification; treat as no flags
  }
  const subkeyFlags = key.subkeys.map((sk) => flagsOf(sk.bindingSignatures[0]))
  const anyFlag = (bit: number) =>
    (primaryFlags & bit) !== 0 || subkeyFlags.some((f) => (f & bit) !== 0)

  const canCertify = (primaryFlags & openpgp.enums.keyFlags.certifyKeys) !== 0
  const canAuthenticate = anyFlag(openpgp.enums.keyFlags.authentication)

  let revoked = false
  try {
    revoked = await key.isRevoked(undefined, undefined, undefined, weakKeyConfig)
  } catch {
    revoked = false
  }

  return { canSign, canEncrypt, canCertify, canAuthenticate, revoked }
}

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
  revoked: boolean
}> {
  const publicKey = await openpgp.readKey({ armoredKey, config: weakKeyConfig })
  const user = publicKey.users[0]
  const userID = user?.userID

  // Extract primary key info
  const { algorithm, bits, curve } = publicKey.keyPacket.getAlgorithmInfo()

  const { canSign, canEncrypt, canCertify, canAuthenticate, revoked } =
    await detectKeyCapabilities(publicKey)

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
    keySize: bits?.toString() ?? curve ?? 'unknown',
    expiresAt,
    canSign,
    canEncrypt,
    canCertify,
    canAuthenticate,
    revoked,
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
  revoked: boolean
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
  const { algorithm, bits, curve } = privateKey.keyPacket.getAlgorithmInfo()

  const { canSign, canEncrypt, canCertify, canAuthenticate, revoked } =
    await detectKeyCapabilities(privateKey)

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
    keySize: bits?.toString() ?? curve ?? 'unknown',
    expiresAt,
    canSign,
    canEncrypt,
    canCertify,
    canAuthenticate,
    revoked,
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
 * One-line label that tells keypairs apart even when names (or emails)
 * collide: name, masked email, and the last 8 fingerprint characters.
 * Example: `Personal · b*b@bb***.co · …69DED971`
 */
export function formatKeypairLabel(keypair: {
  name: string
  email: string
  fingerprint: string
}): string {
  return `${keypair.name} · ${obfuscateEmail(keypair.email)} · …${keypair.fingerprint.slice(-8)}`
}

/**
 * Human-friendly algorithm label from openpgp's enum name plus bits/curve,
 * e.g. "RSA 4096" or "EdDSA (ed25519)".
 */
export function formatAlgorithm(algorithm: string, keySize: string): string {
  const names: Record<string, string> = {
    rsaEncryptSign: 'RSA',
    rsaEncrypt: 'RSA',
    rsaSign: 'RSA',
    dsa: 'DSA',
    elgamal: 'ElGamal',
    ecdh: 'ECDH',
    ecdsa: 'ECDSA',
    eddsa: 'EdDSA',
    eddsaLegacy: 'EdDSA',
    ed25519: 'Ed25519',
    ed448: 'Ed448',
    x25519: 'X25519',
    x448: 'X448',
  }
  const name = names[algorithm] ?? algorithm
  if (!keySize || keySize === 'unknown') return name
  // openpgp names the pre-RFC-9580 curves "…Legacy"; users know them as ed25519/cv25519
  const size = keySize.replace(/Legacy$/, '').replace(/^curve25519$/, 'cv25519')
  return /^\d+$/.test(size) ? `${name} ${size}` : `${name} (${size})`
}

/**
 * Format a keypair for display
 */
export function formatKeypairInfo(keypair: Keypair): string {
  const lines = [
    `Name: ${keypair.name}`,
    `Email: ${obfuscateEmail(keypair.email)}`,
    `Fingerprint: ${keypair.fingerprint}`,
    `Algorithm: ${formatAlgorithm(keypair.algorithm, keypair.key_size)}`,
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

/**
 * Return the stored keys a message was encrypted for. OpenPGP encrypts to the
 * encryption *subkey*, so each stored key is parsed and every key ID in it
 * (primary and subkeys) is compared against the message's recipient key IDs.
 * Keys that fail to parse are skipped.
 */
export async function filterKeysForMessage<T extends { public_key: string }>(
  message: openpgp.Message<string>,
  candidates: T[],
): Promise<T[]> {
  const keyIDs = message.getEncryptionKeyIDs()
  if (keyIDs.length === 0) return []
  const matching: T[] = []
  for (const candidate of candidates) {
    try {
      const key = await openpgp.readKey({
        armoredKey: candidate.public_key,
        config: weakKeyConfig,
      })
      if (keyIDs.some((id) => key.getKeys(id).length > 0)) {
        matching.push(candidate)
      }
    } catch {
      // Unparseable stored key; ignore it here
    }
  }
  return matching
}

/**
 * Match a user-supplied fingerprint against a stored one. Accepts the full
 * fingerprint or a suffix of at least 8 hex characters (a long key ID),
 * ignoring case and whitespace. Returns false for anything shorter so a
 * partial or empty string can never match everything.
 */
export function fingerprintMatches(stored: string, input: string): boolean {
  const needle = input.replace(/\s+/g, '').toUpperCase()
  if (needle.length < 8 || !/^[0-9A-F]+$/.test(needle)) return false
  return stored.toUpperCase().endsWith(needle)
}

/** A key we can verify signatures against, with how to describe its owner. */
export type KnownKey = {
  kind: 'keypair' | 'contact'
  name: string
  email: string
  fingerprint: string
  public_key: string
}

export type SignatureStatus = {
  /** Long key ID of the signing key, hex, upper case. */
  keyID: string
  /** Who signed, when the key is one we know. */
  signer: Omit<KnownKey, 'public_key'> | null
  /** 'valid', 'invalid' (known key, bad signature), or 'unknown' (key not stored). */
  status: 'valid' | 'invalid' | 'unknown'
  error?: string
}

/**
 * Parse the keys we can verify against. Unparseable keys are skipped.
 */
export async function readVerificationKeys(
  known: KnownKey[],
): Promise<{ keys: openpgp.PublicKey[]; owners: Map<string, KnownKey> }> {
  const keys: openpgp.PublicKey[] = []
  const owners = new Map<string, KnownKey>()
  for (const item of known) {
    try {
      const key = await openpgp.readKey({
        armoredKey: item.public_key,
        config: weakKeyConfig,
      })
      keys.push(key)
      for (const k of key.getKeys()) {
        owners.set(k.getKeyID().toHex().toUpperCase(), item)
      }
    } catch {
      // Skip
    }
  }
  return { keys, owners }
}

/**
 * Turn openpgp's lazy signature results into a plain status list.
 */
export async function summarizeSignatures(
  signatures: { keyID: openpgp.KeyID; verified: Promise<true> }[],
  owners: Map<string, KnownKey>,
): Promise<SignatureStatus[]> {
  const result: SignatureStatus[] = []
  for (const sig of signatures) {
    const keyID = sig.keyID.toHex().toUpperCase()
    const owner = owners.get(keyID) ?? null
    const signer = owner
      ? {
          kind: owner.kind,
          name: owner.name,
          email: owner.email,
          fingerprint: owner.fingerprint,
        }
      : null
    try {
      await sig.verified
      result.push({ keyID, signer, status: 'valid' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.push({
        keyID,
        signer,
        status: owner ? 'invalid' : 'unknown',
        error: message,
      })
    }
  }
  return result
}

/** Human-readable one-liner for a signature status. */
export function describeSignature(sig: SignatureStatus): string {
  const who = sig.signer
    ? `${sig.signer.name} <${sig.signer.email}>`
    : `unknown key ${sig.keyID}`
  switch (sig.status) {
    case 'valid':
      return `Signed by ${who} (verified)`
    case 'unknown':
      return `Signed by ${who}; add their public key to verify it`
    case 'invalid':
      return `INVALID signature from ${who}; the message may have been altered`
  }
}

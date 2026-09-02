import * as openpgp from 'openpgp'
import { readFileSync, writeFileSync } from 'fs'
import { Db, type Keypair } from './db.js'
import {
  extractPublicKeyInfo,
  filterKeysForMessage,
  fingerprintMatches,
  readVerificationKeys,
  summarizeSignatures,
  describeSignature,
  formatAlgorithm,
  weakKeyConfig,
  type KnownKey,
  type SignatureStatus,
} from './key-utils.js'
import { getCachedPassphrase, cachePassphrase } from './passphrase-store.js'

// Exit codes
export const EXIT_SUCCESS = 0
export const EXIT_ERROR = 1
export const EXIT_DECRYPT_FAILED = 2
export const EXIT_KEY_NOT_FOUND = 3
export const EXIT_BAD_SIGNATURE = 4

// Types
export type GenerateOptions = {
  name: string
  email: string
  passphrase?: string | false // false when --no-passphrase is used
  setDefault?: boolean
  /** false when --no-cache is used */
  cache?: boolean
  type?: 'ecc' | 'rsa'
  expires?: string
}

export type ExportOptions = {
  fingerprint?: string
  json?: boolean
}

export type EncryptOptions = {
  to: string[]
  file?: string
  output?: string
  /** false when --no-sign is used; signing is on by default */
  sign?: boolean
  signWith?: string
  passphrase?: string
}

export type SignOptions = {
  file?: string
  output?: string
  key?: string
  passphrase?: string
}

export type VerifyOptions = {
  file?: string
}

export type DecryptOptions = {
  passphrase?: string
  file?: string
  key?: string
}

export type ListOptions = {
  json?: boolean
}

type Recipient = {
  kind: 'keypair' | 'contact'
  name: string
  email: string
  fingerprint: string
  public_key: string
}

// Helper: Read stdin
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

// Helper: Check if stdin is a TTY (interactive terminal)
function isStdinTTY(): boolean {
  return process.stdin.isTTY === true
}

/**
 * Read the command's input from the argument, --file, or piped stdin, in
 * that order. Exits with a usage error when nothing is available.
 */
export async function readInput(
  message: string | undefined,
  file: string | undefined,
  what: string
): Promise<string> {
  if (file) {
    try {
      return readFileSync(file, 'utf-8')
    } catch {
      fail(`Could not read file "${file}"`, EXIT_ERROR)
    }
  }
  if (message) return message
  if (!isStdinTTY()) return readStdin()
  fail(`No ${what} provided. Use argument, --file, or pipe to stdin.`, EXIT_ERROR)
}

/**
 * Write to stdout and resolve once the data has actually been handed to the
 * OS. `process.exit()` does not wait for pending pipe writes (pipes are async
 * on macOS), so exiting right after `console.log` truncates large output.
 */
export function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()))
  })
}

export function fail(message: string, code: number): never {
  console.error(`Error: ${message}`)
  process.exit(code)
}

// Helper: Get database instance
export async function getDb(): Promise<Db> {
  return Db.init()
}

// Helper: Get default keypair or exit
function requireDefaultKeypair(db: Db): Keypair {
  const keypair = db.getDefaultKeypair()
  if (!keypair) {
    fail(
      'No default keypair found. Run `lpgp` to set up or choose a keypair first.',
      EXIT_KEY_NOT_FOUND
    )
  }
  return keypair
}

/**
 * Find one keypair by full fingerprint or a suffix of at least 8 hex
 * characters. Exits when nothing or more than one keypair matches.
 */
export function requireKeypairByFingerprint(db: Db, fingerprint: string): Keypair {
  const matches = db
    .select({ table: 'keypair' })
    .filter((kp) => fingerprintMatches(kp.fingerprint, fingerprint))
  if (matches.length === 1 && matches[0]) return matches[0]
  if (matches.length === 0) {
    fail(
      `No keypair found matching "${fingerprint}". Give the full fingerprint or its last 8+ hex characters (see \`lpgp list-keys\`).`,
      EXIT_KEY_NOT_FOUND
    )
  }
  fail(
    `"${fingerprint}" matches more than one keypair:\n${matches
      .map((kp) => `  ${kp.fingerprint}  ${kp.name}`)
      .join('\n')}`,
    EXIT_KEY_NOT_FOUND
  )
}

/**
 * Resolve a recipient identifier (exact email, full fingerprint, or a
 * fingerprint suffix of at least 8 hex characters) to exactly one stored key.
 * Own keypairs and contacts are both searched. Exits on no match or an
 * ambiguous match.
 */
function requireRecipient(db: Db, identifier: string): Recipient {
  const trimmed = identifier.trim()
  if (!trimmed) {
    fail('Recipient (--to) cannot be empty', EXIT_ERROR)
  }
  const email = trimmed.toLowerCase()

  const candidates: Recipient[] = [
    ...db.select({ table: 'keypair' }).map((kp) => ({
      kind: 'keypair' as const,
      name: kp.name,
      email: kp.email,
      fingerprint: kp.fingerprint,
      public_key: kp.public_key,
    })),
    ...db.select({ table: 'contact' }).map((c) => ({
      kind: 'contact' as const,
      name: c.name,
      email: c.email,
      fingerprint: c.fingerprint,
      public_key: c.public_key,
    })),
  ]

  const seen = new Set<string>()
  const matches = candidates.filter((c) => {
    const hit =
      c.email.toLowerCase() === email ||
      fingerprintMatches(c.fingerprint, trimmed)
    if (!hit || seen.has(c.fingerprint)) return false
    seen.add(c.fingerprint)
    return true
  })

  if (matches.length === 1 && matches[0]) return matches[0]
  if (matches.length === 0) {
    fail(
      `Could not find recipient "${identifier}". Use an exact email, a full fingerprint, or its last 8+ hex characters.`,
      EXIT_KEY_NOT_FOUND
    )
  }
  fail(
    `"${identifier}" matches more than one key; use a fingerprint instead:\n${matches
      .map((m) => `  ${m.fingerprint}  ${m.name} <${m.email}> (${m.kind})`)
      .join('\n')}`,
    EXIT_KEY_NOT_FOUND
  )
}

/** Every stored public key, for signature verification. */
function knownKeys(db: Db): KnownKey[] {
  return [
    ...db.select({ table: 'keypair' }).map((kp) => ({
      kind: 'keypair' as const,
      name: kp.name,
      email: kp.email,
      fingerprint: kp.fingerprint,
      public_key: kp.public_key,
    })),
    ...db.select({ table: 'contact' }).map((c) => ({
      kind: 'contact' as const,
      name: c.name,
      email: c.email,
      fingerprint: c.fingerprint,
      public_key: c.public_key,
    })),
  ]
}

/**
 * Passphrase lookup order for a keypair: --passphrase, LPGP_PASSPHRASE, then
 * the local cache. Returns null when the key is protected and nothing is
 * available.
 */
export function resolvePassphrase(
  keypair: Keypair,
  options: { passphrase?: string }
): string | null {
  if (!keypair.passphrase_protected) return ''
  if (options.passphrase) return options.passphrase
  if (process.env.LPGP_PASSPHRASE) return process.env.LPGP_PASSPHRASE
  return getCachedPassphrase(keypair.fingerprint)
}

/**
 * Unlock a keypair for signing, or exit with a precise reason.
 */
async function unlockForSigning(
  keypair: Keypair,
  options: { passphrase?: string }
): Promise<openpgp.PrivateKey> {
  const passphrase = resolvePassphrase(keypair, options)
  if (passphrase === null) {
    fail(
      `Passphrase required to sign with "${keypair.name}". Use --passphrase, the LPGP_PASSPHRASE env var, run \`lpgp\` once to cache it, or pass --no-sign.`,
      EXIT_ERROR
    )
  }
  let privateKey: openpgp.PrivateKey
  try {
    privateKey = await openpgp.readPrivateKey({
      armoredKey: keypair.private_key,
      config: weakKeyConfig,
    })
  } catch (error) {
    fail(
      `Stored private key for "${keypair.name}" could not be parsed. ${error instanceof Error ? error.message : error}`,
      EXIT_ERROR
    )
  }
  if (!keypair.passphrase_protected) return privateKey
  try {
    return await openpgp.decryptKey({
      privateKey,
      passphrase,
      config: weakKeyConfig,
    })
  } catch {
    fail(`Wrong passphrase for "${keypair.name}".`, EXIT_DECRYPT_FAILED)
  }
}

/** Print signature results to stderr; return true when any is invalid. */
function reportSignatures(signatures: SignatureStatus[]): boolean {
  if (signatures.length === 0) {
    console.error('Signature: none (message is not signed)')
    return false
  }
  let bad = false
  for (const sig of signatures) {
    console.error(`Signature: ${describeSignature(sig)}`)
    if (sig.status === 'invalid') bad = true
  }
  return bad
}

// Commands

export async function generateCommand(options: GenerateOptions): Promise<void> {
  try {
    const db = await getDb()

    // Validate options
    // Commander sets passphrase to false when --no-passphrase is used
    const noPassphrase = options.passphrase === false
    if (!noPassphrase && !options.passphrase) {
      fail('Either --passphrase or --no-passphrase is required', EXIT_ERROR)
    }

    const passphrase = noPassphrase ? '' : (options.passphrase as string)

    // Validate passphrase length if provided
    if (passphrase && passphrase.length < 8) {
      fail('Passphrase must be at least 8 characters', EXIT_ERROR)
    }

    const keyType = options.type ?? 'ecc'
    if (keyType !== 'ecc' && keyType !== 'rsa') {
      fail('--type must be "ecc" (Curve25519) or "rsa" (RSA 4096)', EXIT_ERROR)
    }
    const expiresDays = options.expires ? Number(options.expires) : 0
    if (!Number.isInteger(expiresDays) || expiresDays < 0) {
      fail('--expires must be a whole number of days', EXIT_ERROR)
    }

    // Generate the keypair
    const { privateKey, publicKey } = await openpgp.generateKey({
      ...(keyType === 'rsa'
        ? { type: 'rsa' as const, rsaBits: 4096 }
        : { type: 'ecc' as const, curve: 'curve25519Legacy' as const }),
      userIDs: [{ name: options.name, email: options.email }],
      ...(passphrase ? { passphrase } : {}),
      ...(expiresDays > 0 ? { keyExpirationTime: expiresDays * 86400 } : {}),
      format: 'armored' as const,
    })

    // Cast to string since we specified format: 'armored'
    const publicKeyStr = publicKey as string
    const privateKeyStr = privateKey as string

    // Extract key information
    const keyInfo = await extractPublicKeyInfo(publicKeyStr)

    // Save to database (the first keypair always becomes default)
    db.insertKeypair(
      {
        name: options.name,
        email: options.email,
        fingerprint: keyInfo.fingerprint,
        public_key: publicKeyStr,
        private_key: privateKeyStr,
        passphrase_protected: !!passphrase,
        algorithm: keyInfo.algorithm,
        key_size: keyInfo.keySize,
        can_sign: keyInfo.canSign,
        can_encrypt: keyInfo.canEncrypt,
        can_certify: keyInfo.canCertify,
        can_authenticate: keyInfo.canAuthenticate,
        expires_at: keyInfo.expiresAt,
        revoked: keyInfo.revoked,
        revocation_reason: null,
        last_used_at: null,
      },
      { makeDefault: options.setDefault !== false }
    )

    // Cache passphrase locally so future runs don't reprompt (unless --no-cache)
    if (passphrase && options.cache !== false) {
      cachePassphrase(keyInfo.fingerprint, passphrase)
    }

    // Output fingerprint for scripting
    await writeStdout(`${keyInfo.fingerprint}\n`)
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function exportPublicCommand(
  options: ExportOptions
): Promise<void> {
  try {
    const db = await getDb()

    const keypair = options.fingerprint
      ? requireKeypairByFingerprint(db, options.fingerprint)
      : requireDefaultKeypair(db)

    if (options.json) {
      const output = {
        fingerprint: keypair.fingerprint,
        email: keypair.email,
        name: keypair.name,
        publicKey: keypair.public_key,
      }
      await writeStdout(`${JSON.stringify(output, null, 2)}\n`)
    } else {
      await writeStdout(`${keypair.public_key}\n`)
    }

    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function listKeysCommand(options: ListOptions): Promise<void> {
  try {
    const db = await getDb()
    const keypairs = db.select({ table: 'keypair' })

    if (keypairs.length === 0) {
      await writeStdout(options.json ? '[]\n' : 'No keypairs found.\n')
      process.exit(EXIT_SUCCESS)
    }

    if (options.json) {
      const output = keypairs.map((kp) => ({
        id: kp.id,
        name: kp.name,
        email: kp.email,
        fingerprint: kp.fingerprint,
        algorithm: kp.algorithm,
        keySize: kp.key_size,
        isDefault: kp.is_default,
        passphraseProtected: kp.passphrase_protected,
        createdAt: kp.created_at,
        expiresAt: kp.expires_at,
      }))
      await writeStdout(`${JSON.stringify(output, null, 2)}\n`)
    } else {
      const lines: string[] = []
      for (const kp of keypairs) {
        const defaultMarker = kp.is_default ? ' (default)' : ''
        lines.push(`${kp.fingerprint}${defaultMarker}`)
        lines.push(`  Name: ${kp.name}`)
        lines.push(`  Email: ${kp.email}`)
        lines.push(`  Algorithm: ${formatAlgorithm(kp.algorithm, kp.key_size)}`)
        lines.push('')
      }
      await writeStdout(`${lines.join('\n')}\n`)
    }

    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function encryptCommand(
  message: string | undefined,
  options: EncryptOptions
): Promise<void> {
  try {
    const db = await getDb()

    const plaintext = await readInput(message, options.file, 'message')

    if (!plaintext || plaintext.trim() === '') {
      fail('Message cannot be empty', EXIT_ERROR)
    }

    // Validate recipients
    if (!options.to || options.to.length === 0) {
      fail('At least one recipient (--to) is required', EXIT_ERROR)
    }

    // Resolve recipients to public keys
    const publicKeys: openpgp.PublicKey[] = []
    for (const identifier of options.to) {
      const recipient = requireRecipient(db, identifier)
      const publicKey = await openpgp.readKey({
        armoredKey: recipient.public_key,
        config: weakKeyConfig,
      })
      publicKeys.push(publicKey)
    }

    // Signing key: on by default, --no-sign to skip, --sign-with to choose
    let signingKey: openpgp.PrivateKey | null = null
    if (options.sign !== false) {
      const keypair = options.signWith
        ? requireKeypairByFingerprint(db, options.signWith)
        : db.getDefaultKeypair()
      if (!keypair) {
        fail(
          'No default keypair to sign with. Pass --sign-with <fingerprint> or --no-sign.',
          EXIT_KEY_NOT_FOUND
        )
      }
      signingKey = await unlockForSigning(keypair, options)
    }

    // Encrypt the message
    const encrypted = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: plaintext }),
      encryptionKeys: publicKeys,
      ...(signingKey ? { signingKeys: signingKey } : {}),
      config: weakKeyConfig,
    })

    const encryptedText = encrypted as string

    // Output to file or stdout
    if (options.output) {
      writeFileSync(options.output, encryptedText)
    } else {
      await writeStdout(`${encryptedText}\n`)
    }

    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function decryptCommand(
  message: string | undefined,
  options: DecryptOptions
): Promise<void> {
  try {
    const db = await getDb()

    const encryptedMessage = await readInput(
      message,
      options.file,
      'encrypted message'
    )

    if (!encryptedMessage || !encryptedMessage.includes('BEGIN PGP MESSAGE')) {
      fail('Invalid or missing PGP message', EXIT_ERROR)
    }

    let pgpMessage: openpgp.Message<string>
    try {
      pgpMessage = await openpgp.readMessage({ armoredMessage: encryptedMessage })
    } catch (error) {
      fail(
        `Could not parse PGP message. ${error instanceof Error ? error.message : error}`,
        EXIT_ERROR
      )
    }

    // Which of our keys can open this message?
    let candidates: Keypair[]
    if (options.key) {
      candidates = [requireKeypairByFingerprint(db, options.key)]
    } else {
      const all = db.select({ table: 'keypair' })
      if (all.length === 0) {
        fail(
          'No keypairs stored. Run `lpgp generate` or `lpgp` to add one.',
          EXIT_KEY_NOT_FOUND
        )
      }
      candidates = await filterKeysForMessage(pgpMessage, all)
      if (candidates.length === 0) {
        fail(
          'This message was not encrypted for any of your stored keys. Use `lpgp list-keys` to see them.',
          EXIT_KEY_NOT_FOUND
        )
      }
      // Prefer the default key when several match
      candidates.sort((a, b) => Number(b.is_default) - Number(a.is_default))
    }

    const { keys: verificationKeys, owners } = await readVerificationKeys(
      knownKeys(db)
    )

    const needsPassphrase: Keypair[] = []
    const wrongPassphrase: Keypair[] = []
    let lastError: string | null = null

    for (const keypair of candidates) {
      const passphrase = resolvePassphrase(keypair, options)
      if (passphrase === null) {
        needsPassphrase.push(keypair)
        continue
      }

      let privateKey: openpgp.PrivateKey
      try {
        privateKey = await openpgp.readPrivateKey({
          armoredKey: keypair.private_key,
          config: weakKeyConfig,
        })
      } catch (error) {
        fail(
          `Stored private key for "${keypair.name}" could not be parsed. ${error instanceof Error ? error.message : error}`,
          EXIT_ERROR
        )
      }

      if (keypair.passphrase_protected) {
        try {
          privateKey = await openpgp.decryptKey({
            privateKey,
            passphrase,
            config: weakKeyConfig,
          })
        } catch {
          wrongPassphrase.push(keypair)
          continue
        }
      }

      let decrypted: string
      let signatures: SignatureStatus[]
      try {
        const result = await openpgp.decrypt({
          message: pgpMessage,
          decryptionKeys: privateKey,
          ...(verificationKeys.length > 0 ? { verificationKeys } : {}),
          config: weakKeyConfig,
        })
        decrypted = result.data as string
        signatures = await summarizeSignatures(result.signatures, owners)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        continue
      }

      db.update(
        'keypair',
        { key: 'id', value: keypair.id },
        { last_used_at: new Date().toISOString() }
      )

      const badSignature = reportSignatures(signatures)
      // No trailing newline: keep round trips byte-exact
      await writeStdout(decrypted)
      process.exit(badSignature ? EXIT_BAD_SIGNATURE : EXIT_SUCCESS)
    }

    if (wrongPassphrase.length > 0) {
      fail(
        `Wrong passphrase for ${wrongPassphrase.map((kp) => `"${kp.name}"`).join(', ')}.`,
        EXIT_DECRYPT_FAILED
      )
    }
    if (needsPassphrase.length > 0) {
      fail(
        `Passphrase required for ${needsPassphrase.map((kp) => `"${kp.name}"`).join(', ')}. Use --passphrase, the LPGP_PASSPHRASE env var, or run \`lpgp\` interactively once to cache it.`,
        EXIT_ERROR
      )
    }
    fail(`Decryption failed. ${lastError ?? ''}`.trim(), EXIT_DECRYPT_FAILED)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function signCommand(
  message: string | undefined,
  options: SignOptions
): Promise<void> {
  try {
    const db = await getDb()
    const text = await readInput(message, options.file, 'message')
    if (!text || text.trim() === '') {
      fail('Message cannot be empty', EXIT_ERROR)
    }

    const keypair = options.key
      ? requireKeypairByFingerprint(db, options.key)
      : db.getDefaultKeypair()
    if (!keypair) {
      fail(
        'No default keypair to sign with. Pass --key <fingerprint>.',
        EXIT_KEY_NOT_FOUND
      )
    }
    const signingKey = await unlockForSigning(keypair, options)

    const signed = await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text }),
      signingKeys: signingKey,
      config: weakKeyConfig,
    })

    db.update(
      'keypair',
      { key: 'id', value: keypair.id },
      { last_used_at: new Date().toISOString() }
    )

    if (options.output) {
      writeFileSync(options.output, signed as string)
    } else {
      await writeStdout(`${signed}\n`)
    }
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function verifyCommand(
  message: string | undefined,
  options: VerifyOptions
): Promise<void> {
  try {
    const db = await getDb()
    const text = await readInput(message, options.file, 'signed message')
    if (!text.includes('BEGIN PGP SIGNED MESSAGE')) {
      fail(
        'Input is not a clear-signed message (expected "BEGIN PGP SIGNED MESSAGE"). For encrypted messages use `lpgp decrypt`, which verifies signatures too.',
        EXIT_ERROR
      )
    }

    let cleartext: openpgp.CleartextMessage
    try {
      cleartext = await openpgp.readCleartextMessage({ cleartextMessage: text })
    } catch (error) {
      fail(
        `Could not parse signed message. ${error instanceof Error ? error.message : error}`,
        EXIT_ERROR
      )
    }

    const { keys: verificationKeys, owners } = await readVerificationKeys(
      knownKeys(db)
    )
    if (verificationKeys.length === 0) {
      fail('No keys stored to verify against.', EXIT_KEY_NOT_FOUND)
    }
    const result = await openpgp.verify({
      message: cleartext,
      verificationKeys,
      config: weakKeyConfig,
    })
    const signatures = await summarizeSignatures(result.signatures, owners)
    const bad = reportSignatures(signatures)
    const unknown = signatures.some((s) => s.status === 'unknown')

    await writeStdout(`${result.data}\n`)
    process.exit(bad || unknown ? EXIT_BAD_SIGNATURE : EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

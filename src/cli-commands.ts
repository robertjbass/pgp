import * as openpgp from 'openpgp'
import { readFileSync, writeFileSync } from 'fs'
import { Db, type Keypair, type Contact } from './db.js'
import { extractPublicKeyInfo } from './key-utils.js'
import {
  getCachedPassphrase,
  cachePassphrase,
} from './passphrase-store.js'

// Exit codes
export const EXIT_SUCCESS = 0
export const EXIT_ERROR = 1
export const EXIT_DECRYPT_FAILED = 2
export const EXIT_KEY_NOT_FOUND = 3

// Config to allow weak keys like DSA (not recommended for production)
const weakKeyConfig = {
  rejectPublicKeyAlgorithms: new Set(),
  rejectHashAlgorithms: new Set(),
  rejectMessageHashAlgorithms: new Set(),
  rejectCurves: new Set(),
  allowMissingKeyFlags: true,
}

// Types
export type GenerateOptions = {
  name: string
  email: string
  passphrase?: string | false // false when --no-passphrase is used
  setDefault?: boolean
}

export type ExportOptions = {
  fingerprint?: string
  json?: boolean
}

export type EncryptOptions = {
  to: string[]
  file?: string
  output?: string
}

export type DecryptOptions = {
  passphrase?: string
  file?: string
}

export type ListOptions = {
  json?: boolean
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

// Helper: Get database instance
async function getDb(): Promise<Db> {
  return Db.init()
}

// Helper: Get default keypair or throw
async function getDefaultKeypair(db: Db): Promise<Keypair> {
  const keypairs = db.select({
    table: 'keypair',
    where: { key: 'is_default', compare: 'is', value: 1 },
  })
  const keypair = keypairs[0]
  if (!keypair) {
    throw new Error(
      'No default keypair found. Run `lpgp` to set up a keypair first.'
    )
  }
  return keypair
}

// Helper: Get keypair by fingerprint
function getKeypairByFingerprint(db: Db, fingerprint: string): Keypair | null {
  const keypairs = db.select({ table: 'keypair' })
  const normalized = fingerprint.toUpperCase().replace(/\s/g, '')
  return (
    keypairs.find((kp) => kp.fingerprint.toUpperCase().includes(normalized)) ||
    null
  )
}

// Helper: Resolve recipient to public key(s)
// Accepts fingerprint (partial match) or email
function resolveRecipient(db: Db, identifier: string): string | null {
  const normalizedId = identifier.toLowerCase().trim()

  // Try keypairs by fingerprint first
  const keypairs = db.select({ table: 'keypair' })
  for (const kp of keypairs) {
    if (kp.fingerprint.toLowerCase().includes(normalizedId)) {
      return kp.public_key
    }
    if (kp.email.toLowerCase() === normalizedId) {
      return kp.public_key
    }
  }

  // Try contacts by fingerprint, then email
  const contacts = db.select({ table: 'contact' })
  for (const c of contacts) {
    if (c.fingerprint.toLowerCase().includes(normalizedId)) {
      return c.public_key
    }
    if (c.email.toLowerCase() === normalizedId) {
      return c.public_key
    }
  }

  return null
}

// Commands

export async function generateCommand(options: GenerateOptions): Promise<void> {
  try {
    const db = await getDb()

    // Validate options
    // Commander sets passphrase to false when --no-passphrase is used
    const noPassphrase = options.passphrase === false
    if (!noPassphrase && !options.passphrase) {
      console.error('Error: Either --passphrase or --no-passphrase is required')
      process.exit(EXIT_ERROR)
    }

    const passphrase = noPassphrase ? '' : (options.passphrase as string)

    // Validate passphrase length if provided
    if (passphrase && passphrase.length < 8) {
      console.error('Error: Passphrase must be at least 8 characters')
      process.exit(EXIT_ERROR)
    }

    // Generate the keypair
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: 'rsa',
      rsaBits: 4096,
      userIDs: [{ name: options.name, email: options.email }],
      ...(passphrase ? { passphrase } : {}),
      format: 'armored' as const,
    })

    // Cast to string since we specified format: 'armored'
    const publicKeyStr = publicKey as string
    const privateKeyStr = privateKey as string

    // Extract key information
    const keyInfo = await extractPublicKeyInfo(publicKeyStr)

    // Determine if this should be the default
    const setDefault = options.setDefault !== false
    const existingKeypairs = db.select({ table: 'keypair' })
    const isFirstKeypair = existingKeypairs.length === 0

    // If setting as default, unset all other defaults
    if (setDefault || isFirstKeypair) {
      for (const kp of existingKeypairs) {
        db.update('keypair', { key: 'id', value: kp.id }, { is_default: false })
      }
    }

    // Save to database
    db.insert('keypair', {
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
      revoked: false,
      revocation_reason: null,
      last_used_at: null,
      is_default: setDefault || isFirstKeypair,
    })

    // Cache passphrase locally so future runs don't reprompt
    if (passphrase) {
      cachePassphrase(keyInfo.fingerprint, passphrase)
    }

    // Output fingerprint for scripting
    console.log(keyInfo.fingerprint)
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`)
    process.exit(EXIT_ERROR)
  }
}

export async function exportPublicCommand(
  options: ExportOptions
): Promise<void> {
  try {
    const db = await getDb()

    let keypair: Keypair | null

    if (options.fingerprint) {
      keypair = getKeypairByFingerprint(db, options.fingerprint)
      if (!keypair) {
        console.error(
          `Error: No keypair found with fingerprint containing "${options.fingerprint}"`
        )
        process.exit(EXIT_KEY_NOT_FOUND)
      }
    } else {
      keypair = await getDefaultKeypair(db)
    }

    if (options.json) {
      const output = {
        fingerprint: keypair.fingerprint,
        email: keypair.email,
        name: keypair.name,
        publicKey: keypair.public_key,
      }
      console.log(JSON.stringify(output, null, 2))
    } else {
      console.log(keypair.public_key)
    }

    process.exit(EXIT_SUCCESS)
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`)
    process.exit(EXIT_ERROR)
  }
}

export async function listKeysCommand(options: ListOptions): Promise<void> {
  try {
    const db = await getDb()
    const keypairs = db.select({ table: 'keypair' })

    if (keypairs.length === 0) {
      if (options.json) {
        console.log('[]')
      } else {
        console.log('No keypairs found.')
      }
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
      console.log(JSON.stringify(output, null, 2))
    } else {
      for (const kp of keypairs) {
        const defaultMarker = kp.is_default ? ' (default)' : ''
        console.log(`${kp.fingerprint}${defaultMarker}`)
        console.log(`  Name: ${kp.name}`)
        console.log(`  Email: ${kp.email}`)
        console.log(`  Algorithm: ${kp.algorithm} (${kp.key_size})`)
        console.log('')
      }
    }

    process.exit(EXIT_SUCCESS)
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`)
    process.exit(EXIT_ERROR)
  }
}

export async function encryptCommand(
  message: string | undefined,
  options: EncryptOptions
): Promise<void> {
  try {
    const db = await getDb()

    // Get the message from argument, file, or stdin
    let plaintext: string

    if (options.file) {
      try {
        plaintext = readFileSync(options.file, 'utf-8')
      } catch (error) {
        console.error(`Error: Could not read file "${options.file}"`)
        process.exit(EXIT_ERROR)
      }
    } else if (message) {
      plaintext = message
    } else if (!isStdinTTY()) {
      plaintext = await readStdin()
    } else {
      console.error(
        'Error: No message provided. Use argument, --file, or pipe to stdin.'
      )
      process.exit(EXIT_ERROR)
    }

    if (!plaintext || plaintext.trim() === '') {
      console.error('Error: Message cannot be empty')
      process.exit(EXIT_ERROR)
    }

    // Validate recipients
    if (!options.to || options.to.length === 0) {
      console.error('Error: At least one recipient (--to) is required')
      process.exit(EXIT_ERROR)
    }

    // Resolve recipients to public keys
    const publicKeys: openpgp.PublicKey[] = []
    for (const recipient of options.to) {
      const publicKeyArmored = resolveRecipient(db, recipient)
      if (!publicKeyArmored) {
        console.error(`Error: Could not find recipient "${recipient}"`)
        process.exit(EXIT_KEY_NOT_FOUND)
      }
      const publicKey = await openpgp.readKey({
        armoredKey: publicKeyArmored,
        config: weakKeyConfig,
      })
      publicKeys.push(publicKey)
    }

    // Encrypt the message
    const encrypted = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: plaintext }),
      encryptionKeys: publicKeys,
      config: weakKeyConfig,
    })

    const encryptedText = encrypted as string

    // Output to file or stdout
    if (options.output) {
      writeFileSync(options.output, encryptedText)
    } else {
      console.log(encryptedText)
    }

    process.exit(EXIT_SUCCESS)
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`)
    process.exit(EXIT_ERROR)
  }
}

export async function decryptCommand(
  message: string | undefined,
  options: DecryptOptions
): Promise<void> {
  try {
    const db = await getDb()

    // Get the encrypted message from argument, file, or stdin
    let encryptedMessage: string

    if (options.file) {
      try {
        encryptedMessage = readFileSync(options.file, 'utf-8')
      } catch (error) {
        console.error(`Error: Could not read file "${options.file}"`)
        process.exit(EXIT_ERROR)
      }
    } else if (message) {
      encryptedMessage = message
    } else if (!isStdinTTY()) {
      encryptedMessage = await readStdin()
    } else {
      console.error(
        'Error: No encrypted message provided. Use argument, --file, or pipe to stdin.'
      )
      process.exit(EXIT_ERROR)
    }

    if (!encryptedMessage || !encryptedMessage.includes('BEGIN PGP MESSAGE')) {
      console.error('Error: Invalid or missing PGP message')
      process.exit(EXIT_ERROR)
    }

    // Get the default keypair
    const keypair = await getDefaultKeypair(db)

    // Get passphrase from option, environment variable, or keychain
    let passphrase = ''

    if (keypair.passphrase_protected) {
      if (options.passphrase) {
        passphrase = options.passphrase
      } else if (process.env.LPGP_PASSPHRASE) {
        passphrase = process.env.LPGP_PASSPHRASE
      } else {
        const stored = getCachedPassphrase(keypair.fingerprint)
        if (stored) {
          passphrase = stored
        } else {
          console.error(
            'Error: Passphrase required. Use --passphrase, LPGP_PASSPHRASE env var, or run `lpgp` interactively to cache it.'
          )
          process.exit(EXIT_ERROR)
        }
      }
    }

    // Read and decrypt the private key
    let privateKey: openpgp.PrivateKey
    try {
      const readKey = await openpgp.readPrivateKey({
        armoredKey: keypair.private_key,
        config: weakKeyConfig,
      })

      if (keypair.passphrase_protected) {
        privateKey = await openpgp.decryptKey({
          privateKey: readKey,
          passphrase,
          config: weakKeyConfig,
        })
      } else {
        privateKey = readKey
      }
    } catch (error) {
      console.error('Error: Failed to decrypt private key. Wrong passphrase?')
      process.exit(EXIT_DECRYPT_FAILED)
    }

    // Decrypt the message
    try {
      const pgpMessage = await openpgp.readMessage({
        armoredMessage: encryptedMessage,
      })

      const { data: decrypted } = await openpgp.decrypt({
        message: pgpMessage,
        decryptionKeys: privateKey,
        config: weakKeyConfig,
      })

      // Update last_used_at
      db.update(
        'keypair',
        { key: 'id', value: keypair.id },
        { last_used_at: new Date().toISOString() }
      )

      console.log(decrypted)
      process.exit(EXIT_SUCCESS)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      if (errorMessage.includes('No decryption key packets found')) {
        console.error(
          'Error: Decryption failed. This message was not encrypted for your current default key.'
        )
        console.error(
          '  Tip: Use `lpgp list-keys` to check which keypair is set as default.'
        )
      } else {
        console.error(`Error: Decryption failed. ${errorMessage}`)
      }
      process.exit(EXIT_DECRYPT_FAILED)
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`)
    process.exit(EXIT_ERROR)
  }
}

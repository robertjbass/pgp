import * as openpgp from 'openpgp'
import { writeFileSync } from 'fs'
import { type Db, type Contact } from './db.js'
import {
  extractPublicKeyInfo,
  extractPrivateKeyInfo,
  fingerprintMatches,
  formatAlgorithm,
  weakKeyConfig,
} from './key-utils.js'
import {
  cachePassphrase,
  removeCachedPassphrase,
  clearAllCachedPassphrases,
} from './passphrase-store.js'
import {
  EXIT_SUCCESS,
  EXIT_ERROR,
  EXIT_DECRYPT_FAILED,
  EXIT_KEY_NOT_FOUND,
  fail,
  getDb,
  readInput,
  writeStdout,
  requireKeypairByFingerprint,
} from './cli-commands.js'

// Key and contact management commands (non-interactive counterparts of the
// key manager menu).

export type ImportKeyOptions = {
  file?: string
  passphrase?: string
  name?: string
  setDefault?: boolean
  cache?: boolean
}

export type ImportContactOptions = {
  file?: string
  name?: string
}

export type ListContactsOptions = {
  json?: boolean
}

export type YesOptions = {
  yes?: boolean
}

export type ExportPrivateOptions = {
  fingerprint?: string
  output?: string
}

export type ClearCacheOptions = {
  fingerprint?: string
  all?: boolean
}

const PRIVATE_BLOCK =
  /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/
const PUBLIC_BLOCK =
  /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/

function requireContact(db: Db, identifier: string): Contact {
  const trimmed = identifier.trim()
  if (!trimmed) fail('Contact identifier cannot be empty', EXIT_ERROR)
  const email = trimmed.toLowerCase()
  const matches = db
    .select({ table: 'contact' })
    .filter(
      (c) =>
        c.email.toLowerCase() === email ||
        fingerprintMatches(c.fingerprint, trimmed)
    )
  if (matches.length === 1 && matches[0]) return matches[0]
  if (matches.length === 0) {
    fail(
      `No contact found matching "${identifier}" (see \`lpgp list-contacts\`).`,
      EXIT_KEY_NOT_FOUND
    )
  }
  fail(
    `"${identifier}" matches more than one contact; use a fingerprint:\n${matches
      .map((c) => `  ${c.fingerprint}  ${c.name} <${c.email}>`)
      .join('\n')}`,
    EXIT_KEY_NOT_FOUND
  )
}

export async function importKeyCommand(
  input: string | undefined,
  options: ImportKeyOptions
): Promise<void> {
  try {
    const db = await getDb()
    const text = await readInput(input, options.file, 'armored key')

    const privateArmored = text.match(PRIVATE_BLOCK)?.[0]
    if (!privateArmored) {
      fail(
        'No private key block found. Provide an armored private key (the public key is derived automatically).',
        EXIT_ERROR
      )
    }

    let privateKey: openpgp.PrivateKey
    try {
      privateKey = await openpgp.readPrivateKey({
        armoredKey: privateArmored,
        config: weakKeyConfig,
      })
    } catch (error) {
      fail(
        `Could not parse private key. ${error instanceof Error ? error.message : error}`,
        EXIT_ERROR
      )
    }

    const fingerprint = privateKey.getFingerprint().toUpperCase()
    const existing = db.getKeypairByFingerprint(fingerprint)
    if (existing) {
      fail(
        `This key is already stored as "${existing.name}" (${fingerprint}).`,
        EXIT_ERROR
      )
    }

    // Use the supplied public block when present, otherwise derive it
    const publicArmored =
      text.match(PUBLIC_BLOCK)?.[0] ?? privateKey.toPublic().armor()

    const protectedKey = !privateKey.isDecrypted()
    const passphrase =
      options.passphrase ?? process.env.LPGP_PASSPHRASE ?? null
    if (protectedKey && !passphrase) {
      fail(
        'This private key is passphrase-protected. Pass --passphrase or set LPGP_PASSPHRASE so it can be verified.',
        EXIT_ERROR
      )
    }

    let keyInfo: Awaited<ReturnType<typeof extractPrivateKeyInfo>>
    try {
      keyInfo = await extractPrivateKeyInfo(
        privateArmored,
        protectedKey ? (passphrase as string) : undefined
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (/passphrase/i.test(msg)) {
        fail('Wrong passphrase for this private key.', EXIT_DECRYPT_FAILED)
      }
      fail(`Could not read private key. ${msg}`, EXIT_ERROR)
    }

    const keypair = db.insertKeypair(
      {
        name: options.name?.trim() || keyInfo.name,
        email: keyInfo.email,
        fingerprint: keyInfo.fingerprint,
        public_key: publicArmored,
        private_key: privateArmored,
        passphrase_protected: keyInfo.passphraseProtected,
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
      { makeDefault: options.setDefault === true }
    )

    if (protectedKey && passphrase && options.cache !== false) {
      cachePassphrase(keypair.fingerprint, passphrase)
    }

    console.error(
      `Imported "${keypair.name}" <${keypair.email}>${keypair.is_default ? ' (default)' : ''}`
    )
    await writeStdout(`${keypair.fingerprint}\n`)
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function importContactCommand(
  input: string | undefined,
  options: ImportContactOptions
): Promise<void> {
  try {
    const db = await getDb()
    const text = await readInput(input, options.file, 'armored public key')
    const publicArmored = text.match(PUBLIC_BLOCK)?.[0]
    if (!publicArmored) {
      fail('No public key block found in the input.', EXIT_ERROR)
    }

    let info: Awaited<ReturnType<typeof extractPublicKeyInfo>>
    try {
      info = await extractPublicKeyInfo(publicArmored)
    } catch (error) {
      fail(
        `Could not parse public key. ${error instanceof Error ? error.message : error}`,
        EXIT_ERROR
      )
    }

    if (db.getKeypairByFingerprint(info.fingerprint)) {
      fail(
        'That is one of your own keypairs; it does not need to be a contact.',
        EXIT_ERROR
      )
    }

    const name = options.name?.trim() || info.name
    const existing = db
      .select({ table: 'contact' })
      .find((c) => c.fingerprint === info.fingerprint)

    if (existing) {
      db.update(
        'contact',
        { key: 'id', value: existing.id },
        {
          name,
          email: info.email,
          public_key: publicArmored,
          expires_at: info.expiresAt,
          revoked: info.revoked,
        }
      )
      console.error(`Updated contact "${name}" <${info.email}>`)
    } else {
      db.insert('contact', {
        name,
        email: info.email,
        fingerprint: info.fingerprint,
        public_key: publicArmored,
        algorithm: info.algorithm,
        key_size: info.keySize,
        trusted: false,
        last_verified_at: null,
        notes: null,
        expires_at: info.expiresAt,
        revoked: info.revoked,
      })
      console.error(`Added contact "${name}" <${info.email}>`)
    }
    await writeStdout(`${info.fingerprint}\n`)
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function listContactsCommand(
  options: ListContactsOptions
): Promise<void> {
  try {
    const db = await getDb()
    const contacts = db.select({ table: 'contact' })

    if (options.json) {
      const output = contacts.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        fingerprint: c.fingerprint,
        algorithm: c.algorithm,
        keySize: c.key_size,
        expiresAt: c.expires_at,
        revoked: c.revoked,
        createdAt: c.created_at,
      }))
      await writeStdout(`${JSON.stringify(output, null, 2)}\n`)
    } else if (contacts.length === 0) {
      await writeStdout('No contacts found.\n')
    } else {
      const lines: string[] = []
      for (const c of contacts) {
        const flags = [
          c.revoked ? 'revoked' : null,
          c.expires_at && new Date(c.expires_at).getTime() < Date.now()
            ? 'expired'
            : null,
        ].filter(Boolean)
        lines.push(`${c.fingerprint}${flags.length ? ` (${flags.join(', ')})` : ''}`)
        lines.push(`  Name: ${c.name}`)
        lines.push(`  Email: ${c.email}`)
        lines.push(`  Algorithm: ${formatAlgorithm(c.algorithm, c.key_size)}`)
        lines.push('')
      }
      await writeStdout(`${lines.join('\n')}\n`)
    }
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function removeContactCommand(identifier: string): Promise<void> {
  try {
    const db = await getDb()
    const contact = requireContact(db, identifier)
    db.delete('contact', { key: 'id', value: contact.id })
    console.error(`Removed contact "${contact.name}" <${contact.email}>`)
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function setDefaultCommand(fingerprint: string): Promise<void> {
  try {
    const db = await getDb()
    const keypair = requireKeypairByFingerprint(db, fingerprint)
    db.setDefaultKeypair(keypair.id)
    console.error(`"${keypair.name}" is now the default keypair`)
    await writeStdout(`${keypair.fingerprint}\n`)
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function deleteKeyCommand(
  fingerprint: string,
  options: YesOptions
): Promise<void> {
  try {
    const db = await getDb()
    const keypair = requireKeypairByFingerprint(db, fingerprint)
    if (!options.yes) {
      fail(
        `Refusing to delete "${keypair.name}" (${keypair.fingerprint}) without --yes. This cannot be undone.`,
        EXIT_ERROR
      )
    }
    db.delete('keypair', { key: 'id', value: keypair.id })
    removeCachedPassphrase(keypair.fingerprint)
    console.error(`Deleted "${keypair.name}" (${keypair.fingerprint})`)

    if (keypair.is_default) {
      const remaining = db.select({ table: 'keypair' })
      const only = remaining[0]
      if (remaining.length === 1 && only) {
        db.setDefaultKeypair(only.id)
        console.error(`"${only.name}" is now the default keypair`)
      } else if (remaining.length > 1) {
        console.error(
          'The deleted key was the default. Choose a new one with `lpgp set-default <fingerprint>`.'
        )
      }
    }
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function renameKeyCommand(
  fingerprint: string,
  name: string
): Promise<void> {
  try {
    const db = await getDb()
    if (!name || !name.trim()) fail('Name cannot be empty', EXIT_ERROR)
    const keypair = requireKeypairByFingerprint(db, fingerprint)
    db.update('keypair', { key: 'id', value: keypair.id }, { name: name.trim() })
    console.error(`Renamed "${keypair.name}" to "${name.trim()}"`)
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function exportPrivateCommand(
  options: ExportPrivateOptions
): Promise<void> {
  try {
    const db = await getDb()
    const keypair = options.fingerprint
      ? requireKeypairByFingerprint(db, options.fingerprint)
      : db.getDefaultKeypair()
    if (!keypair) {
      fail('No default keypair found. Pass --fingerprint.', EXIT_KEY_NOT_FOUND)
    }
    console.error(
      keypair.passphrase_protected
        ? `Warning: exporting the private key for "${keypair.name}". It is passphrase-protected, but treat the output as secret.`
        : `Warning: exporting the private key for "${keypair.name}". It is NOT passphrase-protected; anyone with this text can decrypt your messages.`
    )
    if (options.output) {
      writeFileSync(options.output, `${keypair.private_key}\n`, { mode: 0o600 })
      console.error(`Written to ${options.output}`)
    } else {
      await writeStdout(`${keypair.private_key}\n`)
    }
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

export async function clearCacheCommand(
  options: ClearCacheOptions
): Promise<void> {
  try {
    const db = await getDb()
    if (options.all) {
      clearAllCachedPassphrases()
      console.error('Forgot all cached passphrases')
    } else if (options.fingerprint) {
      const keypair = requireKeypairByFingerprint(db, options.fingerprint)
      removeCachedPassphrase(keypair.fingerprint)
      console.error(`Forgot the cached passphrase for "${keypair.name}"`)
    } else {
      fail('Pass --fingerprint <fp> or --all.', EXIT_ERROR)
    }
    process.exit(EXIT_SUCCESS)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), EXIT_ERROR)
  }
}

import Database from 'better-sqlite3'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DB_DIR = join(__dirname, '..', 'db')
const DB_PATH = join(DB_DIR, 'data.db')
const SCHEMA_PATH = join(__dirname, 'schema.sql')
const OLD_JSON_PATH = join(DB_DIR, 'data.json')

// Your own keypairs (you have both public and private keys)
export type Keypair = {
  id: number
  name: string
  email: string
  fingerprint: string
  public_key: string
  private_key: string
  passphrase_protected: boolean
  algorithm: string
  key_size: string
  can_sign: boolean
  can_encrypt: boolean
  can_certify: boolean
  can_authenticate: boolean
  expires_at: string | null
  revoked: boolean
  revocation_reason: string | null
  created_at: string
  updated_at: string
  last_used_at: string | null
  is_default: boolean
}

// Other people's public keys (for encrypting messages to them)
export type Contact = {
  id: number
  name: string
  email: string
  fingerprint: string
  public_key: string
  algorithm: string
  key_size: string
  trusted: boolean
  last_verified_at: string | null
  notes: string | null
  expires_at: string | null
  revoked: boolean
  created_at: string
  updated_at: string
}

// App settings (single row with typed fields)
export type Settings = {
  id: number
  default_keypair_id: number | null
  auto_sign_messages: boolean
  prefer_inline_pgp: boolean
  keyserver_url: string
}

type Schema = {
  keypair: Keypair[]
  contact: Contact[]
  settings: Settings
}

// SQLite stores booleans as 0/1, so we need conversion helpers
function boolToInt(value: boolean): number {
  return value ? 1 : 0
}

function intToBool(value: number): boolean {
  return value === 1
}

export class Db {
  private db: Database.Database

  constructor() {
    // Ensure db directory exists
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true })
    }

    // Initialize database
    this.db = new Database(DB_PATH)
    this.db.pragma('journal_mode = WAL') // Better performance for concurrent reads

    // Initialize schema
    this.initializeSchema()

    // Migrate old JSON data if it exists
    this.migrateFromJson()
  }

  private initializeSchema(): void {
    const schema = readFileSync(SCHEMA_PATH, 'utf-8')
    this.db.exec(schema)
  }

  private migrateFromJson(): void {
    if (!existsSync(OLD_JSON_PATH)) {
      return
    }

    try {
      const fileContent = readFileSync(OLD_JSON_PATH, 'utf-8').trim()
      if (fileContent === '') {
        return
      }

      // Old schema structure
      type OldKeypair = {
        id: number
        name: string
        email: string
        fingerprint: string
        public_key: string
        private_key: string
        passphrase_protected: boolean
        created_at: string
        updated_at: string
        is_default: boolean
      }

      type OldContact = {
        id: number
        name: string
        email: string
        fingerprint: string
        public_key: string
        trusted: boolean
        notes?: string
        created_at: string
        updated_at: string
      }

      type OldSchema = {
        keypair: OldKeypair[]
        contact: OldContact[]
        settings: Array<{ id: number; key: string; value: string }>
      }

      const oldData = JSON.parse(fileContent) as OldSchema

      // Migrate keypairs (with default values for new fields)
      for (const kp of oldData.keypair) {
        const existing = this.db
          .prepare('SELECT id FROM keypair WHERE fingerprint = ?')
          .get(kp.fingerprint)
        if (!existing) {
          this.db
            .prepare(
              `INSERT INTO keypair (
              name, email, fingerprint, public_key, private_key, passphrase_protected,
              algorithm, key_size, can_sign, can_encrypt, can_certify, can_authenticate,
              expires_at, revoked, revocation_reason, created_at, updated_at, last_used_at, is_default
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              kp.name,
              kp.email,
              kp.fingerprint,
              kp.public_key,
              kp.private_key,
              boolToInt(kp.passphrase_protected),
              'RSA', // Default algorithm
              '4096', // Default key size
              1, // can_sign
              1, // can_encrypt
              0, // can_certify
              0, // can_authenticate
              null, // expires_at
              0, // revoked
              null, // revocation_reason
              kp.created_at,
              kp.updated_at,
              null, // last_used_at
              boolToInt(kp.is_default)
            )
        }
      }

      // Migrate contacts (with default values for new fields)
      for (const contact of oldData.contact) {
        const existing = this.db
          .prepare('SELECT id FROM contact WHERE fingerprint = ?')
          .get(contact.fingerprint)
        if (!existing) {
          this.db
            .prepare(
              `INSERT INTO contact (
              name, email, fingerprint, public_key, algorithm, key_size,
              trusted, last_verified_at, notes, expires_at, revoked, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              contact.name,
              contact.email,
              contact.fingerprint,
              contact.public_key,
              'RSA', // Default algorithm
              '4096', // Default key size
              boolToInt(contact.trusted),
              null, // last_verified_at
              contact.notes || null,
              null, // expires_at
              0, // revoked
              contact.created_at,
              contact.updated_at
            )
        }
      }

      console.log('Successfully migrated data from JSON to SQLite')
    } catch (error) {
      console.error('Failed to migrate JSON data:', error)
    }
  }

  public select<T extends keyof Schema>({
    table,
    where,
  }: {
    table: T
    where?: {
      key: keyof Schema[T] extends keyof Schema[T]
        ? T extends 'settings'
          ? keyof Settings
          : keyof Keypair | keyof Contact
        : never
      compare: 'is' | 'is not' | 'like' | 'not like'
      value: any
    }
  }): T extends 'settings' ? Settings : Schema[T] {
    if (table === 'settings') {
      const row = this.db.prepare('SELECT * FROM settings WHERE id = 1').get() as any
      if (!row) {
        throw new Error('Settings not found')
      }
      // Convert SQLite integers to booleans
      return {
        ...row,
        auto_sign_messages: intToBool(row.auto_sign_messages),
        prefer_inline_pgp: intToBool(row.prefer_inline_pgp),
      } as any
    }

    let sql = `SELECT * FROM ${table}`
    let params: any[] = []

    if (where) {
      const operator =
        where.compare === 'is'
          ? '='
          : where.compare === 'is not'
            ? '!='
            : where.compare === 'like'
              ? 'LIKE'
              : 'NOT LIKE'

      sql += ` WHERE ${String(where.key)} ${operator} ?`
      params.push(
        where.compare === 'like' || where.compare === 'not like'
          ? `%${where.value}%`
          : where.value
      )
    }

    const rows = this.db.prepare(sql).all(...params) as any[]

    // Convert SQLite integers to booleans for keypair and contact
    return rows.map((row) => {
      if (table === 'keypair') {
        return {
          ...row,
          passphrase_protected: intToBool(row.passphrase_protected),
          can_sign: intToBool(row.can_sign),
          can_encrypt: intToBool(row.can_encrypt),
          can_certify: intToBool(row.can_certify),
          can_authenticate: intToBool(row.can_authenticate),
          revoked: intToBool(row.revoked),
          is_default: intToBool(row.is_default),
        }
      } else if (table === 'contact') {
        return {
          ...row,
          trusted: intToBool(row.trusted),
          revoked: intToBool(row.revoked),
        }
      }
      return row
    }) as any
  }

  public insert<T extends keyof Schema>(
    table: T,
    value: T extends 'settings'
      ? Partial<Omit<Settings, 'id'>>
      : T extends 'keypair'
        ? Omit<Keypair, 'id' | 'created_at' | 'updated_at'>
        : Omit<Contact, 'id' | 'created_at' | 'updated_at'>
  ): T extends 'settings' ? Settings : T extends 'keypair' ? Keypair : Contact {
    if (table === 'settings') {
      // Settings is a single row, use UPDATE instead
      const updates = value as Partial<Omit<Settings, 'id'>>
      const setPairs: string[] = []
      const params: any[] = []

      for (const [key, val] of Object.entries(updates)) {
        setPairs.push(`${key} = ?`)
        if (typeof val === 'boolean') {
          params.push(boolToInt(val))
        } else {
          params.push(val)
        }
      }

      this.db.prepare(`UPDATE settings SET ${setPairs.join(', ')} WHERE id = 1`).run(...params)

      return this.select({ table: 'settings' }) as any
    }

    const now = new Date().toISOString()
    const record = { ...value, created_at: now, updated_at: now } as any

    // Convert booleans to integers for SQLite
    if (table === 'keypair') {
      record.passphrase_protected = boolToInt(record.passphrase_protected)
      record.can_sign = boolToInt(record.can_sign ?? true)
      record.can_encrypt = boolToInt(record.can_encrypt ?? true)
      record.can_certify = boolToInt(record.can_certify ?? false)
      record.can_authenticate = boolToInt(record.can_authenticate ?? false)
      record.revoked = boolToInt(record.revoked ?? false)
      record.is_default = boolToInt(record.is_default ?? false)
    } else if (table === 'contact') {
      record.trusted = boolToInt(record.trusted ?? false)
      record.revoked = boolToInt(record.revoked ?? false)
    }

    const keys = Object.keys(record)
    const placeholders = keys.map(() => '?').join(', ')
    const values = keys.map((k) => record[k])

    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
    const info = this.db.prepare(sql).run(...values)

    // Fetch and return the inserted record
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid) as any
  }

  public update<T extends keyof Schema>(
    table: T,
    where: {
      key: T extends 'settings'
        ? keyof Settings
        : keyof Keypair | keyof Contact
      value: any
    },
    updates: T extends 'settings'
      ? Partial<Settings>
      : T extends 'keypair'
        ? Partial<Keypair>
        : Partial<Contact>
  ): void {
    const now = new Date().toISOString()
    const record = { ...updates, updated_at: now } as any

    // Convert booleans to integers for SQLite
    if (table === 'keypair' && record) {
      if ('passphrase_protected' in record)
        record.passphrase_protected = boolToInt(record.passphrase_protected)
      if ('can_sign' in record) record.can_sign = boolToInt(record.can_sign)
      if ('can_encrypt' in record) record.can_encrypt = boolToInt(record.can_encrypt)
      if ('can_certify' in record) record.can_certify = boolToInt(record.can_certify)
      if ('can_authenticate' in record)
        record.can_authenticate = boolToInt(record.can_authenticate)
      if ('revoked' in record) record.revoked = boolToInt(record.revoked)
      if ('is_default' in record) record.is_default = boolToInt(record.is_default)
    } else if (table === 'contact' && record) {
      if ('trusted' in record) record.trusted = boolToInt(record.trusted)
      if ('revoked' in record) record.revoked = boolToInt(record.revoked)
    } else if (table === 'settings' && record) {
      if ('auto_sign_messages' in record)
        record.auto_sign_messages = boolToInt(record.auto_sign_messages)
      if ('prefer_inline_pgp' in record)
        record.prefer_inline_pgp = boolToInt(record.prefer_inline_pgp)
    }

    const setPairs: string[] = []
    const params: any[] = []

    for (const [key, val] of Object.entries(record)) {
      if (key === 'id') continue // Don't update id
      setPairs.push(`${key} = ?`)
      params.push(val)
    }

    params.push(where.value)

    const sql = `UPDATE ${table} SET ${setPairs.join(', ')} WHERE ${String(where.key)} = ?`
    this.db.prepare(sql).run(...params)
  }

  public delete<T extends keyof Schema>(
    table: T,
    where: {
      key: T extends 'settings'
        ? keyof Settings
        : keyof Keypair | keyof Contact
      value: any
    }
  ): void {
    if (table === 'settings') {
      throw new Error('Cannot delete settings row')
    }

    const sql = `DELETE FROM ${table} WHERE ${String(where.key)} = ?`
    this.db.prepare(sql).run(where.value)
  }

  public close(): void {
    this.db.close()
  }
}

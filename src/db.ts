import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js'
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getConfigDir, getDbPath } from './config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// New location: ~/.lpgp/data.db
const DB_DIR = getConfigDir()
const DB_PATH = getDbPath()

// Schema is bundled with the package
const SCHEMA_PATH = join(__dirname, 'schema.sql')

// Legacy locations (for migration)
const LEGACY_DB_DIR = join(__dirname, '..', 'db')
const LEGACY_DB_PATH = join(LEGACY_DB_DIR, 'data.db')
const LEGACY_JSON_PATH = join(LEGACY_DB_DIR, 'data.json')

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

// Singleton instance
let dbInstance: Db | null = null

export class Db {
  private db: SqlJsDatabase

  private constructor(db: SqlJsDatabase) {
    this.db = db
  }

  /**
   * Initialize and get the database instance
   */
  static async init(): Promise<Db> {
    if (dbInstance) {
      return dbInstance
    }

    // Ensure config directory exists
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true })
    }

    // Migrate from legacy location if needed
    Db.migrateFromLegacyLocation()

    // Initialize sql.js
    const SQL = await initSqlJs()

    // Load existing database or create new one
    let db: SqlJsDatabase
    if (existsSync(DB_PATH)) {
      const buffer = readFileSync(DB_PATH)
      db = new SQL.Database(buffer)
    } else {
      db = new SQL.Database()
    }

    const instance = new Db(db)

    // Initialize schema
    instance.initializeSchema()

    // Migrate old JSON data if it exists
    instance.migrateFromJson()

    // Save initial state
    instance.save()

    dbInstance = instance
    return instance
  }

  /**
   * Get the singleton instance (must call init() first)
   */
  static getInstance(): Db {
    if (!dbInstance) {
      throw new Error('Database not initialized. Call Db.init() first.')
    }
    return dbInstance
  }

  /**
   * Save database to disk
   */
  private save(): void {
    const data = this.db.export()
    const buffer = Buffer.from(data)
    writeFileSync(DB_PATH, buffer)
  }

  /**
   * Migrate database from the old project-local location to ~/.lpgp
   */
  private static migrateFromLegacyLocation(): void {
    // If new db already exists, nothing to migrate
    if (existsSync(DB_PATH)) {
      return
    }

    // Check if there's a database in the legacy location
    if (existsSync(LEGACY_DB_PATH)) {
      try {
        // Copy the old database to the new location
        copyFileSync(LEGACY_DB_PATH, DB_PATH)
        console.log(`Migrated database from ${LEGACY_DB_PATH} to ${DB_PATH}`)
      } catch (error) {
        console.error('Failed to migrate database from legacy location:', error)
      }
    }
  }

  private initializeSchema(): void {
    const schema = readFileSync(SCHEMA_PATH, 'utf-8')
    this.db.run(schema)
  }

  private migrateFromJson(): void {
    if (!existsSync(LEGACY_JSON_PATH)) {
      return
    }

    try {
      const fileContent = readFileSync(LEGACY_JSON_PATH, 'utf-8').trim()
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
        const existing = this.db.exec(
          `SELECT id FROM keypair WHERE fingerprint = '${kp.fingerprint.replace(/'/g, "''")}'`
        )
        if (existing.length === 0 || existing[0]?.values.length === 0) {
          this.db.run(
            `INSERT INTO keypair (
              name, email, fingerprint, public_key, private_key, passphrase_protected,
              algorithm, key_size, can_sign, can_encrypt, can_certify, can_authenticate,
              expires_at, revoked, revocation_reason, created_at, updated_at, last_used_at, is_default
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              kp.name,
              kp.email,
              kp.fingerprint,
              kp.public_key,
              kp.private_key,
              boolToInt(kp.passphrase_protected),
              'RSA',
              '4096',
              1,
              1,
              0,
              0,
              null,
              0,
              null,
              kp.created_at,
              kp.updated_at,
              null,
              boolToInt(kp.is_default),
            ]
          )
        }
      }

      // Migrate contacts (with default values for new fields)
      for (const contact of oldData.contact) {
        const existing = this.db.exec(
          `SELECT id FROM contact WHERE fingerprint = '${contact.fingerprint.replace(/'/g, "''")}'`
        )
        if (existing.length === 0 || existing[0]?.values.length === 0) {
          this.db.run(
            `INSERT INTO contact (
              name, email, fingerprint, public_key, algorithm, key_size,
              trusted, last_verified_at, notes, expires_at, revoked, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              contact.name,
              contact.email,
              contact.fingerprint,
              contact.public_key,
              'RSA',
              '4096',
              boolToInt(contact.trusted),
              null,
              contact.notes || null,
              null,
              0,
              contact.created_at,
              contact.updated_at,
            ]
          )
        }
      }

      this.save()
      console.log('Successfully migrated data from JSON to SQLite')
    } catch (error) {
      console.error('Failed to migrate JSON data:', error)
    }
  }

  private queryAll(sql: string, params: SqlValue[] = []): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql)
    if (params.length > 0) {
      stmt.bind(params)
    }

    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push(row as Record<string, unknown>)
    }
    stmt.free()
    return results
  }

  private queryOne(sql: string, params: SqlValue[] = []): Record<string, unknown> | undefined {
    const results = this.queryAll(sql, params)
    return results[0]
  }

  private runSql(sql: string, params: SqlValue[] = []): { lastInsertRowid: number } {
    this.db.run(sql, params)
    const result = this.db.exec('SELECT last_insert_rowid() as id')
    const lastId = result[0]?.values[0]?.[0] as number
    this.save()
    return { lastInsertRowid: lastId }
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
      value: unknown
    }
  }): T extends 'settings' ? Settings : Schema[T] {
    if (table === 'settings') {
      const row = this.queryOne('SELECT * FROM settings WHERE id = 1')
      if (!row) {
        throw new Error('Settings not found')
      }
      // Convert SQLite integers to booleans
      return {
        ...row,
        auto_sign_messages: intToBool(row.auto_sign_messages as number),
        prefer_inline_pgp: intToBool(row.prefer_inline_pgp as number),
      } as T extends 'settings' ? Settings : Schema[T]
    }

    let sql = `SELECT * FROM ${table}`
    const params: SqlValue[] = []

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
        (where.compare === 'like' || where.compare === 'not like'
          ? `%${where.value}%`
          : where.value) as SqlValue
      )
    }

    const rows = this.queryAll(sql, params)

    // Convert SQLite integers to booleans for keypair and contact
    return rows.map((row) => {
      if (table === 'keypair') {
        return {
          ...row,
          passphrase_protected: intToBool(row.passphrase_protected as number),
          can_sign: intToBool(row.can_sign as number),
          can_encrypt: intToBool(row.can_encrypt as number),
          can_certify: intToBool(row.can_certify as number),
          can_authenticate: intToBool(row.can_authenticate as number),
          revoked: intToBool(row.revoked as number),
          is_default: intToBool(row.is_default as number),
        }
      } else if (table === 'contact') {
        return {
          ...row,
          trusted: intToBool(row.trusted as number),
          revoked: intToBool(row.revoked as number),
        }
      }
      return row
    }) as T extends 'settings' ? Settings : Schema[T]
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
      const params: SqlValue[] = []

      for (const [key, val] of Object.entries(updates)) {
        setPairs.push(`${key} = ?`)
        if (typeof val === 'boolean') {
          params.push(boolToInt(val))
        } else {
          params.push(val)
        }
      }

      this.runSql(`UPDATE settings SET ${setPairs.join(', ')} WHERE id = 1`, params)

      return this.select({ table: 'settings' }) as T extends 'settings'
        ? Settings
        : T extends 'keypair'
          ? Keypair
          : Contact
    }

    const now = new Date().toISOString()
    const record = { ...value, created_at: now, updated_at: now } as Record<string, unknown>

    // Convert booleans to integers for SQLite
    if (table === 'keypair') {
      record.passphrase_protected = boolToInt(record.passphrase_protected as boolean)
      record.can_sign = boolToInt((record.can_sign as boolean | undefined) ?? true)
      record.can_encrypt = boolToInt((record.can_encrypt as boolean | undefined) ?? true)
      record.can_certify = boolToInt((record.can_certify as boolean | undefined) ?? false)
      record.can_authenticate = boolToInt((record.can_authenticate as boolean | undefined) ?? false)
      record.revoked = boolToInt((record.revoked as boolean | undefined) ?? false)
      record.is_default = boolToInt((record.is_default as boolean | undefined) ?? false)
    } else if (table === 'contact') {
      record.trusted = boolToInt((record.trusted as boolean | undefined) ?? false)
      record.revoked = boolToInt((record.revoked as boolean | undefined) ?? false)
    }

    const keys = Object.keys(record)
    const placeholders = keys.map(() => '?').join(', ')
    const values = keys.map((k) => record[k]) as SqlValue[]

    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
    const info = this.runSql(sql, values)

    // Fetch and return the inserted record
    const inserted = this.queryOne(`SELECT * FROM ${table} WHERE id = ?`, [info.lastInsertRowid])
    return inserted as T extends 'settings' ? Settings : T extends 'keypair' ? Keypair : Contact
  }

  public update<T extends keyof Schema>(
    table: T,
    where: {
      key: T extends 'settings' ? keyof Settings : keyof Keypair | keyof Contact
      value: unknown
    },
    updates: T extends 'settings'
      ? Partial<Settings>
      : T extends 'keypair'
        ? Partial<Keypair>
        : Partial<Contact>
  ): void {
    const now = new Date().toISOString()
    const record = { ...updates, updated_at: now } as Record<string, unknown>

    // Convert booleans to integers for SQLite
    if (table === 'keypair') {
      if ('passphrase_protected' in record)
        record.passphrase_protected = boolToInt(record.passphrase_protected as boolean)
      if ('can_sign' in record) record.can_sign = boolToInt(record.can_sign as boolean)
      if ('can_encrypt' in record) record.can_encrypt = boolToInt(record.can_encrypt as boolean)
      if ('can_certify' in record) record.can_certify = boolToInt(record.can_certify as boolean)
      if ('can_authenticate' in record)
        record.can_authenticate = boolToInt(record.can_authenticate as boolean)
      if ('revoked' in record) record.revoked = boolToInt(record.revoked as boolean)
      if ('is_default' in record) record.is_default = boolToInt(record.is_default as boolean)
    } else if (table === 'contact') {
      if ('trusted' in record) record.trusted = boolToInt(record.trusted as boolean)
      if ('revoked' in record) record.revoked = boolToInt(record.revoked as boolean)
    } else if (table === 'settings') {
      if ('auto_sign_messages' in record)
        record.auto_sign_messages = boolToInt(record.auto_sign_messages as boolean)
      if ('prefer_inline_pgp' in record)
        record.prefer_inline_pgp = boolToInt(record.prefer_inline_pgp as boolean)
    }

    const setPairs: string[] = []
    const params: SqlValue[] = []

    for (const [key, val] of Object.entries(record)) {
      if (key === 'id') continue // Don't update id
      setPairs.push(`${key} = ?`)
      params.push(val as SqlValue)
    }

    params.push(where.value as SqlValue)

    const sql = `UPDATE ${table} SET ${setPairs.join(', ')} WHERE ${String(where.key)} = ?`
    this.runSql(sql, params)
  }

  public delete<T extends keyof Schema>(
    table: T,
    where: {
      key: T extends 'settings' ? keyof Settings : keyof Keypair | keyof Contact
      value: unknown
    }
  ): void {
    if (table === 'settings') {
      throw new Error('Cannot delete settings row')
    }

    const sql = `DELETE FROM ${table} WHERE ${String(where.key)} = ?`
    this.runSql(sql, [where.value as SqlValue])
  }

  public close(): void {
    this.save()
    this.db.close()
    dbInstance = null
  }
}

// TODO - replace with sqlite, this is temporary for prototyping
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_PATH = join(__dirname, '..', 'db', 'data.json')

// Your own keypairs (you have both public and private keys)
type Keypair = {
  id: number
  name: string // e.g., "Work", "Personal"
  email: string
  fingerprint: string // Unique identifier for the keypair
  public_key: string // Armored public key
  private_key: string // Armored private key
  passphrase_protected: boolean
  created_at: string
  updated_at: string
  is_default: boolean // Which keypair to use by default
}

// Other people's public keys (for encrypting messages to them)
type Contact = {
  id: number
  name: string
  email: string
  fingerprint: string
  public_key: string // Armored public key
  trusted: boolean // Whether you've verified this key
  notes?: string // Optional notes about this contact
  created_at: string
  updated_at: string
}

// App settings
type Settings = {
  id: number
  key: string
  value: string
}

type Schema = {
  keypair: Keypair[]
  contact: Contact[]
  settings: Settings[]
}

export class Database {
  private data: Schema = {
    keypair: [],
    contact: [],
    settings: [],
  }

  constructor() {
    this.readFromDisk()
  }

  public select<T extends keyof Schema>({
    table,
    where,
  }: {
    table: T
    where?: {
      key: keyof Schema[T][number]
      compare: 'is' | 'is not' | 'like' | 'not like'
      value: any
    }
  }): Schema[T] {
    let results = this.data[table]

    if (!where) {
      return results as Schema[T]
    }

    const filtered = results.filter((row) => {
      const rowValue = row[where.key as keyof typeof row] as any
      const compareValue = where.value

      switch (where.compare) {
        case 'is':
          return rowValue === compareValue
        case 'is not':
          return rowValue !== compareValue
        case 'like':
          return (
            typeof rowValue === 'string' &&
            typeof compareValue === 'string' &&
            (rowValue as string).includes(compareValue as string)
          )
        case 'not like':
          return (
            typeof rowValue === 'string' &&
            typeof compareValue === 'string' &&
            !(rowValue as string).includes(compareValue as string)
          )
        default:
          return false
      }
    })

    return filtered as Schema[T]
  }

  public insert<T extends keyof Schema>(
    table: T,
    value: Omit<Schema[T][number], 'id'> & { id?: number }
  ): Schema[T][number] {
    // Auto-generate ID if not provided
    const nextId = this.getNextId(table)
    const record = { ...value, id: value.id ?? nextId } as Schema[T][number]

    this.data[table].push(record as any)
    this.saveToDisk()

    return record
  }

  private getNextId<T extends keyof Schema>(table: T): number {
    const records = this.data[table]
    if (records.length === 0) {
      return 1
    }
    const maxId = Math.max(...records.map((r) => (r as any).id))
    return maxId + 1
  }

  public update<T extends keyof Schema>(
    table: T,
    where: {
      key: keyof Schema[T][number]
      value: any
    },
    updates: Partial<Schema[T][number]>
  ): void {
    const results = this.data[table]
    for (let i = 0; i < results.length; i++) {
      const row = results[i]
      if (row && row[where.key as keyof typeof row] === where.value) {
        this.data[table][i] = { ...row, ...updates } as any
      }
    }
    this.saveToDisk()
  }

  public delete<T extends keyof Schema>(
    table: T,
    where: {
      key: keyof Schema[T][number]
      value: any
    }
  ): void {
    this.data[table] = this.data[table].filter(
      (row) => row[where.key as keyof typeof row] !== where.value
    ) as any
    this.saveToDisk()
  }

  private readFromDisk(): void {
    if (!existsSync(DATA_PATH)) {
      // Create the file with empty schema if it doesn't exist
      this.saveToDisk()
      return
    }

    try {
      const fileContent = readFileSync(DATA_PATH, 'utf-8').trim()

      // Handle empty file
      if (fileContent === '') {
        this.saveToDisk()
        return
      }

      const parsed = JSON.parse(fileContent) as Schema
      this.data = parsed
    } catch (error) {
      console.error('Failed to read database from disk:', error)
      // If the file is corrupted, reinitialize with empty data
      this.data = {
        keypair: [],
        contact: [],
        settings: [],
      }
      this.saveToDisk()
    }
  }

  private saveToDisk(): void {
    try {
      writeFileSync(DATA_PATH, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save database to disk:', error)
    }
  }
}

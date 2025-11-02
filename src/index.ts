import { createServer } from 'http'

// test all db functionality
import { Database } from './db.js'

const db = new Database()

// Example usage (can be removed later)
const contact1 = db.insert('contact', {
  name: 'Alice Smith',
  email: 'alice@example.com',
  fingerprint: 'ABCD1234EFGH5678',
  public_key: '-----BEGIN PGP PUBLIC KEY BLOCK-----\n...\n-----END PGP PUBLIC KEY BLOCK-----',
  trusted: true,
  notes: 'Met at conference 2024',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})
console.log('Inserted contact with ID:', contact1.id)

const contact2 = db.insert('contact', {
  name: 'Bob Jones',
  email: 'bob@example.com',
  fingerprint: 'WXYZ9876ABCD5432',
  public_key: '-----BEGIN PGP PUBLIC KEY BLOCK-----\n...\n-----END PGP PUBLIC KEY BLOCK-----',
  trusted: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})
console.log('Inserted contact with ID:', contact2.id)

let contacts = db.select({ table: 'contact' })
console.log('All contacts:', contacts)

// db.delete('contact', { key: 'id', value: 1 })

// contacts = db.select({ table: 'contact' })
// console.log('Contacts after deletion:', contacts)

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('This is currently a placeholder server. Use pnpm pgp instead.')
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

// Graceful shutdown on restart
process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

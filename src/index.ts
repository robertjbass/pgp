import { createServer } from 'http'

// test all db functionality
import { Db } from './db.js'

const db = new Db()

// Example usage - test database operations
console.log('\n=== Testing Database Operations ===\n')

// Test SELECT
const contacts = db.select({ table: 'contact' })
console.log('All contacts:', contacts)

// Test SELECT with WHERE clause
const aliceContacts = db.select({
  table: 'contact',
  where: { key: 'name', compare: 'like', value: 'Alice' },
})
console.log('\nContacts matching "Alice":', aliceContacts)

// Test UPDATE
if (contacts.length > 0 && contacts[0]) {
  console.log('\nUpdating first contact to trusted...')
  db.update('contact', { key: 'id', value: contacts[0].id }, { trusted: true })
  const updated = db.select({ table: 'contact', where: { key: 'id', compare: 'is', value: contacts[0].id } })
  console.log('Updated contact:', updated[0])
}

// Test Settings
const settings = db.select({ table: 'settings' })
console.log('\nCurrent settings:', settings)

console.log('\n=== Database Tests Complete ===\n')

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

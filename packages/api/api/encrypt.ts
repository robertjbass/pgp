import type { VercelRequest, VercelResponse } from '@vercel/node'
import { encryptMessage } from '@pgp/shared'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method === 'GET') {
    return res.status(200).send('PGP Encryption API is running.')
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Handle both JSON and form-encoded data
    let publicKey: string
    let message: string

    if (req.headers['content-type']?.includes('application/json')) {
      publicKey = req.body.publicKey
      message = req.body.message
    } else {
      // Form-encoded data
      publicKey = req.body.publicKey
      message = req.body.message
    }

    if (!publicKey || !message) {
      return res.status(400).json({ error: 'Missing publicKey or message' })
    }

    const encrypted = await encryptMessage(message, publicKey)

    res.setHeader('Content-Type', 'text/plain')
    return res.status(200).send(encrypted)
  } catch (error) {
    console.error('Encryption error:', error)
    return res.status(500).json({
      error: 'Encryption failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

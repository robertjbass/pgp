#!/usr/bin/env node
import * as openpgp from 'openpgp'
import inquirer from 'inquirer'
import chalk from 'chalk'
import { execSync } from 'child_process'
import * as readline from 'readline'
import { stdin as input, stdout as output } from 'process'
import clipboardy from 'clipboardy'
import { Db } from './db.js'
import { KeyManager } from './key-manager.js'
import { extractPublicKeyInfo } from './key-utils.js'

// Config to allow weak keys like DSA (not recommended for production)
const weakKeyConfig = { rejectPublicKeyAlgorithms: new Set() }

// Initialize database and key manager
const db = new Db()
const keyManager = new KeyManager(db)

// Session passphrase cache - stores passphrases by keypair ID
const passphraseCache = new Map<number, string>()

interface EditorChoice {
  name: string
  command: string
  available: boolean
}

async function encryptMessage(message: string, publicKeysArmored?: string | string[]): Promise<string> {
  let publicKeys: openpgp.PublicKey[]

  if (publicKeysArmored) {
    // Use provided public key(s)
    const keysArray = Array.isArray(publicKeysArmored) ? publicKeysArmored : [publicKeysArmored]
    publicKeys = await Promise.all(
      keysArray.map((key) => openpgp.readKey({ armoredKey: key, config: weakKeyConfig }))
    )
  } else {
    // Use default keypair's public key (encrypt to self)
    const defaultKeypair = await keyManager.getDefaultKeypair()
    if (!defaultKeypair) {
      throw new Error('No default keypair found. Please set up a keypair first.')
    }
    publicKeys = [await openpgp.readKey({ armoredKey: defaultKeypair.public_key, config: weakKeyConfig })]

    // Update last_used_at
    db.update('keypair', { key: 'id', value: defaultKeypair.id }, { last_used_at: new Date().toISOString() })
  }

  const encrypted = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: message }),
    encryptionKeys: publicKeys,
    config: weakKeyConfig,
  })

  return encrypted as string
}

async function decryptMessage(encryptedMessage: string): Promise<string> {
  const defaultKeypair = await keyManager.getDefaultKeypair()
  if (!defaultKeypair) {
    throw new Error('No default keypair found. Please set up a keypair first.')
  }

  // Check if passphrase is cached for this keypair
  let passphrase = ''
  if (defaultKeypair.passphrase_protected) {
    if (passphraseCache.has(defaultKeypair.id)) {
      // Use cached passphrase
      passphrase = passphraseCache.get(defaultKeypair.id)!
    } else {
      // Prompt for passphrase and cache it
      const { passphraseInput } = await inquirer.prompt([
        {
          type: 'password',
          name: 'passphraseInput',
          message: chalk.yellow('Enter your private key passphrase:'),
          mask: '*',
        },
      ])
      passphrase = passphraseInput

      // Validate the passphrase by attempting to decrypt the key
      try {
        await openpgp.decryptKey({
          privateKey: await openpgp.readPrivateKey({ armoredKey: defaultKeypair.private_key, config: weakKeyConfig }),
          passphrase,
        })
        // If successful, cache the passphrase
        passphraseCache.set(defaultKeypair.id, passphrase)
      } catch (error) {
        throw new Error('Incorrect passphrase')
      }
    }
  }

  const privateKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: defaultKeypair.private_key, config: weakKeyConfig }),
    passphrase,
  })

  const message = await openpgp.readMessage({
    armoredMessage: encryptedMessage,
  })

  const { data: decrypted } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
  })

  // Update last_used_at
  db.update('keypair', { key: 'id', value: defaultKeypair.id }, { last_used_at: new Date().toISOString() })

  return decrypted as string
}

function checkEditorAvailable(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function detectAvailableEditors(): EditorChoice[] {
  const editors: EditorChoice[] = [
    { name: 'VS Code', command: 'code', available: false },
    { name: 'Neovim', command: 'nvim', available: false },
    { name: 'Vim', command: 'vim', available: false },
    { name: 'Nano', command: 'nano', available: false },
    { name: 'Emacs', command: 'emacs', available: false },
  ]

  // Check platform specific editors
  if (process.platform === 'darwin') {
    editors.push({ name: 'TextEdit', command: 'open -e', available: true })
  } else if (process.platform === 'win32') {
    editors.push({ name: 'Notepad', command: 'notepad', available: true })
  }

  // Check which editors are available
  for (const editor of editors) {
    if (editor.command.includes('open -e') || editor.command === 'notepad') {
      editor.available = true // TextEdit and Notepad are always available on their platforms
    } else {
      editor.available = checkEditorAvailable(editor.command)
    }
  }

  return editors.filter((e) => e.available)
}

async function readInlineMultilineInput(promptText: string): Promise<string> {
  console.log(chalk.yellow(promptText))
  console.log(
    chalk.gray('(Type your message. Press Enter, then Ctrl+D to finish)\n')
  )

  const rl = readline.createInterface({ input, output })
  const lines: string[] = []

  return new Promise((resolve) => {
    rl.on('line', (line) => {
      lines.push(line)
    })

    rl.on('close', () => {
      resolve(lines.join('\n'))
    })
  })
}

type Recipient = {
  name: string
  publicKey: string
}

function extractAllPublicKeys(content: string): string[] {
  const keyRegex = /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/g
  const matches = content.match(keyRegex)
  return matches || []
}

async function addKeysFromClipboard(recipients: Recipient[]): Promise<number> {
  let clipboardContent = ''
  try {
    clipboardContent = await clipboardy.read()
  } catch {
    console.log(chalk.yellow('Could not access clipboard'))
    return 0
  }

  const keys = extractAllPublicKeys(clipboardContent)
  if (keys.length === 0) {
    console.log(chalk.yellow('No public keys found in clipboard'))
    return 0
  }

  let addedCount = 0
  for (const publicKey of keys) {
    try {
      // Validate the key
      await openpgp.readKey({ armoredKey: publicKey, config: weakKeyConfig })
      const keyInfo = await extractPublicKeyInfo(publicKey)
      const recipientName = keyInfo.email || keyInfo.fingerprint?.slice(-8) || 'Unknown'

      // Check for duplicates
      const isDuplicate = recipients.some((r) => r.publicKey === publicKey)
      if (isDuplicate) {
        console.log(chalk.yellow(`⚠ Skipping duplicate key: ${recipientName}`))
        continue
      }

      recipients.push({
        name: recipientName,
        publicKey,
      })
      console.log(chalk.green(`✓ Added recipient: ${recipientName}`))
      addedCount++
    } catch (error) {
      console.log(chalk.red(`✗ Failed to parse a key: ${error instanceof Error ? error.message : 'unknown error'}`))
    }
  }

  return addedCount
}

async function selectMultipleRecipients(): Promise<Recipient[]> {
  const recipients: Recipient[] = []
  const contacts = db.select({ table: 'contact' })
  const defaultKeypair = await keyManager.getDefaultKeypair()

  // Build the menu choices
  function buildChoices() {
    const choices: Array<{ name: string; value: string }> = []

    // Show current recipients count
    if (recipients.length > 0) {
      choices.push({
        name: chalk.cyan(`── Current recipients: ${recipients.length} ──`),
        value: 'show-recipients',
      })
    }

    // Option to add self (if not already added)
    const selfAdded = recipients.some((r) => r.name === 'Myself')
    if (defaultKeypair && !selfAdded) {
      choices.push({
        name: '🔑 Add myself (so I can also decrypt)',
        value: 'self',
      })
    }

    // Option to select from contacts
    if (contacts.length > 0) {
      choices.push({
        name: `👥 Select from saved contacts (${contacts.length} available)`,
        value: 'contacts',
      })
    }

    // Clipboard and manual options
    choices.push({
      name: '📋 Paste from clipboard (supports multiple keys)',
      value: 'clipboard',
    })
    choices.push({
      name: '⌨️  Type/paste a single key',
      value: 'manual',
    })

    // Done or cancel
    choices.push({
      name: recipients.length > 0 ? '✓ Done adding recipients' : '← Cancel',
      value: 'done',
    })

    return choices
  }

  let addMore = true
  while (addMore) {
    const { addMethod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'addMethod',
        message: chalk.yellow('Add recipients:'),
        choices: buildChoices(),
      },
    ])

    if (addMethod === 'done') {
      addMore = false
    } else if (addMethod === 'show-recipients') {
      // Show current recipients
      console.log(chalk.cyan('\nCurrent recipients:'))
      for (const r of recipients) {
        console.log(chalk.gray(`   • ${r.name}`))
      }
      console.log()
    } else if (addMethod === 'self') {
      if (defaultKeypair) {
        recipients.push({
          name: 'Myself',
          publicKey: defaultKeypair.public_key,
        })
        console.log(chalk.green('✓ Added yourself as a recipient'))
      }
    } else if (addMethod === 'contacts') {
      // Show contacts as a checkbox
      const { selectedContacts } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedContacts',
          message: chalk.yellow('Select contacts (space to toggle, enter to confirm):'),
          choices: contacts.map((c) => {
            const alreadyAdded = recipients.some((r) => r.publicKey === c.public_key)
            return {
              name: `${c.name} <${c.email || 'no email'}>${alreadyAdded ? chalk.gray(' (already added)') : ''}`,
              value: c.id,
              checked: false,
              disabled: alreadyAdded,
            }
          }),
        },
      ])

      let addedCount = 0
      for (const contactId of selectedContacts) {
        const contact = contacts.find((c) => c.id === contactId)
        if (contact) {
          recipients.push({
            name: `${contact.name} <${contact.email || 'no email'}>`,
            publicKey: contact.public_key,
          })
          addedCount++
        }
      }
      if (addedCount > 0) {
        console.log(chalk.green(`✓ Added ${addedCount} contact${addedCount > 1 ? 's' : ''}`))
      }
    } else if (addMethod === 'clipboard') {
      const added = await addKeysFromClipboard(recipients)
      if (added > 0) {
        console.log(chalk.green(`\n✓ Added ${added} recipient${added > 1 ? 's' : ''} from clipboard\n`))
      }
    } else if (addMethod === 'manual') {
      const publicKey = await getRecipientPublicKey()
      if (publicKey) {
        try {
          const keyInfo = await extractPublicKeyInfo(publicKey)
          const recipientName = keyInfo.email || keyInfo.fingerprint?.slice(-8) || 'Unknown'

          // Check for duplicates
          const isDuplicate = recipients.some((r) => r.publicKey === publicKey)
          if (isDuplicate) {
            console.log(chalk.yellow(`⚠ This recipient is already in the list`))
          } else {
            recipients.push({
              name: recipientName,
              publicKey,
            })
            console.log(chalk.green(`✓ Added recipient: ${recipientName}`))
          }
        } catch (error) {
          console.log(chalk.red('Failed to parse public key'))
        }
      }
    }
  }

  return recipients
}

async function getRecipientPublicKey(): Promise<string | null> {
  // Check clipboard for public key
  let clipboardContent = ''
  let hasPublicKeyInClipboard = false

  try {
    clipboardContent = await clipboardy.read()
    hasPublicKeyInClipboard = clipboardContent.includes('BEGIN PGP PUBLIC KEY BLOCK')
  } catch (e) {
    // Clipboard not available, continue without it
  }

  let publicKey = ''

  // If public key found in clipboard, ask if user wants to use it
  if (hasPublicKeyInClipboard) {
    const { useClipboard } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useClipboard',
        message: 'Public key detected in clipboard. Use it?',
        default: true,
      },
    ])

    if (useClipboard) {
      const publicMatch = clipboardContent.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/)
      if (publicMatch) {
        publicKey = publicMatch[0]
      }
    }
  }

  // If no key from clipboard, prompt for input
  if (!publicKey) {
    console.log(chalk.yellow('\nPaste the recipient\'s PGP PUBLIC key:'))
    console.log(chalk.gray('(Press Enter to finish, or press Enter then Ctrl+D)\n'))

    const rl = readline.createInterface({ input, output })
    const lines: string[] = []

    publicKey = await new Promise((resolve) => {
      rl.on('line', (line: string) => {
        lines.push(line)
        const content = lines.join('\n')

        // Check if we have a complete key block and current line is empty
        if (line.trim() === '' &&
            content.includes('-----BEGIN PGP PUBLIC KEY BLOCK') &&
            content.includes('-----END PGP PUBLIC KEY BLOCK')) {
          rl.close()
          resolve(content.trim())
        }
      })

      rl.on('close', () => {
        resolve(lines.join('\n'))
      })
    })
  }

  // Validate public key format
  if (!publicKey.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
    console.log(chalk.red('\n❌ Invalid public key format\n'))
    return null
  }

  // Try to read the key to validate it
  try {
    await openpgp.readKey({ armoredKey: publicKey, config: weakKeyConfig })
    console.log(chalk.green('\n✓ Valid public key\n'))
    return publicKey
  } catch (error) {
    console.log(chalk.red('\n❌ Failed to read public key:', error instanceof Error ? error.message : error))
    return null
  }
}

function printBanner() {
  console.clear()
  console.log(chalk.cyan.bold('\n╔════════════════════════════════════════╗'))
  console.log(chalk.cyan.bold('║      🔐  Layerbase PGP Tool           ║'))
  console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'))
}

function clearPassphraseCache() {
  // Clear all cached passphrases from memory
  passphraseCache.clear()
}

async function main() {
  printBanner()

  // Check for default keypair on first run
  const hasKeypair = await keyManager.hasDefaultKeypair()
  if (!hasKeypair) {
    console.log(chalk.yellow('\n⚠️  No keypair found. Let\'s set up your first keypair.\n'))
    await keyManager.setupFirstKeypair()
    console.log(chalk.green('\n✅ Setup complete! You can now use the tool.\n'))
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: chalk.yellow('What would you like to do?'),
      choices: [
        {
          name: '🔒 Encrypt a message',
          value: 'encrypt',
        },
        {
          name: '🔓 Decrypt a message',
          value: 'decrypt',
        },
        {
          name: '🔑 Manage keys',
          value: 'keys',
        },
        {
          name: '👋 Exit',
          value: 'exit',
        },
      ],
    },
  ])

  if (action === 'exit') {
    clearPassphraseCache()
    console.clear()
    process.exit(0)
  }

  if (action === 'keys') {
    await keyManager.showKeyManagementMenu()
    return main()
  }

  if (action === 'encrypt') {
    try {
      // Ask who to encrypt for
      const { recipient } = await inquirer.prompt([
        {
          type: 'list',
          name: 'recipient',
          message: chalk.yellow('Who do you want to encrypt this message for?'),
          choices: [
            {
              name: '🔑 Myself (use my public key)',
              value: 'self',
            },
            {
              name: '👤 Someone else (use their public key)',
              value: 'other',
            },
            {
              name: '👥 Multiple recipients',
              value: 'multiple',
            },
            {
              name: '← Back to main menu',
              value: 'back',
            },
          ],
        },
      ])

      if (recipient === 'back') {
        return main()
      }

      // Note: No 'main-menu' option here since 'back' already goes to main menu

      let recipientPublicKeys: string[] = []
      let recipientNames: string[] = []
      let isNewContact = false

      // Handle multiple recipients
      if (recipient === 'multiple') {
        const recipients = await selectMultipleRecipients()
        if (recipients.length === 0) {
          console.log(chalk.red('\n❌ No recipients selected. Aborting.\n'))
          return main()
        }
        recipientPublicKeys = recipients.map((r) => r.publicKey)
        recipientNames = recipients.map((r) => r.name)

        // Show summary
        console.log(chalk.cyan('\n📬 Encrypting for the following recipients:'))
        for (const name of recipientNames) {
          console.log(chalk.gray(`   • ${name}`))
        }
        console.log()
      } else if (recipient === 'other') {
        // Check if there are any saved contacts
        const contacts = db.select({ table: 'contact' })

        if (contacts.length > 0) {
          // Offer saved contacts or new key
          const contactChoices: Array<{ name: string; value: number | string }> = contacts.map((c) => ({
            name: `${c.name} <${c.email}>`,
            value: c.id,
          }))
          contactChoices.push(
            { name: '➕ Use a new public key', value: 'new' },
            { name: '← Back', value: 'back' },
            { name: '🏠 Main menu', value: 'main-menu' }
          )

          const { contactChoice } = await inquirer.prompt([
            {
              type: 'list',
              name: 'contactChoice',
              message: chalk.yellow('Select a contact or enter a new key:'),
              choices: contactChoices,
            },
          ])

          if (contactChoice === 'back') {
            // Go back to recipient selection - re-run encrypt flow
            return main()
          }

          if (contactChoice === 'main-menu') {
            return main()
          }

          if (contactChoice === 'new') {
            const publicKey = await getRecipientPublicKey()
            if (!publicKey) {
              console.log(chalk.red('\n❌ Could not get recipient public key. Aborting.\n'))
              return main()
            }
            recipientPublicKeys = [publicKey]
            isNewContact = true
          } else {
            // Use saved contact
            const selectedContact = contacts.find((c) => c.id === contactChoice)
            if (selectedContact) {
              recipientPublicKeys = [selectedContact.public_key]
            }
          }
        } else {
          // No saved contacts, get new key
          const publicKey = await getRecipientPublicKey()
          if (!publicKey) {
            console.log(chalk.red('\n❌ Could not get recipient public key. Aborting.\n'))
            return main()
          }
          recipientPublicKeys = [publicKey]
          isNewContact = true
        }
      }

      // Detect available editors
      const availableEditors = detectAvailableEditors()

      // Ask for input method
      const inputChoices: any[] = []

      // Always add clipboard option first
      inputChoices.push({
        name: '📋 Paste from clipboard',
        value: 'clipboard',
      })

      if (availableEditors.length > 0) {
        inputChoices.push(
          {
            name: '📝 Use an editor',
            value: 'editor',
          },
          {
            name: '⌨️  Type inline (Enter, then Ctrl+D to finish)',
            value: 'inline',
          }
        )
      } else {
        inputChoices.push({
          name: '⌨️  Type inline (Enter, then Ctrl+D to finish)',
          value: 'inline',
        })
      }

      // Add back option
      inputChoices.push({
        name: '← Back',
        value: 'back',
      })

      // Add main menu option
      inputChoices.push({
        name: '🏠 Main menu',
        value: 'main-menu',
      })

      const { inputMethod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'inputMethod',
          message: chalk.yellow('How would you like to enter your message?'),
          choices: inputChoices,
        },
      ])

      if (inputMethod === 'back') {
        // Go back to recipient selection
        return main()
      }

      if (inputMethod === 'main-menu') {
        return main()
      }

      let message: string

      if (inputMethod === 'clipboard') {
        try {
          message = await clipboardy.read()
          if (!message || message.trim() === '') {
            console.log(chalk.red('\n❌ Clipboard is empty.\n'))
            return main()
          }
          console.log(chalk.green('\n✓ Message loaded from clipboard\n'))
        } catch (clipError) {
          console.log(
            chalk.red('\n❌ Failed to read from clipboard:', clipError)
          )
          return main()
        }
      } else if (inputMethod === 'editor') {
        // Let user choose editor
        const { selectedEditor } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedEditor',
            message: chalk.yellow('Choose your editor:'),
            choices: availableEditors.map((e) => ({
              name: e.name,
              value: e.command,
            })),
          },
        ])

        // Set the EDITOR environment variable before opening inquirer editor
        const originalEditor = process.env.EDITOR
        const originalVisual = process.env.VISUAL
        process.env.EDITOR = selectedEditor
        process.env.VISUAL = selectedEditor

        try {
          const { editorInput } = await inquirer.prompt([
            {
              type: 'editor',
              name: 'editorInput',
              message: chalk.yellow(
                `Press Enter to open ${availableEditors.find((e) => e.command === selectedEditor)?.name}:`
              ),
              postfix: '.txt',
              waitForUseInput: false,
            },
          ])

          message = editorInput
        } finally {
          // Restore original environment variables
          if (originalEditor !== undefined) {
            process.env.EDITOR = originalEditor
          } else {
            delete process.env.EDITOR
          }
          if (originalVisual !== undefined) {
            process.env.VISUAL = originalVisual
          } else {
            delete process.env.VISUAL
          }
        }
      } else {
        message = await readInlineMultilineInput('Enter your message:')
      }

      if (!message || message.trim() === '') {
        console.log(chalk.red('\n❌ No message provided. Aborting.\n'))
        return main()
      }

      console.log(chalk.blue('\n⏳ Encrypting message...\n'))
      const encrypted = await encryptMessage(message, recipientPublicKeys.length > 0 ? recipientPublicKeys : undefined)

      console.log(chalk.green.bold('✅ Encrypted Message:\n'))
      console.log(chalk.gray('─'.repeat(50)))
      console.log(chalk.white(encrypted))
      console.log(chalk.gray('─'.repeat(50)))

      // Copy to clipboard
      try {
        await clipboardy.write(encrypted)
        console.log(chalk.green('\n📋 Copied to clipboard!\n'))
      } catch (clipError) {
        console.log(
          chalk.yellow('\n⚠️  Could not copy to clipboard automatically\n')
        )
      }

      // Offer to save the contact if it's a new public key (single recipient only)
      const newPublicKey = recipientPublicKeys[0]
      if (isNewContact && newPublicKey !== undefined && recipientPublicKeys.length === 1) {
        const { saveContact } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'saveContact',
            message: chalk.yellow('Would you like to save this contact for future use?'),
            default: true,
          },
        ])

        if (saveContact) {
          try {
            // Extract key information
            const keyInfo = await extractPublicKeyInfo(newPublicKey)

            // Prompt for contact name
            const defaultName = (keyInfo.email || 'unknown').split('@')[0] || 'Contact'
            const answers = await inquirer.prompt([
              {
                type: 'input',
                name: 'contactName',
                message: 'Contact name:',
                default: defaultName,
                validate: (input: string) => input.trim().length > 0 || 'Name cannot be empty',
              },
            ])
            const contactName = answers.contactName as string

            // Check if contact already exists by fingerprint
            const existingContacts = db.select({
              table: 'contact',
              where: { key: 'fingerprint', compare: 'is', value: keyInfo.fingerprint },
            })

            if (existingContacts.length > 0) {
              console.log(chalk.yellow('\n⚠️  This contact already exists.\n'))
            } else {
              // Save the contact
              db.insert('contact', {
                name: contactName.trim(),
                email: keyInfo.email,
                fingerprint: keyInfo.fingerprint,
                public_key: newPublicKey,
                algorithm: keyInfo.algorithm,
                key_size: keyInfo.keySize,
                trusted: false,
                last_verified_at: null,
                notes: null,
                expires_at: keyInfo.expiresAt,
                revoked: false,
              })

              console.log(chalk.green(`\n✓ Contact "${contactName}" saved successfully!\n`))
            }
          } catch (error) {
            console.log(
              chalk.red('\n❌ Failed to save contact:'),
              error instanceof Error ? error.message : error
            )
          }
        }
      }
    } catch (error) {
      console.log(
        chalk.red(
          '\n❌ Encryption failed:',
          error instanceof Error ? error.message : error
        )
      )
    }
  } else if (action === 'decrypt') {
    try {
      // Detect available editors
      const availableEditors = detectAvailableEditors()

      // Ask for input method
      const inputChoices: any[] = []

      // Always add clipboard option first
      inputChoices.push({
        name: '📋 Paste from clipboard',
        value: 'clipboard',
      })

      if (availableEditors.length > 0) {
        inputChoices.push(
          {
            name: '📝 Use an editor',
            value: 'editor',
          },
          {
            name: '⌨️  Type inline (Enter, then Ctrl+D to finish)',
            value: 'inline',
          }
        )
      } else {
        inputChoices.push({
          name: '⌨️  Type inline (Enter, then Ctrl+D to finish)',
          value: 'inline',
        })
      }

      // Add back option (for decrypt, back goes to main menu since there's no prior submenu)
      inputChoices.push({
        name: '← Back to main menu',
        value: 'back',
      })

      // Add main menu option
      inputChoices.push({
        name: '🏠 Main menu',
        value: 'main-menu',
      })

      const { inputMethod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'inputMethod',
          message: chalk.yellow(
            'How would you like to enter the encrypted message?'
          ),
          choices: inputChoices,
        },
      ])

      if (inputMethod === 'back' || inputMethod === 'main-menu') {
        return main()
      }

      let encrypted: string

      if (inputMethod === 'clipboard') {
        try {
          encrypted = await clipboardy.read()
          if (!encrypted || encrypted.trim() === '') {
            console.log(chalk.red('\n❌ Clipboard is empty.\n'))
            return main()
          }
          console.log(chalk.green('\n✓ Encrypted message loaded from clipboard\n'))
        } catch (clipError) {
          console.log(
            chalk.red('\n❌ Failed to read from clipboard:', clipError)
          )
          return main()
        }
      } else if (inputMethod === 'editor') {
        // Let user choose editor
        const { selectedEditor } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedEditor',
            message: chalk.yellow('Choose your editor:'),
            choices: availableEditors.map((e) => ({
              name: e.name,
              value: e.command,
            })),
          },
        ])

        // Set the EDITOR environment variable before opening inquirer editor
        const originalEditor = process.env.EDITOR
        const originalVisual = process.env.VISUAL
        process.env.EDITOR = selectedEditor
        process.env.VISUAL = selectedEditor

        try {
          const { editorInput } = await inquirer.prompt([
            {
              type: 'editor',
              name: 'editorInput',
              message: chalk.yellow(
                `Press Enter to open ${availableEditors.find((e) => e.command === selectedEditor)?.name}:`
              ),
              postfix: '.txt',
              waitForUseInput: false,
            },
          ])

          encrypted = editorInput
        } finally {
          // Restore original environment variables
          if (originalEditor !== undefined) {
            process.env.EDITOR = originalEditor
          } else {
            delete process.env.EDITOR
          }
          if (originalVisual !== undefined) {
            process.env.VISUAL = originalVisual
          } else {
            delete process.env.VISUAL
          }
        }
      } else {
        encrypted = await readInlineMultilineInput(
          'Paste the encrypted message:'
        )
      }

      if (!encrypted || encrypted.trim() === '') {
        console.log(chalk.red('\n❌ No encrypted message provided. Aborting.\n'))
        return main()
      }

      console.log(chalk.blue('\n⏳ Decrypting message...\n'))
      const decrypted = await decryptMessage(encrypted)

      console.log(chalk.green.bold('✅ Decrypted Message:\n'))
      console.log(chalk.gray('─'.repeat(50)))
      console.log(chalk.white(decrypted))
      console.log(chalk.gray('─'.repeat(50)))

      // Copy to clipboard
      try {
        await clipboardy.write(decrypted)
        console.log(chalk.green('\n📋 Copied to clipboard!\n'))
      } catch (clipError) {
        console.log(
          chalk.yellow('\n⚠️  Could not copy to clipboard automatically\n')
        )
      }

      // Wait for user to press Enter before continuing
      await inquirer.prompt([
        {
          type: 'input',
          name: 'continue',
          message: chalk.cyan('Press Enter to continue...'),
        },
      ])
    } catch (error) {
      console.log(
        chalk.red(
          '\n❌ Decryption failed:',
          error instanceof Error ? error.message : error
        )
      )
    }
  }

  // Ask if user wants to continue
  const { nextAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'nextAction',
      message: chalk.yellow('What would you like to do next?'),
      choices: [
        {
          name: '🔄 Perform another operation',
          value: 'continue',
        },
        {
          name: '👋 Exit',
          value: 'exit',
        },
      ],
    },
  ])

  if (nextAction === 'continue') {
    await main()
  } else {
    clearPassphraseCache()
    console.clear()
  }
}

// Graceful exit on Ctrl+C
process.on('SIGINT', () => {
  clearPassphraseCache()
  console.clear()
  process.exit(0)
})

main().catch((error) => {
  // Handle Ctrl+C gracefully (inquirer throws ExitPromptError)
  if (error.message && error.message.includes('force closed the prompt')) {
    clearPassphraseCache()
    console.clear()
    process.exit(0)
  }

  clearPassphraseCache()
  console.clear()
  console.error(chalk.red('\n❌ Error:'), error.message || error)
  process.exit(1)
})

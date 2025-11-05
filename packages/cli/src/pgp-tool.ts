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

async function encryptMessage(message: string, publicKeyArmored?: string): Promise<string> {
  let publicKey: openpgp.PublicKey

  if (publicKeyArmored) {
    // Use provided public key (someone else's key)
    publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored })
  } else {
    // Use default keypair's public key (encrypt to self)
    const defaultKeypair = await keyManager.getDefaultKeypair()
    if (!defaultKeypair) {
      throw new Error('No default keypair found. Please set up a keypair first.')
    }
    publicKey = await openpgp.readKey({ armoredKey: defaultKeypair.public_key })

    // Update last_used_at
    db.update('keypair', { key: 'id', value: defaultKeypair.id }, { last_used_at: new Date().toISOString() })
  }

  const encrypted = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: message }),
    encryptionKeys: publicKey,
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
          privateKey: await openpgp.readPrivateKey({ armoredKey: defaultKeypair.private_key }),
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
    privateKey: await openpgp.readPrivateKey({ armoredKey: defaultKeypair.private_key }),
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
    await openpgp.readKey({ armoredKey: publicKey })
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
    console.log(chalk.green('\n✨ Goodbye!\n'))
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
              name: '← Back to main menu',
              value: 'back',
            },
          ],
        },
      ])

      if (recipient === 'back') {
        return main()
      }

      let recipientPublicKey: string | undefined

      // If encrypting for someone else, get their public key
      if (recipient === 'other') {
        const publicKey = await getRecipientPublicKey()
        if (!publicKey) {
          console.log(chalk.red('\n❌ Could not get recipient public key. Aborting.\n'))
          return main()
        }
        recipientPublicKey = publicKey
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

      // Add back to main menu option
      inputChoices.push({
        name: '← Back to main menu',
        value: 'back',
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
      const encrypted = await encryptMessage(message, recipientPublicKey)

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

      // Add back to main menu option
      inputChoices.push({
        name: '← Back to main menu',
        value: 'back',
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

      if (inputMethod === 'back') {
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
    console.log(chalk.green('\n✨ Goodbye!\n'))
  }
}

// Graceful exit on Ctrl+C
process.on('SIGINT', () => {
  clearPassphraseCache()
  console.log(chalk.green('\n\n👋 Goodbye!\n'))
  process.exit(0)
})

main().catch((error) => {
  // Handle Ctrl+C gracefully (inquirer throws ExitPromptError)
  if (error.message && error.message.includes('force closed the prompt')) {
    clearPassphraseCache()
    console.log(chalk.green('\n👋 Goodbye!\n'))
    process.exit(0)
  }

  clearPassphraseCache()
  console.error(chalk.red('\n❌ Error:'), error.message || error)
  process.exit(1)
})

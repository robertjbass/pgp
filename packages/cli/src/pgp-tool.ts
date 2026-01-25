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
import {
  escapeablePrompt,
  enableGlobalEscape,
  checkAndResetEscape,
  EscapeError,
} from './prompts.js'
import {
  getStoredPassphrase,
  storePassphrase,
  hasStoredPassphrase,
} from './keychain.js'
import {
  colors,
  icons,
  printBanner,
  printDivider,
  showSuccess,
  showError,
  showWarning,
  showLoading,
  promptMessage,
  mainMenuChoice,
  backChoice,
  exitChoice,
  cancelChoice,
} from './ui.js'

// Config to allow weak keys like DSA (not recommended for production)
const weakKeyConfig = {
  rejectPublicKeyAlgorithms: new Set(),
  rejectHashAlgorithms: new Set(),
  rejectMessageHashAlgorithms: new Set(),
  rejectCurves: new Set(),
}

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
      // Use session-cached passphrase
      passphrase = passphraseCache.get(defaultKeypair.id)!
    } else {
      // Check if passphrase is stored in system keychain
      const storedPassphrase = await getStoredPassphrase(defaultKeypair.fingerprint)
      if (storedPassphrase) {
        // Validate the stored passphrase
        try {
          await openpgp.decryptKey({
            privateKey: await openpgp.readPrivateKey({ armoredKey: defaultKeypair.private_key, config: weakKeyConfig }),
            passphrase: storedPassphrase,
            config: weakKeyConfig,
          })
          // Stored passphrase is valid, use it
          passphrase = storedPassphrase
          passphraseCache.set(defaultKeypair.id, passphrase)
          console.log(colors.muted('Using passphrase from system keychain'))
        } catch {
          // Stored passphrase is invalid (key may have changed), prompt for new one
          showWarning('Stored passphrase is invalid. Please enter your passphrase.')
        }
      }

      // If we still don't have a valid passphrase, prompt for it
      if (!passphrase) {
        const { passphraseInput } = await escapeablePrompt([
          {
            type: 'password',
            name: 'passphraseInput',
            message: promptMessage('Enter your private key passphrase:'),
            mask: '*',
          },
        ])
        passphrase = passphraseInput

        // Validate the passphrase by attempting to decrypt the key
        try {
          await openpgp.decryptKey({
            privateKey: await openpgp.readPrivateKey({ armoredKey: defaultKeypair.private_key, config: weakKeyConfig }),
            passphrase,
            config: weakKeyConfig,
          })
          // If successful, cache the passphrase in session
          passphraseCache.set(defaultKeypair.id, passphrase)

          // Ask if user wants to save passphrase to system keychain
          const alreadyStored = await hasStoredPassphrase(defaultKeypair.fingerprint)
          if (!alreadyStored) {
            const { saveToKeychain } = await escapeablePrompt([
              {
                type: 'confirm',
                name: 'saveToKeychain',
                message: promptMessage('Save passphrase to system keychain?'),
                default: false,
              },
            ])

            if (saveToKeychain) {
              const saved = await storePassphrase(defaultKeypair.fingerprint, passphrase)
              if (saved) {
                showSuccess('Passphrase saved to system keychain')
              } else {
                showWarning('Could not save to keychain (may not be available on this system)')
              }
            }
          }
        } catch (error) {
          throw new Error('Incorrect passphrase')
        }
      }
    }
  }

  const privateKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: defaultKeypair.private_key, config: weakKeyConfig }),
    passphrase,
    config: weakKeyConfig,
  })

  const message = await openpgp.readMessage({
    armoredMessage: encryptedMessage,
  })

  const { data: decrypted } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    config: weakKeyConfig,
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
  console.log(promptMessage(promptText))
  console.log(colors.muted('(Type your message. Press Enter, then Ctrl+D to finish)\n'))

  const rl = readline.createInterface({ input, output })
  rl.setPrompt('')
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
    showWarning('Could not access clipboard')
    return 0
  }

  const keys = extractAllPublicKeys(clipboardContent)
  if (keys.length === 0) {
    showWarning('No public keys found in clipboard')
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
        showWarning(`Skipping duplicate key: ${recipientName}`)
        continue
      }

      recipients.push({
        name: recipientName,
        publicKey,
      })
      showSuccess(`Added recipient: ${recipientName}`)
      addedCount++
    } catch (error) {
      showError(`Failed to parse a key: ${error instanceof Error ? error.message : 'unknown error'}`)
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
        name: colors.primary(`── Current recipients: ${recipients.length} ──`),
        value: 'show-recipients',
      })
    }

    // Option to add self (if not already added)
    const selfAdded = recipients.some((r) => r.name === 'Myself')
    if (defaultKeypair && !selfAdded) {
      choices.push({
        name: `${icons.key} Add myself ${colors.muted('(so I can also decrypt)')}`,
        value: 'self',
      })
    }

    // Option to select from contacts
    if (contacts.length > 0) {
      choices.push({
        name: `${icons.contact} Select from saved contacts ${colors.muted(`(${contacts.length} available)`)}`,
        value: 'contacts',
      })
    }

    // Clipboard and manual options
    choices.push({
      name: `${icons.clipboard} Paste from clipboard ${colors.muted('(supports multiple keys)')}`,
      value: 'clipboard',
    })
    choices.push({
      name: `${icons.inline} Type/paste a single key`,
      value: 'manual',
    })

    // Done or cancel
    choices.push({
      name: recipients.length > 0 ? `${icons.success} Done adding recipients` : `${icons.back} Cancel`,
      value: 'done',
    })

    return choices
  }

  let addMore = true
  while (addMore) {
    const { addMethod } = await escapeablePrompt([
      {
        type: 'list',
        name: 'addMethod',
        message: promptMessage('Add recipients:'),
        choices: buildChoices(),
      },
    ])

    if (addMethod === 'done') {
      addMore = false
    } else if (addMethod === 'show-recipients') {
      // Show current recipients
      console.log(colors.primary('\nCurrent recipients:'))
      for (const r of recipients) {
        console.log(colors.muted(`   • ${r.name}`))
      }
      console.log()
    } else if (addMethod === 'self') {
      if (defaultKeypair) {
        recipients.push({
          name: 'Myself',
          publicKey: defaultKeypair.public_key,
        })
        showSuccess('Added yourself as a recipient')
      }
    } else if (addMethod === 'contacts') {
      // Show contacts as a checkbox
      const { selectedContacts } = await escapeablePrompt([
        {
          type: 'checkbox',
          name: 'selectedContacts',
          message: promptMessage('Select contacts (space to toggle, enter to confirm):'),
          choices: contacts.map((c) => {
            const alreadyAdded = recipients.some((r) => r.publicKey === c.public_key)
            return {
              name: `${c.name} <${c.email || 'no email'}>${alreadyAdded ? colors.muted(' (already added)') : ''}`,
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
        showSuccess(`Added ${addedCount} contact${addedCount > 1 ? 's' : ''}`)
      }
    } else if (addMethod === 'clipboard') {
      const added = await addKeysFromClipboard(recipients)
      if (added > 0) {
        console.log()
        showSuccess(`Added ${added} recipient${added > 1 ? 's' : ''} from clipboard`)
        console.log()
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
            showWarning('This recipient is already in the list')
          } else {
            recipients.push({
              name: recipientName,
              publicKey,
            })
            showSuccess(`Added recipient: ${recipientName}`)
          }
        } catch (error) {
          showError('Failed to parse public key')
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
    const { useClipboard } = await escapeablePrompt([
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
    console.log(promptMessage('\nPaste the recipient\'s PGP PUBLIC key:'))
    console.log(colors.muted('(Press Enter to finish, or press Enter then Ctrl+D)\n'))

    const rl = readline.createInterface({ input, output })
    rl.setPrompt('')
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
    console.log()
    showError('Invalid public key format')
    console.log()
    return null
  }

  // Try to read the key to validate it
  try {
    await openpgp.readKey({ armoredKey: publicKey, config: weakKeyConfig })
    console.log()
    showSuccess('Valid public key')
    console.log()
    return publicKey
  } catch (error) {
    console.log()
    showError(`Failed to read public key: ${error instanceof Error ? error.message : error}`)
    return null
  }
}

// printBanner is imported from ui.ts

function getEditorInstructions(editorCommand: string): string {
  const instructions: Record<string, string> = {
    'nano': 'Save: Ctrl+O, then Enter. Exit: Ctrl+X',
    'vim': 'Save and exit: :wq  |  Cancel: :q!',
    'nvim': 'Save and exit: :wq  |  Cancel: :q!',
    'code': 'Save: Cmd/Ctrl+S, then close the editor tab',
    'emacs': 'Save: Ctrl+X Ctrl+S  |  Exit: Ctrl+X Ctrl+C',
    'open -e': 'Save: Cmd+S, then close the window',
    'notepad': 'Save: Ctrl+S, then close the window',
  }
  return instructions[editorCommand] || 'Save and close the editor when done'
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
    console.log()
    showWarning('No keypair found. Let\'s set up your first keypair.')
    console.log()
    await keyManager.setupFirstKeypair()
    console.log()
    showSuccess('Setup complete! You can now use the tool.')
    console.log()
  }

  const { action } = await escapeablePrompt([
    {
      type: 'list',
      name: 'action',
      message: promptMessage('What would you like to do?'),
      choices: [
        { name: `${icons.encrypt} Encrypt a message`, value: 'encrypt' },
        { name: `${icons.decrypt} Decrypt a message`, value: 'decrypt' },
        { name: `${icons.key} Manage keys`, value: 'keys' },
        new inquirer.Separator(),
        exitChoice(),
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
      const { recipient } = await escapeablePrompt([
        {
          type: 'list',
          name: 'recipient',
          message: promptMessage('Who do you want to encrypt this message for?'),
          choices: [
            { name: `${icons.contact} Someone else ${colors.muted('(use their public key)')}`, value: 'other' },
            { name: `${icons.multiple} Multiple recipients`, value: 'multiple' },
            { name: `${icons.key} Myself ${colors.muted('(use my public key)')}`, value: 'self' },
            new inquirer.Separator(),
            mainMenuChoice(),
          ],
        },
      ])

      if (recipient === 'back' || recipient === 'main-menu') {
        return main()
      }

      let recipientPublicKeys: string[] = []
      let recipientNames: string[] = []
      let isNewContact = false

      // Handle multiple recipients
      if (recipient === 'multiple') {
        const recipients = await selectMultipleRecipients()
        if (recipients.length === 0) {
          console.log()
          showError('No recipients selected. Aborting.')
          console.log()
          return main()
        }
        recipientPublicKeys = recipients.map((r) => r.publicKey)
        recipientNames = recipients.map((r) => r.name)

        // Show summary
        console.log(colors.primary('\nEncrypting for the following recipients:'))
        for (const name of recipientNames) {
          console.log(colors.muted(`   • ${name}`))
        }
        console.log()
      } else if (recipient === 'other') {
        // Check if there are any saved contacts
        const contacts = db.select({ table: 'contact' })

        // Loop for recipient selection (allows going back from contacts submenu)
        recipientLoop: while (true) {
          // Build main menu choices
          const recipientChoices: any[] = []

          if (contacts.length > 0) {
            recipientChoices.push({
              name: `${icons.contact} Saved contacts ${colors.muted(`(${contacts.length} available)`)}`,
              value: 'saved-contacts',
            })
          }

          recipientChoices.push(
            { name: `${icons.add} Use a new public key`, value: 'new' },
            new inquirer.Separator(),
            mainMenuChoice()
          )

          const { recipientSource } = await escapeablePrompt([
            {
              type: 'list',
              name: 'recipientSource',
              message: promptMessage('How would you like to specify the recipient?'),
              choices: recipientChoices,
            },
          ])

          if (recipientSource === 'main' || recipientSource === 'main-menu') {
            return main()
          }

          if (recipientSource === 'saved-contacts') {
            // Show contacts submenu
            const contactChoices: any[] = contacts.map((c) => ({
              name: `${icons.contact} ${c.name} ${colors.muted(`<${c.email}>`)}`,
              value: c.id,
            }))
            contactChoices.push(
              new inquirer.Separator(),
              backChoice(),
              mainMenuChoice(),
              new inquirer.Separator()
            )

            const { contactChoice } = await escapeablePrompt([
              {
                type: 'list',
                name: 'contactChoice',
                message: promptMessage('Select a contact:'),
                choices: contactChoices,
              },
            ])

            if (contactChoice === 'main' || contactChoice === 'main-menu') {
              return main()
            }

            if (contactChoice === 'back') {
              // Go back to recipient source selection
              continue recipientLoop
            }

            // Use saved contact
            const selectedContact = contacts.find((c) => c.id === contactChoice)
            if (selectedContact) {
              recipientPublicKeys = [selectedContact.public_key]
              break recipientLoop
            }
          } else if (recipientSource === 'new') {
            const publicKey = await getRecipientPublicKey()
            if (!publicKey) {
              console.log()
              showError('Could not get recipient public key. Aborting.')
              console.log()
              return main()
            }
            recipientPublicKeys = [publicKey]
            isNewContact = true
            break recipientLoop
          }
        }
      }

      // Detect available editors
      const availableEditors = detectAvailableEditors()

      let message: string | undefined

      // Loop for input method selection (allows going back from editor selection)
      inputMethodLoop: while (true) {
        // Ask for input method
        const inputChoices: any[] = []

        // Always add clipboard option first
        inputChoices.push({
          name: `${icons.clipboard} Paste from clipboard`,
          value: 'clipboard',
        })

        if (availableEditors.length > 0) {
          inputChoices.push(
            { name: `${icons.editor} Use an editor`, value: 'editor' },
            { name: `${icons.inline} Type inline ${colors.muted('(Enter, then Ctrl+D to finish)')}`, value: 'inline' }
          )
        } else {
          inputChoices.push({
            name: `${icons.inline} Type inline ${colors.muted('(Enter, then Ctrl+D to finish)')}`,
            value: 'inline',
          })
        }

        // Add main menu option
        inputChoices.push(new inquirer.Separator(), mainMenuChoice())

        const { inputMethod } = await escapeablePrompt([
          {
            type: 'list',
            name: 'inputMethod',
            message: promptMessage('How would you like to enter your message?'),
            choices: inputChoices,
          },
        ])

        if (inputMethod === 'back' || inputMethod === 'main-menu') {
          return main()
        }

        if (inputMethod === 'clipboard') {
          try {
            message = await clipboardy.read()
            if (!message || message.trim() === '') {
              console.log()
              showError('Clipboard is empty.')
              console.log()
              return main()
            }
            console.log()
            showSuccess('Message loaded from clipboard')
            console.log()
            break inputMethodLoop
          } catch (clipError) {
            console.log()
            showError(`Failed to read from clipboard: ${clipError}`)
            return main()
          }
        } else if (inputMethod === 'editor') {
          // Let user choose editor
          const editorChoices: any[] = availableEditors.map((e) => ({
            name: `${icons.editor} ${e.name} ${colors.muted(`(${getEditorInstructions(e.command)})`)}`,
            value: e.command,
          }))
          editorChoices.push(new inquirer.Separator(), backChoice(), mainMenuChoice())

          const { selectedEditor } = await escapeablePrompt([
            {
              type: 'list',
              name: 'selectedEditor',
              message: promptMessage('Choose your editor:'),
              choices: editorChoices,
            },
          ])

          if (selectedEditor === 'back') {
            // Re-ask for input method
            continue inputMethodLoop
          }
          if (selectedEditor === 'main-menu') {
            return main()
          }

          // Set the EDITOR environment variable before opening inquirer editor
          const originalEditor = process.env.EDITOR
          const originalVisual = process.env.VISUAL
          process.env.EDITOR = selectedEditor
          process.env.VISUAL = selectedEditor
          const editorName = availableEditors.find((e) => e.command === selectedEditor)?.name || 'editor'

          console.log(colors.muted('\nNote: The temp file is automatically deleted after encryption.\n'))

          try {
            const { editorInput } = await escapeablePrompt([
              {
                type: 'editor',
                name: 'editorInput',
                message: promptMessage(`Press Enter to open ${editorName}:`),
                postfix: '.txt',
                waitForUseInput: false,
              },
            ])

            message = editorInput
            break inputMethodLoop
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
          break inputMethodLoop
        }
      }

      if (!message || message.trim() === '') {
        console.log()
        showError('No message provided. Aborting.')
        console.log()
        return main()
      }

      console.log()
      showLoading('Encrypting message...')
      console.log()
      const encrypted = await encryptMessage(message, recipientPublicKeys.length > 0 ? recipientPublicKeys : undefined)

      // Clear screen, show encrypted message, then clipboard status
      console.clear()
      printBanner()

      console.log(colors.successBold('Encrypted Message:\n'))
      printDivider()
      console.log(encrypted)
      printDivider()

      // Copy to clipboard and show status below the message
      try {
        await clipboardy.write(encrypted)
        console.log()
        showSuccess('Encrypted message copied to clipboard')
        console.log()
      } catch (clipError) {
        console.log()
        showWarning('Clipboard unavailable')
        console.log()
      }

      // Offer to save the contact if it's a new public key (single recipient only)
      const newPublicKey = recipientPublicKeys[0]
      if (isNewContact && newPublicKey !== undefined && recipientPublicKeys.length === 1) {
        const { saveContact } = await escapeablePrompt([
          {
            type: 'confirm',
            name: 'saveContact',
            message: promptMessage('Would you like to save this contact for future use?'),
            default: true,
          },
        ])

        if (saveContact) {
          try {
            // Extract key information
            const keyInfo = await extractPublicKeyInfo(newPublicKey)

            // Prompt for contact name
            const defaultName = (keyInfo.email || 'unknown').split('@')[0] || 'Contact'
            const answers = await escapeablePrompt([
              {
                type: 'input',
                name: 'contactName',
                message: promptMessage('Contact name:'),
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
              console.log()
              showWarning('This contact already exists.')
              console.log()
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

              console.log()
              showSuccess(`Contact "${contactName}" saved successfully!`)
              console.log()
            }
          } catch (error) {
            console.log()
            showError(`Failed to save contact: ${error instanceof Error ? error.message : error}`)
          }
        }
      }
    } catch (error) {
      // Re-throw escape errors to be handled by the main loop
      if (error instanceof EscapeError) throw error
      console.log()
      showError(`Encryption failed: ${error instanceof Error ? error.message : error}`)
    }
  } else if (action === 'decrypt') {
    try {
      // Detect available editors
      const availableEditors = detectAvailableEditors()

      let encrypted: string | undefined

      // Loop for input method selection (allows going back from editor selection)
      decryptInputLoop: while (true) {
        // Ask for input method
        const inputChoices: any[] = []

        // Always add clipboard option first
        inputChoices.push({
          name: `${icons.clipboard} Paste from clipboard`,
          value: 'clipboard',
        })

        if (availableEditors.length > 0) {
          inputChoices.push(
            { name: `${icons.editor} Use an editor`, value: 'editor' },
            { name: `${icons.inline} Type inline ${colors.muted('(Enter, then Ctrl+D to finish)')}`, value: 'inline' }
          )
        } else {
          inputChoices.push({
            name: `${icons.inline} Type inline ${colors.muted('(Enter, then Ctrl+D to finish)')}`,
            value: 'inline',
          })
        }

        // Add main menu option
        inputChoices.push(new inquirer.Separator(), mainMenuChoice())

        const { inputMethod } = await escapeablePrompt([
          {
            type: 'list',
            name: 'inputMethod',
            message: promptMessage('How would you like to enter the encrypted message?'),
            choices: inputChoices,
          },
        ])

        if (inputMethod === 'back' || inputMethod === 'main-menu') {
          return main()
        }

        if (inputMethod === 'clipboard') {
          try {
            encrypted = await clipboardy.read()
            if (!encrypted || encrypted.trim() === '') {
              console.log()
              showError('Clipboard is empty.')
              console.log()
              return main()
            }
            console.log()
            showSuccess('Encrypted message loaded from clipboard')
            console.log()
            break decryptInputLoop
          } catch (clipError) {
            console.log()
            showError(`Failed to read from clipboard: ${clipError}`)
            return main()
          }
        } else if (inputMethod === 'editor') {
          // Let user choose editor
          const editorChoices: any[] = availableEditors.map((e) => ({
            name: `${icons.editor} ${e.name} ${colors.muted(`(${getEditorInstructions(e.command)})`)}`,
            value: e.command,
          }))
          editorChoices.push(new inquirer.Separator(), backChoice(), mainMenuChoice())

          const { selectedEditor } = await escapeablePrompt([
            {
              type: 'list',
              name: 'selectedEditor',
              message: promptMessage('Choose your editor:'),
              choices: editorChoices,
            },
          ])

          if (selectedEditor === 'back') {
            // Re-ask for input method
            continue decryptInputLoop
          }
          if (selectedEditor === 'main-menu') {
            return main()
          }

          // Set the EDITOR environment variable before opening inquirer editor
          const originalEditor = process.env.EDITOR
          const originalVisual = process.env.VISUAL
          process.env.EDITOR = selectedEditor
          process.env.VISUAL = selectedEditor
          const editorName = availableEditors.find((e) => e.command === selectedEditor)?.name || 'editor'

          console.log(colors.muted('\nNote: The temp file is automatically deleted after decryption.\n'))

          try {
            const { editorInput } = await escapeablePrompt([
              {
                type: 'editor',
                name: 'editorInput',
                message: promptMessage(`Press Enter to open ${editorName}:`),
                postfix: '.txt',
                waitForUseInput: false,
              },
            ])

            encrypted = editorInput
            break decryptInputLoop
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
          break decryptInputLoop
        }
      }

      if (!encrypted || encrypted.trim() === '') {
        console.log()
        showError('No encrypted message provided. Aborting.')
        console.log()
        return main()
      }

      console.log()
      showLoading('Decrypting message...')
      console.log()
      const decrypted = await decryptMessage(encrypted)

      // Clear screen, show decrypted message, then clipboard status
      console.clear()
      printBanner()

      console.log(colors.successBold('Decrypted Message:\n'))
      printDivider()
      console.log(decrypted)
      printDivider()

      // Copy to clipboard and show status below the message
      try {
        await clipboardy.write(decrypted)
        console.log()
        showSuccess('Decrypted message copied to clipboard')
        console.log()
      } catch (clipError) {
        console.log()
        showWarning('Clipboard unavailable')
        console.log()
      }

      // Wait for user to press Enter before continuing
      await escapeablePrompt([
        {
          type: 'input',
          name: 'continue',
          message: colors.muted('Press Enter to continue...'),
        },
      ])
    } catch (error) {
      // Re-throw escape errors to be handled by the main loop
      if (error instanceof EscapeError) throw error
      console.log()
      showError(`Decryption failed: ${error instanceof Error ? error.message : error}`)
    }
  }

  // Ask if user wants to continue
  const { nextAction } = await escapeablePrompt([
    {
      type: 'list',
      name: 'nextAction',
      message: promptMessage('What would you like to do next?'),
      choices: [
        { name: `${icons.loop} Perform another operation`, value: 'continue' },
        exitChoice(),
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

// Enable global escape key handling and run menu in a loop
enableGlobalEscape()

async function runApp() {
  while (true) {
    try {
      await main()
    } catch (error) {
      const e = error as Error

      // If escape was pressed, just restart the menu
      if (
        error instanceof EscapeError ||
        checkAndResetEscape() ||
        e.message?.includes('prompt was closed')
      ) {
        continue
      }

      // Handle Ctrl+C gracefully (inquirer throws ExitPromptError)
      if (e.message?.includes('force closed the prompt')) {
        clearPassphraseCache()
        console.clear()
        process.exit(0)
      }

      // Handle other errors
      clearPassphraseCache()
      console.clear()
      showError(`Error: ${e.message || error}`)
      process.exit(1)
    }
  }
}

runApp()

#!/usr/bin/env node
import * as openpgp from 'openpgp'
import inquirer from 'inquirer'
import chalk from 'chalk'
import { execSync } from 'child_process'
import * as readline from 'readline'
import { stdin as input, stdout as output } from 'process'
import clipboardy from 'clipboardy'

// Load environment variables
const PGP_PUBLIC_KEY = process.env.PGP_PUBLIC_KEY
const PGP_PRIVATE_KEY = process.env.PGP_PRIVATE_KEY
const PGP_PASSPHRASE = process.env.PGP_PASSPHRASE

interface EditorChoice {
  name: string
  command: string
  available: boolean
}

async function encryptMessage(message: string): Promise<string> {
  if (!PGP_PUBLIC_KEY) {
    throw new Error('PGP_PUBLIC_KEY not found in environment variables')
  }

  const publicKey = await openpgp.readKey({ armoredKey: PGP_PUBLIC_KEY })

  const encrypted = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: message }),
    encryptionKeys: publicKey,
  })

  return encrypted as string
}

async function decryptMessage(encryptedMessage: string): Promise<string> {
  if (!PGP_PRIVATE_KEY) {
    throw new Error('PGP_PRIVATE_KEY not found in environment variables')
  }
  if (!PGP_PASSPHRASE) {
    throw new Error('PGP_PASSPHRASE not found in environment variables')
  }

  const privateKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: PGP_PRIVATE_KEY }),
    passphrase: PGP_PASSPHRASE,
  })

  const message = await openpgp.readMessage({
    armoredMessage: encryptedMessage,
  })

  const { data: decrypted } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
  })

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

function printBanner() {
  console.clear()
  console.log(chalk.cyan.bold('\n╔════════════════════════════════════════╗'))
  console.log(chalk.cyan.bold('║  🔐  PGP Encryption/Decryption Tool   ║'))
  console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'))
}

async function main() {
  printBanner()

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
          name: '👋 Exit',
          value: 'exit',
        },
      ],
    },
  ])

  if (action === 'exit') {
    console.log(chalk.green('\n✨ Goodbye!\n'))
    process.exit(0)
  }

  if (action === 'encrypt') {
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

      const { inputMethod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'inputMethod',
          message: chalk.yellow('How would you like to enter your message?'),
          choices: inputChoices,
        },
      ])

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
      const encrypted = await encryptMessage(message)

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
    console.log(chalk.green('\n✨ Goodbye!\n'))
  }
}

// Graceful exit on Ctrl+C
process.on('SIGINT', () => {
  console.log(chalk.green('\n\n👋 Goodbye!\n'))
  process.exit(0)
})

main().catch((error) => {
  // Handle Ctrl+C gracefully (inquirer throws ExitPromptError)
  if (error.message && error.message.includes('force closed the prompt')) {
    console.log(chalk.green('\n👋 Goodbye!\n'))
    process.exit(0)
  }

  console.error(chalk.red('\n❌ Error:'), error.message || error)
  process.exit(1)
})

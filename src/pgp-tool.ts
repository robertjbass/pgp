#!/usr/bin/env node
import * as openpgp from 'openpgp'
import inquirer from 'inquirer'
import { execSync } from 'child_process'
import clipboardy from 'clipboardy'
import { Command } from 'commander'
import { Db, type Keypair } from './db.js'
import { KeyManager } from './key-manager.js'
import { extractPublicKeyInfo } from './key-utils.js'
import {
  escapeablePrompt,
  enableGlobalEscape,
  checkAndResetEscape,
  EscapeError,
} from './prompts.js'
import {
  getCachedPassphrase,
  cachePassphrase,
} from './passphrase-store.js'
import { readInlineMultiline } from './inline-editor.js'
import {
  colors,
  icons,
  printBanner,
  printDivider,
  printHomeStatus,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  showLoading,
  promptMessage,
  mainMenuChoice,
  backChoice,
  exitChoice,
} from './ui.js'
import {
  generateCommand,
  exportPublicCommand,
  listKeysCommand,
  encryptCommand,
  decryptCommand,
} from './cli-commands.js'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
function getPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.version
  } catch {
    return '0.0.0'
  }
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value])
}

function isCLIMode(): boolean {
  const args = process.argv.slice(2)
  if (args.length === 0) return false
  const commands = [
    'generate',
    'export-public',
    'list-keys',
    'encrypt',
    'decrypt',
    '--help',
    '-h',
    '--version',
    '-V',
  ]
  return commands.some((cmd) => args[0] === cmd || args[0]?.startsWith('-'))
}

function setupCLI(): void {
  const program = new Command()
    .name('lpgp')
    .description('PGP encryption/decryption CLI tool')
    .version(getPackageVersion())

  program
    .command('generate')
    .description('Generate a new PGP keypair')
    .requiredOption('--name <name>', 'Name for the keypair')
    .requiredOption('--email <email>', 'Email for the keypair')
    .option('--passphrase <pass>', 'Passphrase to protect the key')
    .option('--no-passphrase', 'Generate without passphrase protection')
    .option('--no-set-default', 'Do not set as default keypair')
    .action(generateCommand)

  program
    .command('export-public')
    .description('Export public key to stdout')
    .option(
      '--fingerprint <fp>',
      'Fingerprint of key to export (default: default keypair)',
    )
    .option('--json', 'Output as JSON with metadata')
    .action(exportPublicCommand)

  program
    .command('list-keys')
    .description('List all keypairs')
    .option('--json', 'Output as JSON')
    .action(listKeysCommand)

  program
    .command('encrypt [message]')
    .description('Encrypt a message')
    .requiredOption(
      '--to <recipient>',
      'Recipient fingerprint or email (can be used multiple times)',
      collect,
      [],
    )
    .option('--file <path>', 'Read message from file')
    .option('--output <path>', 'Write to file (default: stdout)')
    .action(encryptCommand)

  program
    .command('decrypt [message]')
    .description('Decrypt a message')
    .option('--passphrase <pass>', 'Passphrase for private key')
    .option('--file <path>', 'Read encrypted message from file')
    .action(decryptCommand)

  program.parse()
}

if (isCLIMode()) {
  setupCLI()
} else {
  startInteractiveMode()
}

function startInteractiveMode(): void {
  const weakKeyConfig = {
    rejectPublicKeyAlgorithms: new Set(),
    rejectHashAlgorithms: new Set(),
    rejectMessageHashAlgorithms: new Set(),
    rejectCurves: new Set(),
    allowMissingKeyFlags: true,
  }

  let db: Db
  let keyManager: KeyManager
  const unlockedKeys = new Map<string, openpgp.PrivateKey>()

  // ---------- Editor detection ----------

  type EditorChoice = {
    name: string
    command: string
    available: boolean
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

    if (process.platform === 'darwin') {
      editors.push({ name: 'TextEdit', command: 'open -e', available: true })
    } else if (process.platform === 'win32') {
      editors.push({ name: 'Notepad', command: 'notepad', available: true })
    }

    for (const editor of editors) {
      if (editor.command.includes('open -e') || editor.command === 'notepad') {
        editor.available = true
      } else {
        editor.available = checkEditorAvailable(editor.command)
      }
    }

    return editors.filter((e) => e.available)
  }

  function getEditorInstructions(editorCommand: string): string {
    const instructions: Record<string, string> = {
      nano: 'Save: Ctrl+O, then Enter. Exit: Ctrl+X',
      vim: 'Save and exit: :wq  |  Cancel: :q!',
      nvim: 'Save and exit: :wq  |  Cancel: :q!',
      code: 'Save: Cmd/Ctrl+S, then close the editor tab',
      emacs: 'Save: Ctrl+X Ctrl+S  |  Exit: Ctrl+X Ctrl+C',
      'open -e': 'Save: Cmd+S, then close the window',
      notepad: 'Save: Ctrl+S, then close the window',
    }
    return instructions[editorCommand] || 'Save and close the editor when done'
  }

  // ---------- Clipboard / key extraction ----------

  function extractAllPublicKeys(content: string): string[] {
    const keyRegex =
      /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/g
    return content.match(keyRegex) ?? []
  }

  async function readClipboardSafe(): Promise<string | null> {
    try {
      return await clipboardy.read()
    } catch {
      return null
    }
  }

  async function writeClipboardSafe(content: string): Promise<boolean> {
    try {
      await clipboardy.write(content)
      return true
    } catch {
      return false
    }
  }

  // ---------- Session: unlock keys ----------

  async function unlockKeypair(
    keypair: Keypair,
    options: { silent?: boolean } = {},
  ): Promise<openpgp.PrivateKey | null> {
    const existing = unlockedKeys.get(keypair.fingerprint)
    if (existing) return existing

    const privateKey = await openpgp.readPrivateKey({
      armoredKey: keypair.private_key,
      config: weakKeyConfig,
    })

    if (!keypair.passphrase_protected) {
      unlockedKeys.set(keypair.fingerprint, privateKey)
      return privateKey
    }

    const cached = getCachedPassphrase(keypair.fingerprint)
    if (cached) {
      try {
        const unlocked = await openpgp.decryptKey({
          privateKey,
          passphrase: cached,
          config: weakKeyConfig,
        })
        unlockedKeys.set(keypair.fingerprint, unlocked)
        return unlocked
      } catch {
        if (options.silent) return null
        showWarning(`Saved passphrase for "${keypair.name}" is invalid.`)
      }
    } else if (options.silent) {
      return null
    }

    let attempts = 0
    while (attempts < 3) {
      attempts++
      const { passphrase } = await escapeablePrompt<{ passphrase: string }>([
        {
          type: 'password',
          name: 'passphrase',
          message: promptMessage(`Passphrase for "${keypair.name}":`),
          mask: '*',
        },
      ])

      if (!passphrase) {
        showWarning('Cancelled.')
        return null
      }

      try {
        const unlocked = await openpgp.decryptKey({
          privateKey,
          passphrase,
          config: weakKeyConfig,
        })
        cachePassphrase(keypair.fingerprint, passphrase)
        unlockedKeys.set(keypair.fingerprint, unlocked)
        showSuccess('Passphrase saved locally — you won\'t be asked again.')
        return unlocked
      } catch {
        showError('Incorrect passphrase. Try again.')
      }
    }
    return null
  }

  async function unlockAllCached(): Promise<void> {
    const keypairs = db.select({ table: 'keypair' })
    for (const kp of keypairs) {
      if (kp.passphrase_protected) {
        await unlockKeypair(kp, { silent: true })
      } else {
        await unlockKeypair(kp)
      }
    }
  }

  function getUnlockedPrivateKeys(): openpgp.PrivateKey[] {
    return Array.from(unlockedKeys.values())
  }

  // ---------- Encryption ----------

  async function encryptForKeys(
    message: string,
    publicKeysArmored: string[],
  ): Promise<string> {
    const publicKeys = await Promise.all(
      publicKeysArmored.map((key) =>
        openpgp.readKey({ armoredKey: key, config: weakKeyConfig }),
      ),
    )
    const encrypted = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: message }),
      encryptionKeys: publicKeys,
      config: weakKeyConfig,
    })
    return encrypted as string
  }

  // ---------- Decryption ----------

  async function decryptWithSession(encryptedMessage: string): Promise<string> {
    const message = await openpgp.readMessage({
      armoredMessage: encryptedMessage,
    })

    const tryWith = async (
      keys: openpgp.PrivateKey[],
    ): Promise<string | null> => {
      if (keys.length === 0) return null
      try {
        const { data } = await openpgp.decrypt({
          message,
          decryptionKeys: keys,
          config: weakKeyConfig,
        })
        return data as string
      } catch {
        return null
      }
    }

    const firstTry = await tryWith(getUnlockedPrivateKeys())
    if (firstTry !== null) {
      markKeyAsUsed(message)
      return firstTry
    }

    const keyIDs = message.getEncryptionKeyIDs()
    if (keyIDs.length === 0) {
      throw new Error('Message contains no recipient information')
    }

    const allKeypairs = db.select({ table: 'keypair' })
    const matching: Keypair[] = []
    const seen = new Set<number>()
    for (const keyID of keyIDs) {
      const idHex = keyID.toHex().toUpperCase()
      for (const kp of allKeypairs) {
        if (seen.has(kp.id)) continue
        if (kp.fingerprint.toUpperCase().endsWith(idHex)) {
          matching.push(kp)
          seen.add(kp.id)
        }
      }
    }

    const locked = matching.filter((kp) => !unlockedKeys.has(kp.fingerprint))
    if (locked.length === 0) {
      throw new Error('This message was not encrypted for any of your keys')
    }

    for (const kp of locked) {
      showInfo(`Message is encrypted for "${kp.name}" — unlocking…`)
      const unlocked = await unlockKeypair(kp)
      if (!unlocked) continue
      const result = await tryWith([unlocked])
      if (result !== null) {
        markKeyAsUsed(message)
        return result
      }
    }

    throw new Error('Could not decrypt with any of your matching keys')
  }

  function markKeyAsUsed(message: openpgp.Message<string>): void {
    const keyIDs = message.getEncryptionKeyIDs()
    if (keyIDs.length === 0) return
    const allKeypairs = db.select({ table: 'keypair' })
    for (const keyID of keyIDs) {
      const idHex = keyID.toHex().toUpperCase()
      const match = allKeypairs.find(
        (kp) =>
          kp.fingerprint.toUpperCase().endsWith(idHex) &&
          unlockedKeys.has(kp.fingerprint),
      )
      if (match) {
        db.update(
          'keypair',
          { key: 'id', value: match.id },
          { last_used_at: new Date().toISOString() },
        )
        return
      }
    }
  }

  // ---------- Auto-save contact (silent) ----------

  async function autoSaveContact(publicKeyArmored: string): Promise<void> {
    try {
      const keyInfo = await extractPublicKeyInfo(publicKeyArmored)
      if (!keyInfo.name || keyInfo.name === 'Unknown') return
      if (!keyInfo.email || keyInfo.email === 'unknown@example.com') return

      const existing = db.select({
        table: 'contact',
        where: {
          key: 'fingerprint',
          compare: 'is',
          value: keyInfo.fingerprint,
        },
      })
      if (existing.length > 0) return

      const ownKey = db.select({
        table: 'keypair',
        where: {
          key: 'fingerprint',
          compare: 'is',
          value: keyInfo.fingerprint,
        },
      })
      if (ownKey.length > 0) return

      db.insert('contact', {
        name: keyInfo.name,
        email: keyInfo.email,
        fingerprint: keyInfo.fingerprint,
        public_key: publicKeyArmored,
        algorithm: keyInfo.algorithm,
        key_size: keyInfo.keySize,
        trusted: false,
        last_verified_at: null,
        notes: null,
        expires_at: keyInfo.expiresAt,
        revoked: false,
      })
      showInfo(`Saved "${keyInfo.name}" to contacts.`)
    } catch {
      // Silently skip on any failure
    }
  }

  // ---------- Message input methods ----------

  type InputResult = { value: string } | { cancelled: true }

  async function chooseInputMethod(
    promptText: string,
    skipClipboard = false,
  ): Promise<InputResult> {
    const availableEditors = detectAvailableEditors()

    while (true) {
      const inputChoices: { name: string; value: string }[] = []
      if (!skipClipboard) {
        inputChoices.push({
          name: `${icons.clipboard} Paste from clipboard`,
          value: 'clipboard',
        })
      }
      if (availableEditors.length > 0) {
        inputChoices.push({
          name: `${icons.editor} Open in an editor`,
          value: 'editor',
        })
      }
      inputChoices.push({
        name: `${icons.inline} Type inline ${colors.muted('(Ctrl+D when done)')}`,
        value: 'inline',
      })
      const choices: any[] = [
        ...inputChoices,
        new inquirer.Separator(),
        mainMenuChoice(),
      ]

      const { inputMethod } = await escapeablePrompt<{ inputMethod: string }>([
        {
          type: 'list',
          name: 'inputMethod',
          message: promptMessage(promptText),
          choices,
        },
      ])

      if (inputMethod === 'main-menu') return { cancelled: true }

      if (inputMethod === 'clipboard') {
        const content = await readClipboardSafe()
        if (!content || content.trim() === '') {
          showError('Clipboard is empty.')
          continue
        }
        return { value: content }
      }

      if (inputMethod === 'editor') {
        const editorChoices: any[] = availableEditors.map((e) => ({
          name: `${icons.editor} ${e.name} ${colors.muted(`(${getEditorInstructions(e.command)})`)}`,
          value: e.command,
        }))
        editorChoices.push(
          new inquirer.Separator(),
          backChoice(),
          mainMenuChoice(),
        )

        const { selectedEditor } = await escapeablePrompt<{
          selectedEditor: string
        }>([
          {
            type: 'list',
            name: 'selectedEditor',
            message: promptMessage('Choose your editor:'),
            choices: editorChoices,
          },
        ])

        if (selectedEditor === 'back') continue
        if (selectedEditor === 'main-menu') return { cancelled: true }

        const originalEditor = process.env.EDITOR
        const originalVisual = process.env.VISUAL
        process.env.EDITOR = selectedEditor
        process.env.VISUAL = selectedEditor

        try {
          const { editorInput } = await escapeablePrompt<{
            editorInput: string
          }>([
            {
              type: 'editor',
              name: 'editorInput',
              message: promptMessage('Press Enter to open editor:'),
              postfix: '.txt',
              waitForUseInput: false,
            },
          ])
          return { value: editorInput ?? '' }
        } finally {
          if (originalEditor !== undefined) process.env.EDITOR = originalEditor
          else delete process.env.EDITOR
          if (originalVisual !== undefined) process.env.VISUAL = originalVisual
          else delete process.env.VISUAL
        }
      }

      if (inputMethod === 'inline') {
        try {
          const value = await readInlineMultiline('Type your message:')
          return { value }
        } catch (error) {
          if (error instanceof EscapeError) return { cancelled: true }
          throw error
        }
      }
    }
  }

  // ---------- Recipient selection ----------

  type Recipient = {
    name: string
    publicKey: string
    isNew: boolean
  }

  async function getRecipientFromPaste(): Promise<Recipient | null> {
    let value: string
    try {
      value = await readInlineMultiline(
        "Paste the recipient's PGP PUBLIC KEY block:",
        '(Paste, then press Ctrl+D)',
      )
    } catch (error) {
      if (error instanceof EscapeError) return null
      throw error
    }

    if (!value.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
      showError('No PGP public key found in the input.')
      return null
    }

    const keys = extractAllPublicKeys(value)
    if (keys.length === 0) {
      showError('No valid PGP public key block found.')
      return null
    }

    try {
      const armored = keys[0]!
      await openpgp.readKey({ armoredKey: armored, config: weakKeyConfig })
      const info = await extractPublicKeyInfo(armored)
      const name =
        info.name && info.name !== 'Unknown'
          ? `${info.name} <${info.email}>`
          : info.email
      return { name, publicKey: armored, isNew: true }
    } catch (error) {
      showError(
        `Failed to read public key: ${error instanceof Error ? error.message : error}`,
      )
      return null
    }
  }

  async function selectMultipleRecipients(): Promise<Recipient[]> {
    const recipients: Recipient[] = []
    const contacts = db.select({ table: 'contact' })
    const defaultKeypair = keyManager.getDefaultKeypair()

    while (true) {
      const choices: any[] = []
      if (recipients.length > 0) {
        choices.push({
          name: colors.primary(
            `── Current recipients: ${recipients.length} ──`,
          ),
          value: 'show',
        })
      }
      if (defaultKeypair && !recipients.some((r) => r.name === 'Myself')) {
        choices.push({
          name: `${icons.key} Add myself ${colors.muted('(so you can decrypt too)')}`,
          value: 'self',
        })
      }
      if (contacts.length > 0) {
        choices.push({
          name: `${icons.contact} Pick from contacts ${colors.muted(`(${contacts.length})`)}`,
          value: 'contacts',
        })
      }
      choices.push(
        { name: `${icons.clipboard} Add from clipboard`, value: 'clipboard' },
        { name: `${icons.inline} Paste a public key`, value: 'paste' },
        new inquirer.Separator(),
        {
          name:
            recipients.length > 0
              ? `${icons.success} Done`
              : `${icons.back} Cancel`,
          value: 'done',
        },
      )

      const { method } = await escapeablePrompt<{ method: string }>([
        {
          type: 'list',
          name: 'method',
          message: promptMessage('Add recipients:'),
          choices,
        },
      ])

      if (method === 'done') break

      if (method === 'show') {
        console.log(colors.primary('\nCurrent recipients:'))
        for (const r of recipients) console.log(colors.muted(`   • ${r.name}`))
        console.log()
        continue
      }

      if (method === 'self') {
        if (defaultKeypair) {
          recipients.push({
            name: 'Myself',
            publicKey: defaultKeypair.public_key,
            isNew: false,
          })
          showSuccess('Added yourself')
        }
        continue
      }

      if (method === 'contacts') {
        const { selected } = await escapeablePrompt<{ selected: number[] }>([
          {
            type: 'checkbox',
            name: 'selected',
            message: promptMessage('Select contacts:'),
            choices: contacts.map((c) => {
              const already = recipients.some(
                (r) => r.publicKey === c.public_key,
              )
              return {
                name: `${c.name} <${c.email}>${already ? colors.muted(' (added)') : ''}`,
                value: c.id,
                disabled: already,
              }
            }),
          },
        ])
        for (const id of selected) {
          const c = contacts.find((x) => x.id === id)
          if (c) {
            recipients.push({
              name: `${c.name} <${c.email}>`,
              publicKey: c.public_key,
              isNew: false,
            })
          }
        }
        continue
      }

      if (method === 'clipboard') {
        const content = await readClipboardSafe()
        const keys = content ? extractAllPublicKeys(content) : []
        if (keys.length === 0) {
          showWarning('No public keys found in clipboard.')
          continue
        }
        for (const armored of keys) {
          try {
            await openpgp.readKey({ armoredKey: armored, config: weakKeyConfig })
            const info = await extractPublicKeyInfo(armored)
            const name =
              info.name && info.name !== 'Unknown'
                ? `${info.name} <${info.email}>`
                : info.email
            if (recipients.some((r) => r.publicKey === armored)) {
              showWarning(`Skipping duplicate: ${name}`)
              continue
            }
            recipients.push({ name, publicKey: armored, isNew: true })
            showSuccess(`Added ${name}`)
          } catch (error) {
            showError(`Skipped invalid key: ${error}`)
          }
        }
        continue
      }

      if (method === 'paste') {
        const r = await getRecipientFromPaste()
        if (r) {
          if (recipients.some((x) => x.publicKey === r.publicKey)) {
            showWarning('Already added.')
          } else {
            recipients.push(r)
            showSuccess(`Added ${r.name}`)
          }
        }
      }
    }

    return recipients
  }

  // ---------- Actions ----------

  async function actionCopyPublicKey(): Promise<void> {
    const keypairs = db.select({ table: 'keypair' })
    if (keypairs.length === 0) {
      showError('No keypairs found. Create one from the key management menu.')
      await pause()
      return
    }

    let selected: Keypair
    if (keypairs.length === 1) {
      selected = keypairs[0]!
    } else {
      const defaultId = keypairs.find((kp) => kp.is_default)?.id
      const { keypairId } = await escapeablePrompt<{
        keypairId: number | string
      }>([
        {
          type: 'list',
          name: 'keypairId',
          message: promptMessage('Which public key would you like to copy?'),
          default: defaultId,
          choices: [
            ...keypairs.map((kp) => ({
              name: `${icons.key} ${kp.name}${kp.is_default ? ` ${colors.muted('(default)')}` : ''}`,
              value: kp.id,
            })),
            new inquirer.Separator(),
            mainMenuChoice(),
          ],
        },
      ])
      if (keypairId === 'main-menu') return
      const found = keypairs.find((kp) => kp.id === keypairId)
      if (!found) return
      selected = found
    }

    const ok = await writeClipboardSafe(selected.public_key)
    console.log()
    if (ok) {
      showSuccess(`Public key for "${selected.name}" copied to clipboard.`)
      console.log(
        colors.muted(`  Fingerprint: ${selected.fingerprint.slice(-16)}`),
      )
    } else {
      showError('Could not write to clipboard.')
    }
    console.log()
    await pause()
  }

  async function actionEncrypt(): Promise<void> {
    let recipients: Recipient[] = []

    // 1. Auto-detect a public key in clipboard
    const clipboard = await readClipboardSafe()
    const clipboardKeys = clipboard ? extractAllPublicKeys(clipboard) : []

    if (clipboardKeys.length === 1) {
      const armored = clipboardKeys[0]!
      try {
        await openpgp.readKey({ armoredKey: armored, config: weakKeyConfig })
        const info = await extractPublicKeyInfo(armored)
        const name =
          info.name && info.name !== 'Unknown'
            ? `${info.name} <${info.email}>`
            : info.email || info.fingerprint.slice(-16)

        const { useClipboard } = await escapeablePrompt<{
          useClipboard: boolean
        }>([
          {
            type: 'confirm',
            name: 'useClipboard',
            message: promptMessage(`Encrypt for ${colors.successBold(name)}?`),
            default: true,
          },
        ])

        if (useClipboard) {
          recipients = [{ name, publicKey: armored, isNew: true }]
        }
      } catch {
        // Bad key, fall through to picker
      }
    }

    // 2. If no clipboard recipient, show picker
    if (recipients.length === 0) {
      const contacts = db.select({ table: 'contact' })
      const defaultKeypair = keyManager.getDefaultKeypair()

      const choices: any[] = []
      if (contacts.length > 0) {
        choices.push({
          name: `${icons.contact} A saved contact ${colors.muted(`(${contacts.length})`)}`,
          value: 'contact',
        })
      }
      choices.push({
        name: `${icons.inline} Paste a public key`,
        value: 'paste',
      })
      choices.push({
        name: `${icons.multiple} Multiple recipients`,
        value: 'multi',
      })
      if (defaultKeypair) {
        choices.push({
          name: `${icons.key} Myself`,
          value: 'self',
        })
      }
      choices.push(new inquirer.Separator(), mainMenuChoice())

      const { recipient } = await escapeablePrompt<{ recipient: string }>([
        {
          type: 'list',
          name: 'recipient',
          message: promptMessage('Who do you want to encrypt for?'),
          choices,
        },
      ])

      if (recipient === 'main-menu') return

      if (recipient === 'contact') {
        const { contactId } = await escapeablePrompt<{
          contactId: number | string
        }>([
          {
            type: 'list',
            name: 'contactId',
            message: promptMessage('Select contact:'),
            choices: [
              ...contacts.map((c) => ({
                name: `${icons.contact} ${c.name} ${colors.muted(`<${c.email}>`)}`,
                value: c.id,
              })),
              new inquirer.Separator(),
              backChoice(),
            ],
          },
        ])
        if (contactId === 'back') return actionEncrypt()
        const c = contacts.find((x) => x.id === contactId)
        if (!c) return
        recipients = [
          { name: `${c.name} <${c.email}>`, publicKey: c.public_key, isNew: false },
        ]
      } else if (recipient === 'paste') {
        const r = await getRecipientFromPaste()
        if (!r) return
        recipients = [r]
      } else if (recipient === 'multi') {
        recipients = await selectMultipleRecipients()
        if (recipients.length === 0) return
      } else if (recipient === 'self') {
        if (defaultKeypair) {
          recipients = [
            {
              name: 'Myself',
              publicKey: defaultKeypair.public_key,
              isNew: false,
            },
          ]
        }
      }
    }

    if (recipients.length === 0) return

    if (recipients.length > 1) {
      console.log(colors.primary('\nEncrypting for:'))
      for (const r of recipients) console.log(colors.muted(`  • ${r.name}`))
      console.log()
    }

    // 3. Get message
    const result = await chooseInputMethod(
      'How would you like to enter your message?',
    )
    if ('cancelled' in result) return
    const message = result.value
    if (!message || message.trim() === '') {
      showError('No message provided.')
      await pause()
      return
    }

    // 4. Encrypt
    showLoading('Encrypting…')
    const encrypted = await encryptForKeys(
      message,
      recipients.map((r) => r.publicKey),
    )

    // 5. Display + copy
    console.clear()
    printBanner()
    console.log(colors.successBold('Encrypted Message:\n'))
    printDivider()
    console.log(encrypted)
    printDivider()
    console.log()

    const copied = await writeClipboardSafe(encrypted)
    if (copied) {
      showSuccess('Encrypted message copied to clipboard.')
    } else {
      showWarning('Clipboard unavailable.')
    }

    // 6. Auto-save new contacts (silent if name available)
    for (const r of recipients) {
      if (r.isNew) {
        await autoSaveContact(r.publicKey)
      }
    }

    console.log()
    await pause()
  }

  async function actionDecrypt(): Promise<void> {
    let encrypted: string | null = null

    // 1. Auto-detect clipboard
    const clipboard = await readClipboardSafe()
    if (clipboard && clipboard.includes('BEGIN PGP MESSAGE')) {
      const { useClipboard } = await escapeablePrompt<{
        useClipboard: boolean
      }>([
        {
          type: 'confirm',
          name: 'useClipboard',
          message: promptMessage(
            'Encrypted message detected in clipboard. Use it?',
          ),
          default: true,
        },
      ])
      if (useClipboard) encrypted = clipboard
    }

    // 2. Fall back to input method picker
    if (!encrypted) {
      const result = await chooseInputMethod(
        'How would you like to enter the encrypted message?',
      )
      if ('cancelled' in result) return
      encrypted = result.value
    }

    if (!encrypted || !encrypted.includes('BEGIN PGP MESSAGE')) {
      showError('No PGP message found.')
      await pause()
      return
    }

    // 3. Decrypt
    showLoading('Decrypting…')
    try {
      const plaintext = await decryptWithSession(encrypted)

      console.clear()
      printBanner()
      console.log(colors.successBold('Decrypted Message:\n'))
      printDivider()
      console.log(plaintext)
      printDivider()
      console.log()

      const copied = await writeClipboardSafe(plaintext)
      if (copied) showSuccess('Decrypted message copied to clipboard.')
      console.log()
      await pause()
    } catch (error) {
      if (error instanceof EscapeError) throw error
      const msg = error instanceof Error ? error.message : String(error)
      console.log()
      showError(`Decryption failed: ${msg}`)
      console.log()
      await pause()
    }
  }

  async function pause(): Promise<void> {
    await escapeablePrompt([
      {
        type: 'input',
        name: 'continue',
        message: colors.muted('Press Enter to continue…'),
      },
    ])
  }

  // ---------- Main menu ----------

  async function showMainMenu(): Promise<void> {
    printBanner()
    const defaultKp = keyManager.getDefaultKeypair()
    printHomeStatus(defaultKp ? `${defaultKp.name} key` : null)

    const menuChoices: any[] = [
      { name: `${icons.clipboard} Copy my public key`, value: 'copy' },
      { name: `${icons.decrypt} Decrypt a message`, value: 'decrypt' },
      { name: `${icons.encrypt} Encrypt a message`, value: 'encrypt' },
      new inquirer.Separator(colors.muted('  ─────────')),
      { name: `${icons.key} Manage keys & contacts`, value: 'keys' },
      exitChoice(),
    ]

    const { action } = await escapeablePrompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: promptMessage('Choose an action'),
        choices: menuChoices,
      },
    ])

    if (action === 'exit') {
      clearSession()
      console.clear()
      process.exit(0)
    }

    if (action === 'keys') {
      await keyManager.showKeyManagementMenu()
      return
    }

    if (action === 'copy') {
      await actionCopyPublicKey()
      return
    }

    if (action === 'encrypt') {
      await actionEncrypt()
      return
    }

    if (action === 'decrypt') {
      await actionDecrypt()
      return
    }
  }

  function clearSession(): void {
    unlockedKeys.clear()
  }

  // ---------- Bootstrap ----------

  async function main(): Promise<void> {
    if (!db) {
      db = await Db.init()
      keyManager = new KeyManager(db)
    }

    printBanner()

    const hasKeypair = keyManager.hasDefaultKeypair()
    if (!hasKeypair) {
      console.log()
      showWarning("No keypair found. Let's set up your first keypair.")
      console.log()
      await keyManager.setupFirstKeypair()
      console.log()
      showSuccess('Setup complete!')
      console.log()
    }

    // Unlock default key up front if not already cached
    const defaultKp = keyManager.getDefaultKeypair()
    if (
      defaultKp &&
      defaultKp.passphrase_protected &&
      !unlockedKeys.has(defaultKp.fingerprint)
    ) {
      const unlocked = await unlockKeypair(defaultKp)
      if (!unlocked) {
        showWarning('No passphrase provided. Decryption will be unavailable.')
        console.log()
      }
    }

    // Try to unlock everything else from cache (silent)
    await unlockAllCached()

    while (true) {
      try {
        await showMainMenu()
      } catch (error) {
        const e = error as Error
        if (
          error instanceof EscapeError ||
          checkAndResetEscape() ||
          e.message?.includes('prompt was closed')
        ) {
          continue
        }
        if (e.message?.includes('force closed the prompt')) {
          clearSession()
          console.clear()
          process.exit(0)
        }
        clearSession()
        showError(`Error: ${e.message || error}`)
        await pause()
      }
    }
  }

  process.on('SIGINT', () => {
    clearSession()
    console.clear()
    process.exit(0)
  })

  enableGlobalEscape()
  main().catch((error) => {
    showError(`Fatal: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}

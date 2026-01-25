import inquirer from 'inquirer'
import chalk from 'chalk'
import * as readline from 'readline'
import * as openpgp from 'openpgp'
import { Db, type Keypair, type Contact } from './db.js'
import {
  extractPublicKeyInfo,
  extractPrivateKeyInfo,
  verifyKeyPair,
  formatKeypairInfo,
  obfuscateEmail,
} from './key-utils.js'
import {
  isGpgInstalled,
  listGpgKeys,
  exportGpgPublicKey,
  exportGpgSecretKey,
  getGpgHomeDir,
  type SystemKey,
} from './system-keys.js'
import { escapeablePrompt } from './prompts.js'
import { hasStoredPassphrase, deleteStoredPassphrase } from './keychain.js'
import {
  colors,
  icons,
  printBanner,
  printSectionHeader,
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
  showKeyValue,
} from './ui.js'

export class KeyManager {
  private db: Db

  constructor(db: Db) {
    this.db = db
  }

  /**
   * Check if there's a default keypair configured
   */
  hasDefaultKeypair(): boolean {
    const keypairs = this.db.select({
      table: 'keypair',
      where: { key: 'is_default', compare: 'is', value: 1 },
    })
    return keypairs.length > 0
  }

  /**
   * Get the default keypair
   */
  getDefaultKeypair(): Keypair | null {
    const keypairs = this.db.select({
      table: 'keypair',
      where: { key: 'is_default', compare: 'is', value: 1 },
    })
    return keypairs[0] || null
  }

  /**
   * Prompt user to set up their first keypair
   */
  async setupFirstKeypair(): Promise<void> {
    printSectionHeader('First Time Setup')

    showWarning(
      'No PGP keypair found. You need to set up a keypair to use this tool.'
    )
    console.log()

    // Check if GPG is available to offer system import
    const gpgAvailable = isGpgInstalled()
    const choices: any[] = [
      { name: `${icons.import} Import existing keypair`, value: 'import' },
    ]

    if (gpgAvailable) {
      choices.push({
        name: `${icons.gpg} Import from system GPG`,
        value: 'import-gpg',
      })
    }

    choices.push(
      { name: `${icons.generate} Generate new keypair`, value: 'generate' },
      new inquirer.Separator(),
      exitChoice()
    )

    const { action } = await escapeablePrompt([
      {
        type: 'list',
        name: 'action',
        message: promptMessage('What would you like to do?'),
        choices,
      },
    ])

    if (action === 'exit') {
      console.log(colors.muted('\nGoodbye!\n'))
      process.exit(0)
    }

    if (action === 'import') {
      await this.importKeypair(true)
    } else if (action === 'import-gpg') {
      await this.importFromSystemGpg()
    } else if (action === 'generate') {
      await this.generateKeypair(true)
    }
  }

  /**
   * Import a keypair (public + private keys)
   */
  async importKeypair(setAsDefault: boolean = false): Promise<void> {
    printSectionHeader('Import Keypair')

    // Check clipboard for keys
    let clipboardContent = ''
    let hasPublicInClipboard = false
    let hasPrivateInClipboard = false

    try {
      const clipboardy = (await import('clipboardy')).default
      clipboardContent = await clipboardy.read()
      hasPublicInClipboard = clipboardContent.includes(
        'BEGIN PGP PUBLIC KEY BLOCK'
      )
      hasPrivateInClipboard = clipboardContent.includes(
        'BEGIN PGP PRIVATE KEY BLOCK'
      )
    } catch (e) {
      // Clipboard not available, continue without it
    }

    // Prompt for keypair name
    const { name } = await escapeablePrompt([
      {
        type: 'input',
        name: 'name',
        message: promptMessage('Keypair name (e.g., "Personal", "Work"):'),
        default: 'Personal',
        validate: (input: string) =>
          input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    // Get public and private keys
    let publicKey = ''
    let privateKey = ''
    let usedBothFromClipboard = false

    // Check if both keys are in clipboard
    if (hasPublicInClipboard && hasPrivateInClipboard) {
      const { useClipboard } = await escapeablePrompt([
        {
          type: 'confirm',
          name: 'useClipboard',
          message:
            'Both public and private keys detected in clipboard. Use them?',
          default: true,
        },
      ])

      if (useClipboard) {
        // Extract both keys from clipboard
        const publicMatch = clipboardContent.match(
          /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/
        )
        const privateMatch = clipboardContent.match(
          /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/
        )

        if (publicMatch) {
          publicKey = publicMatch[0]
        }
        if (privateMatch) {
          privateKey = privateMatch[0]
        }

        usedBothFromClipboard = true
      }
    }

    // Get public key if not already extracted
    if (!publicKey && hasPublicInClipboard) {
      const { useClipboard } = await escapeablePrompt([
        {
          type: 'confirm',
          name: 'useClipboard',
          message: 'Public key detected in clipboard. Use it?',
          default: true,
        },
      ])

      if (useClipboard) {
        const publicMatch = clipboardContent.match(
          /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/
        )
        if (publicMatch) {
          publicKey = publicMatch[0]
        }
      }
    }

    if (!publicKey) {
      console.log(promptMessage('\nPaste your PGP PUBLIC key:'))
      console.log(
        colors.muted('(Press Enter to finish, or press Enter then Ctrl+D)')
      )
      publicKey = await this.readKeyInput()
    }

    // Validate public key format
    if (!publicKey.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
      console.log()
      showError('Invalid public key format')
      console.log()
      return
    }

    // Get private key if not already extracted
    if (!privateKey && hasPrivateInClipboard) {
      const { useClipboard } = await escapeablePrompt([
        {
          type: 'confirm',
          name: 'useClipboard',
          message: 'Private key detected in clipboard. Use it?',
          default: true,
        },
      ])

      if (useClipboard) {
        const privateMatch = clipboardContent.match(
          /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/
        )
        if (privateMatch) {
          privateKey = privateMatch[0]
        }
      }
    }

    if (!privateKey) {
      console.log(promptMessage('\nPaste your PGP PRIVATE key:'))
      console.log(
        colors.muted('(Press Enter to finish, or press Enter then Ctrl+D)')
      )
      privateKey = await this.readKeyInput()
    }

    // Validate private key format
    if (!privateKey.includes('BEGIN PGP PRIVATE KEY BLOCK')) {
      console.log()
      showError('Invalid private key format')
      console.log()
      return
    }

    // Verify keys match
    console.log()
    showLoading('Verifying keypair...')
    const keysMatch = await verifyKeyPair(publicKey, privateKey)

    if (!keysMatch) {
      console.log()
      showError('Public and private keys do not match. Please try again.')
      console.log()
      return
    }

    // Prompt for passphrase if key is encrypted
    const { passphrase } = await escapeablePrompt([
      {
        type: 'password',
        name: 'passphrase',
        message: promptMessage(
          'Enter passphrase for private key (leave empty if none):'
        ),
        mask: '*',
      },
    ])

    // Extract key information
    try {
      const keyInfo = await extractPrivateKeyInfo(
        privateKey,
        passphrase || undefined
      )

      console.log()
      showSuccess('Keypair verified!')
      console.log()
      console.log(colors.muted('Key Information:'))
      showKeyValue('  Email', keyInfo.email)
      showKeyValue('  Fingerprint', keyInfo.fingerprint)
      showKeyValue('  Algorithm', `${keyInfo.algorithm} (${keyInfo.keySize})`)
      showKeyValue(
        '  Passphrase Protected',
        keyInfo.passphraseProtected ? 'Yes' : 'No'
      )
      console.log()

      // Check if default should be set
      let makeDefault = setAsDefault
      if (!setAsDefault) {
        const { setDefault } = await escapeablePrompt([
          {
            type: 'confirm',
            name: 'setDefault',
            message: 'Set this as your default keypair?',
            default: true,
          },
        ])
        makeDefault = setDefault
      }

      // If setting as default, unset current default
      if (makeDefault) {
        const currentDefaults = this.db.select({
          table: 'keypair',
          where: { key: 'is_default', compare: 'is', value: 1 },
        })
        for (const kp of currentDefaults) {
          this.db.update(
            'keypair',
            { key: 'id', value: kp.id },
            { is_default: false }
          )
        }
      }

      // Save to database
      this.db.insert('keypair', {
        name: name.trim(),
        email: keyInfo.email,
        fingerprint: keyInfo.fingerprint,
        public_key: publicKey,
        private_key: privateKey,
        passphrase_protected: keyInfo.passphraseProtected,
        algorithm: keyInfo.algorithm,
        key_size: keyInfo.keySize,
        can_sign: keyInfo.canSign,
        can_encrypt: keyInfo.canEncrypt,
        can_certify: keyInfo.canCertify,
        can_authenticate: keyInfo.canAuthenticate,
        expires_at: keyInfo.expiresAt,
        revoked: false,
        revocation_reason: null,
        last_used_at: null,
        is_default: makeDefault,
      })

      console.log()
      showSuccess('Keypair imported successfully!')
      console.log()
    } catch (error) {
      console.log()
      showError(`Error importing keypair: ${error}`)
      console.log()
    }
  }

  /**
   * Generate a new PGP keypair
   */
  async generateKeypair(setAsDefault: boolean = false): Promise<void> {
    printSectionHeader('Generate New Keypair')

    // Prompt for keypair details
    const { name: userName } = await escapeablePrompt([
      {
        type: 'input',
        name: 'name',
        message: promptMessage('Your name:'),
        validate: (input: string) =>
          input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    const { email } = await escapeablePrompt([
      {
        type: 'input',
        name: 'email',
        message: promptMessage('Your email:'),
        validate: (input: string) => {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
          return emailRegex.test(input) || 'Please enter a valid email address'
        },
      },
    ])

    const { keypairName } = await escapeablePrompt([
      {
        type: 'input',
        name: 'keypairName',
        message: promptMessage('Keypair name (e.g., "Personal", "Work"):'),
        default: 'Personal',
        validate: (input: string) =>
          input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    const { passphrase } = await escapeablePrompt([
      {
        type: 'password',
        name: 'passphrase',
        message: promptMessage(
          'Enter a passphrase to protect your private key:'
        ),
        mask: '*',
        validate: (input: string) =>
          input.length >= 8 || 'Passphrase must be at least 8 characters',
      },
    ])

    const { passphraseConfirm } = await escapeablePrompt([
      {
        type: 'password',
        name: 'passphraseConfirm',
        message: promptMessage('Confirm passphrase:'),
        mask: '*',
        validate: (input: string) =>
          input === passphrase || 'Passphrases do not match',
      },
    ])

    console.log()
    showLoading('Generating keypair... (this may take a moment)')
    console.log()

    try {
      // Generate the keypair
      const { privateKey, publicKey } = await openpgp.generateKey({
        type: 'rsa',
        rsaBits: 4096,
        userIDs: [{ name: userName, email: email }],
        passphrase: passphrase,
        format: 'armored',
      })

      // Extract key information
      const publicKeyInfo = await extractPublicKeyInfo(publicKey)
      const privateKeyInfo = await extractPrivateKeyInfo(privateKey, passphrase)

      // Store in database
      const keypair: Omit<Keypair, 'id' | 'created_at' | 'updated_at'> = {
        name: keypairName.trim(),
        email: publicKeyInfo.email,
        fingerprint: publicKeyInfo.fingerprint,
        public_key: publicKey,
        private_key: privateKey,
        passphrase_protected: true,
        algorithm: publicKeyInfo.algorithm,
        key_size: publicKeyInfo.keySize,
        can_sign: publicKeyInfo.canSign,
        can_encrypt: publicKeyInfo.canEncrypt,
        can_certify: publicKeyInfo.canCertify,
        can_authenticate: publicKeyInfo.canAuthenticate,
        expires_at: publicKeyInfo.expiresAt,
        revoked: false,
        revocation_reason: null,
        last_used_at: null,
        is_default: setAsDefault,
      }

      // If setting as default, unset all other defaults
      if (setAsDefault) {
        const allKeypairs = this.db.select({ table: 'keypair' })
        for (const kp of allKeypairs) {
          this.db.update(
            'keypair',
            { key: 'id', value: kp.id },
            { is_default: false }
          )
        }
      }

      this.db.insert('keypair', keypair)

      showSuccess('Keypair generated successfully!')
      console.log()
      console.log(colors.infoBold('Keypair details:'))
      printDivider()
      showKeyValue('Name', keypairName)
      showKeyValue('Email', publicKeyInfo.email)
      showKeyValue('Fingerprint', publicKeyInfo.fingerprint)
      showKeyValue(
        'Algorithm',
        `${publicKeyInfo.algorithm} (${publicKeyInfo.keySize} bits)`
      )
      printDivider()
      console.log()
    } catch (error) {
      console.log()
      showError(
        `Failed to generate keypair: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Import a keypair from system GPG
   */
  async importFromSystemGpg(): Promise<void> {
    printSectionHeader('Import from System GPG')

    // Check if GPG is installed
    if (!isGpgInstalled()) {
      showWarning('GPG is not installed on this system.')
      console.log(
        colors.muted('Install GPG to import keys from your system keyring.')
      )
      console.log()
      return
    }

    const gpgHome = getGpgHomeDir()
    if (gpgHome) {
      console.log(colors.muted(`GPG directory found: ${gpgHome}\n`))
    }

    // List available keys
    const { secretKeys } = listGpgKeys()

    if (secretKeys.length === 0) {
      showWarning('No secret keys found in your GPG keyring.')
      console.log(colors.muted('Generate or import keys into GPG first using:'))
      console.log(colors.muted('  gpg --gen-key'))
      console.log()
      return
    }

    console.log(colors.infoBold('Available GPG keys:\n'))
    secretKeys.forEach((key, index) => {
      console.log(colors.muted(`${index + 1}. ${key.name} <${key.email}>`))
      console.log(colors.muted(`   Fingerprint: ${key.fingerprint}`))
      console.log()
    })

    // Prompt user to select a key
    const { selectedIndex } = await escapeablePrompt([
      {
        type: 'list',
        name: 'selectedIndex',
        message: promptMessage('Select a key to import:'),
        choices: [
          ...secretKeys.map((key, index) => ({
            name: `${icons.key} ${key.name} ${colors.muted(`<${key.email}>`)}`,
            value: index,
          })),
          new inquirer.Separator(),
          cancelChoice(),
          mainMenuChoice(),
          new inquirer.Separator(),
        ],
      },
    ])

    if (
      selectedIndex === -1 ||
      selectedIndex === 'cancel' ||
      selectedIndex === 'main-menu'
    ) {
      return
    }

    const selectedKey = secretKeys[selectedIndex]
    if (!selectedKey) {
      showError('Invalid key selection')
      console.log()
      return
    }

    // Export the keys
    console.log()
    showLoading('Exporting keys from GPG...')
    console.log()

    const publicKey = exportGpgPublicKey(selectedKey.fingerprint)
    const privateKey = exportGpgSecretKey(selectedKey.fingerprint)

    if (!publicKey || !privateKey) {
      showError('Failed to export keys from GPG')
      console.log()
      return
    }

    // Prompt for keypair name
    const { name } = await escapeablePrompt([
      {
        type: 'input',
        name: 'name',
        message: promptMessage('Keypair name:'),
        default: selectedKey.name || 'Imported from GPG',
        validate: (input: string) =>
          input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    // Prompt for passphrase
    const { passphrase } = await escapeablePrompt([
      {
        type: 'password',
        name: 'passphrase',
        message: promptMessage(
          'Enter GPG key passphrase (if any, leave empty if none):'
        ),
        mask: '*',
      },
    ])

    // Extract key information
    try {
      const keyInfo = await extractPrivateKeyInfo(
        privateKey,
        passphrase || undefined
      )

      console.log()
      showSuccess('Key exported successfully!')
      console.log()
      console.log(colors.muted('Key Information:'))
      showKeyValue('  Email', keyInfo.email)
      showKeyValue('  Fingerprint', keyInfo.fingerprint)
      showKeyValue('  Algorithm', `${keyInfo.algorithm} (${keyInfo.keySize})`)
      showKeyValue(
        '  Passphrase Protected',
        keyInfo.passphraseProtected ? 'Yes' : 'No'
      )
      console.log()

      // Check if default should be set
      const { setDefault } = await escapeablePrompt([
        {
          type: 'confirm',
          name: 'setDefault',
          message: 'Set this as your default keypair?',
          default: true,
        },
      ])

      // If setting as default, unset current default
      if (setDefault) {
        const currentDefaults = this.db.select({
          table: 'keypair',
          where: { key: 'is_default', compare: 'is', value: 1 },
        })
        for (const kp of currentDefaults) {
          this.db.update(
            'keypair',
            { key: 'id', value: kp.id },
            { is_default: false }
          )
        }
      }

      // Save to database
      this.db.insert('keypair', {
        name: name.trim(),
        email: keyInfo.email,
        fingerprint: keyInfo.fingerprint,
        public_key: publicKey,
        private_key: privateKey,
        passphrase_protected: keyInfo.passphraseProtected,
        algorithm: keyInfo.algorithm,
        key_size: keyInfo.keySize,
        can_sign: keyInfo.canSign,
        can_encrypt: keyInfo.canEncrypt,
        can_certify: keyInfo.canCertify,
        can_authenticate: keyInfo.canAuthenticate,
        expires_at: keyInfo.expiresAt,
        revoked: false,
        revocation_reason: null,
        last_used_at: null,
        is_default: setDefault,
      })

      console.log()
      showSuccess('Keypair imported from GPG successfully!')
      console.log()
    } catch (error) {
      console.log()
      showError(`Error importing keypair: ${error}`)
      console.log()
    }
  }

  /**
   * List all keypairs
   */
  listKeypairs(): void {
    const keypairs = this.db.select({ table: 'keypair' })

    if (keypairs.length === 0) {
      console.log()
      showWarning('No keypairs found.')
      console.log()
      return
    }

    console.log(colors.infoBold('\nYour Keypairs:\n'))

    for (const keypair of keypairs) {
      printDivider()
      console.log(formatKeypairInfo(keypair))
    }

    printDivider()
    console.log()
  }

  /**
   * Show key management menu
   */
  async showKeyManagementMenu(): Promise<'back' | 'main-menu' | void> {
    const { action } = await escapeablePrompt([
      {
        type: 'list',
        name: 'action',
        message: promptMessage('Key Management'),
        choices: [
          { name: `${icons.key} View/manage my keys`, value: 'view' },
          { name: `${icons.contact} View/manage contacts`, value: 'contacts' },
          { name: `${icons.import} Import keypair`, value: 'import' },
          { name: `${icons.gpg} Import from system GPG`, value: 'import-gpg' },
          { name: `${icons.generate} Generate new keypair`, value: 'generate' },
          new inquirer.Separator(),
          mainMenuChoice(),
        ],
      },
    ])

    switch (action) {
      case 'view':
        const viewResult = await this.viewAndManageKeys()
        if (viewResult === 'main-menu') return 'main-menu'
        await this.showKeyManagementMenu()
        break
      case 'contacts':
        const contactsResult = await this.viewAndManageContacts()
        if (contactsResult === 'main-menu') return 'main-menu'
        await this.showKeyManagementMenu()
        break
      case 'import':
        await this.importKeypair()
        await this.showKeyManagementMenu()
        break
      case 'import-gpg':
        await this.importFromSystemGpg()
        await this.showKeyManagementMenu()
        break
      case 'generate':
        await this.generateKeypair()
        await this.showKeyManagementMenu()
        break
      case 'back':
      case 'main-menu':
        return
    }
  }

  /**
   * View and manage individual keys
   */
  private async viewAndManageKeys(): Promise<'main-menu' | void> {
    const keypairs = this.db.select({ table: 'keypair' })

    if (keypairs.length === 0) {
      console.log()
      showWarning('No keypairs found.')
      console.log()
      return
    }

    const { keypairId } = await escapeablePrompt([
      {
        type: 'list',
        name: 'keypairId',
        message: promptMessage('Select a key to manage:'),
        choices: [
          ...keypairs.map((kp) => ({
            name: `${icons.key} ${kp.name} ${colors.muted(`- ${obfuscateEmail(kp.email)}`)}${kp.is_default ? ` ${icons.default} Default` : ''}`,
            value: kp.id,
          })),
          new inquirer.Separator(),
          backChoice(),
          mainMenuChoice(),
          new inquirer.Separator(),
        ],
      },
    ])

    if (keypairId === 'main-menu') {
      return 'main-menu'
    }

    if (keypairId === null || keypairId === 'back') {
      return
    }

    const selectedKeypair = keypairs.find((kp) => kp.id === keypairId)
    if (!selectedKeypair) return

    const result = await this.manageIndividualKey(selectedKeypair)
    if (result === 'main-menu') return 'main-menu'
  }

  /**
   * Manage an individual key
   */
  private async manageIndividualKey(
    keypair: Keypair
  ): Promise<'main-menu' | void> {
    // Display key information
    printSectionHeader('Key Details')
    console.log(formatKeypairInfo(keypair))
    console.log()

    // Check if passphrase is stored in keychain
    const hasStoredPw = keypair.passphrase_protected
      ? await hasStoredPassphrase(keypair.fingerprint)
      : false

    // Build menu choices dynamically
    const choices: any[] = [
      { name: `${icons.copy} Copy public key`, value: 'copy-public' },
      { name: `${icons.export} Export keypair`, value: 'export' },
      { name: `${icons.edit} Rename key`, value: 'rename' },
      { name: `${icons.key} Set as default`, value: 'set-default' },
    ]

    // Add passphrase management option if applicable
    if (hasStoredPw) {
      choices.push({
        name: `${icons.unlocked} Clear saved passphrase ${colors.muted('(from keychain)')}`,
        value: 'clear-passphrase',
      })
    }

    choices.push(
      { name: `${icons.exit} Delete key`, value: 'delete' },
      new inquirer.Separator(),
      backChoice('Back to key list'),
      mainMenuChoice()
    )

    const { action } = await escapeablePrompt([
      {
        type: 'list',
        name: 'action',
        message: promptMessage('What would you like to do?'),
        choices,
      },
    ])

    switch (action) {
      case 'copy-public':
        await this.copyPublicKey(keypair)
        return this.manageIndividualKey(keypair)
      case 'export':
        await this.exportKeypair(keypair)
        return this.manageIndividualKey(keypair)
      case 'rename':
        await this.renameKeypair(keypair)
        // Refresh keypair data after rename
        const updated = this.db.select({
          table: 'keypair',
          where: { key: 'id', compare: 'is', value: keypair.id },
        })[0]
        if (updated) return this.manageIndividualKey(updated)
        break
      case 'set-default':
        await this.setDefaultKeypairById(keypair.id)
        // Refresh keypair data
        const refreshed = this.db.select({
          table: 'keypair',
          where: { key: 'id', compare: 'is', value: keypair.id },
        })[0]
        if (refreshed) return this.manageIndividualKey(refreshed)
        break
      case 'clear-passphrase':
        await this.clearStoredPassphrase(keypair)
        return this.manageIndividualKey(keypair)
      case 'delete':
        const deleted = await this.deleteKeypairById(keypair.id)
        if (!deleted) {
          return this.manageIndividualKey(keypair)
        }
        break
      case 'main-menu':
        return 'main-menu'
      case 'back':
        return
    }
  }

  /**
   * Copy public key to clipboard
   */
  private async copyPublicKey(keypair: Keypair): Promise<void> {
    console.clear()
    printBanner()

    console.log(colors.successBold('Public Key:\n'))
    printDivider()
    console.log(keypair.public_key)
    printDivider()

    try {
      const clipboardy = (await import('clipboardy')).default
      await clipboardy.write(keypair.public_key)
      console.log()
      showSuccess('Public key copied to clipboard')
      console.log()
    } catch (error) {
      console.log()
      showWarning('Clipboard unavailable')
      console.log()
    }
  }

  /**
   * Export keypair to files
   */
  private async exportKeypair(keypair: Keypair): Promise<void> {
    const { exportType } = await escapeablePrompt([
      {
        type: 'list',
        name: 'exportType',
        message: promptMessage('What would you like to export?'),
        choices: [
          { name: `${icons.view} Public key only`, value: 'public' },
          { name: `${icons.copy} Both public and private keys`, value: 'both' },
          new inquirer.Separator(),
          cancelChoice(),
          mainMenuChoice(),
        ],
      },
    ])

    if (exportType === 'cancel' || exportType === 'main-menu') return

    const { exportMethod } = await escapeablePrompt([
      {
        type: 'list',
        name: 'exportMethod',
        message: promptMessage('How would you like to export?'),
        choices: [
          { name: `${icons.clipboard} Copy to clipboard`, value: 'clipboard' },
          { name: `${icons.view} Display on screen`, value: 'display' },
          new inquirer.Separator(),
          cancelChoice(),
          mainMenuChoice(),
        ],
      },
    ])

    if (exportMethod === 'cancel' || exportMethod === 'main-menu') return

    let content = ''
    if (exportType === 'public') {
      content = keypair.public_key
    } else {
      content = `PUBLIC KEY:\n${keypair.public_key}\n\nPRIVATE KEY:\n${keypair.private_key}`
    }

    console.clear()
    printBanner()

    const label = exportType === 'public' ? 'Public Key' : 'Keypair'
    console.log(colors.successBold(`Exported ${label}:\n`))
    printDivider()
    console.log(content)
    printDivider()

    if (exportMethod === 'clipboard') {
      try {
        const clipboardy = (await import('clipboardy')).default
        await clipboardy.write(content)
        console.log()
        showSuccess(`${label} copied to clipboard`)
        console.log()
      } catch (error) {
        console.log()
        showWarning('Clipboard unavailable')
        console.log()
      }
    } else {
      console.log()
    }
  }

  /**
   * Rename a keypair
   */
  private async renameKeypair(keypair: Keypair): Promise<void> {
    const { newName } = await escapeablePrompt([
      {
        type: 'input',
        name: 'newName',
        message: promptMessage('Enter new name:'),
        default: keypair.name,
        validate: (input: string) =>
          input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    this.db.update(
      'keypair',
      { key: 'id', value: keypair.id },
      { name: newName.trim() }
    )
    console.log()
    showSuccess('Keypair renamed!')
    console.log()
  }

  /**
   * Set a keypair as default by ID
   */
  private async setDefaultKeypairById(keypairId: number): Promise<void> {
    const keypairs = this.db.select({ table: 'keypair' })

    // Unset all defaults
    for (const kp of keypairs) {
      this.db.update(
        'keypair',
        { key: 'id', value: kp.id },
        { is_default: false }
      )
    }

    // Set new default
    this.db.update(
      'keypair',
      { key: 'id', value: keypairId },
      { is_default: true }
    )

    console.log()
    showSuccess('Set as default keypair!')
    console.log()
  }

  /**
   * Clear stored passphrase from system keychain
   */
  private async clearStoredPassphrase(keypair: Keypair): Promise<void> {
    const { confirm } = await escapeablePrompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: promptMessage('Remove saved passphrase from system keychain?'),
        default: true,
      },
    ])

    if (confirm) {
      const deleted = await deleteStoredPassphrase(keypair.fingerprint)
      if (deleted) {
        console.log()
        showSuccess('Saved passphrase removed from system keychain.')
        console.log()
      } else {
        console.log()
        showWarning(
          'Could not remove passphrase (may not exist or keychain unavailable).'
        )
        console.log()
      }
    }
  }

  /**
   * Delete a keypair by ID
   */
  private async deleteKeypairById(keypairId: number): Promise<boolean> {
    const { confirm } = await escapeablePrompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: colors.error('Are you sure? This action cannot be undone.'),
        default: false,
      },
    ])

    if (confirm) {
      this.db.delete('keypair', { key: 'id', value: keypairId })
      console.log()
      showSuccess('Keypair deleted.')
      console.log()
      return true
    }
    return false
  }

  /**
   * Set a keypair as default
   */
  private async setDefaultKeypair(): Promise<void> {
    const keypairs = this.db.select({ table: 'keypair' })

    if (keypairs.length === 0) {
      console.log()
      showWarning('No keypairs available.')
      console.log()
      return
    }

    const { keypairId } = await escapeablePrompt([
      {
        type: 'list',
        name: 'keypairId',
        message: promptMessage('Select default keypair:'),
        choices: keypairs.map((kp) => ({
          name: `${icons.key} ${kp.name} ${colors.muted(`(${obfuscateEmail(kp.email)})`)} ${kp.is_default ? `${icons.default} Current Default` : ''}`,
          value: kp.id,
        })),
      },
    ])

    // Unset all defaults
    for (const kp of keypairs) {
      this.db.update(
        'keypair',
        { key: 'id', value: kp.id },
        { is_default: false }
      )
    }

    // Set new default
    this.db.update(
      'keypair',
      { key: 'id', value: keypairId },
      { is_default: true }
    )

    console.log()
    showSuccess('Default keypair updated!')
    console.log()
  }

  /**
   * Delete a keypair
   */
  private async deleteKeypair(): Promise<void> {
    const keypairs = this.db.select({ table: 'keypair' })

    if (keypairs.length === 0) {
      console.log()
      showWarning('No keypairs available.')
      console.log()
      return
    }

    const { keypairId } = await escapeablePrompt([
      {
        type: 'list',
        name: 'keypairId',
        message: promptMessage('Select keypair to delete:'),
        choices: keypairs.map((kp) => ({
          name: `${icons.key} ${kp.name} ${colors.muted(`(${obfuscateEmail(kp.email)})`)}`,
          value: kp.id,
        })),
      },
    ])

    const { confirm } = await escapeablePrompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: colors.error('Are you sure? This action cannot be undone.'),
        default: false,
      },
    ])

    if (confirm) {
      this.db.delete('keypair', { key: 'id', value: keypairId })
      console.log()
      showSuccess('Keypair deleted.')
      console.log()
    }
  }

  /**
   * Read multiline input from stdin
   */
  private async readMultilineInput(): Promise<string> {
    return new Promise((resolve) => {
      const lines: string[] = []
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
      rl.setPrompt('')

      rl.on('line', (line: string) => {
        lines.push(line)
      })

      rl.on('close', () => {
        resolve(lines.join('\n'))
      })
    })
  }

  /**
   * Read PGP key input with smart detection
   * Allows finishing with Enter when a complete key is detected, or Ctrl+D
   */
  private async readKeyInput(): Promise<string> {
    return new Promise((resolve) => {
      const lines: string[] = []
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
      rl.setPrompt('')

      rl.on('line', (line: string) => {
        lines.push(line)
        const content = lines.join('\n')

        // Check if we have a complete key block and current line is empty
        if (
          line.trim() === '' &&
          content.includes('-----BEGIN PGP') &&
          content.includes('-----END PGP')
        ) {
          rl.close()
          resolve(content.trim())
        }
      })

      rl.on('close', () => {
        resolve(lines.join('\n'))
      })
    })
  }

  /**
   * View and manage contacts
   */
  private async viewAndManageContacts(): Promise<'main-menu' | void> {
    const contacts = this.db.select({ table: 'contact' })

    if (contacts.length === 0) {
      console.log()
      showWarning('No contacts found.')
      console.log()
      return
    }

    const { contactId } = await escapeablePrompt([
      {
        type: 'list',
        name: 'contactId',
        message: promptMessage('Select a contact to manage:'),
        choices: [
          ...contacts.map((c) => ({
            name: `${icons.contact} ${c.name} ${colors.muted(`- ${c.email}`)}`,
            value: c.id,
          })),
          new inquirer.Separator(),
          backChoice(),
          mainMenuChoice(),
          new inquirer.Separator(),
        ],
      },
    ])

    if (contactId === 'main-menu') {
      return 'main-menu'
    }

    if (contactId === null || contactId === 'back') {
      return
    }

    const selectedContact = contacts.find((c) => c.id === contactId)
    if (!selectedContact) return

    const result = await this.manageIndividualContact(selectedContact)
    if (result === 'main-menu') return 'main-menu'
  }

  /**
   * Manage an individual contact
   */
  private async manageIndividualContact(
    contact: Contact
  ): Promise<'main-menu' | void> {
    // Display contact information
    printSectionHeader('Contact Details')
    showKeyValue('Name', contact.name)
    showKeyValue('Email', contact.email)
    showKeyValue('Fingerprint', contact.fingerprint)
    showKeyValue('Algorithm', `${contact.algorithm} (${contact.key_size})`)
    showKeyValue('Trusted', contact.trusted ? 'Yes' : 'No')
    if (contact.expires_at) {
      showKeyValue('Expires', contact.expires_at)
    }
    if (contact.notes) {
      showKeyValue('Notes', contact.notes)
    }
    console.log()

    const { action } = await escapeablePrompt([
      {
        type: 'list',
        name: 'action',
        message: promptMessage('What would you like to do?'),
        choices: [
          { name: `${icons.copy} Copy public key`, value: 'copy-public' },
          { name: `${icons.view} View public key`, value: 'view-public' },
          { name: `${icons.edit} Rename contact`, value: 'rename' },
          { name: `${icons.notes} Edit notes`, value: 'edit-notes' },
          { name: `${icons.trust} Toggle trust`, value: 'toggle-trust' },
          { name: `${icons.exit} Delete contact`, value: 'delete' },
          new inquirer.Separator(),
          backChoice('Back to contact list'),
          mainMenuChoice(),
        ],
      },
    ])

    switch (action) {
      case 'copy-public':
        await this.copyContactPublicKey(contact)
        return this.manageIndividualContact(contact)
      case 'view-public':
        await this.viewContactPublicKey(contact)
        return this.manageIndividualContact(contact)
      case 'rename':
        await this.renameContact(contact)
        const updated = this.db.select({
          table: 'contact',
          where: { key: 'id', compare: 'is', value: contact.id },
        })[0]
        if (updated) return this.manageIndividualContact(updated)
        break
      case 'edit-notes':
        await this.editContactNotes(contact)
        const updatedNotes = this.db.select({
          table: 'contact',
          where: { key: 'id', compare: 'is', value: contact.id },
        })[0]
        if (updatedNotes) return this.manageIndividualContact(updatedNotes)
        break
      case 'toggle-trust':
        await this.toggleContactTrust(contact)
        const refreshed = this.db.select({
          table: 'contact',
          where: { key: 'id', compare: 'is', value: contact.id },
        })[0]
        if (refreshed) return this.manageIndividualContact(refreshed)
        break
      case 'delete':
        const deleted = await this.deleteContact(contact.id)
        if (!deleted) {
          return this.manageIndividualContact(contact)
        }
        break
      case 'main-menu':
        return 'main-menu'
      case 'back':
        return
    }
  }

  /**
   * Copy contact's public key to clipboard
   */
  private async copyContactPublicKey(contact: Contact): Promise<void> {
    console.clear()
    printBanner()

    console.log(colors.successBold(`${contact.name}'s Public Key:\n`))
    printDivider()
    console.log(contact.public_key)
    printDivider()

    try {
      const clipboardy = (await import('clipboardy')).default
      await clipboardy.write(contact.public_key)
      console.log()
      showSuccess('Public key copied to clipboard')
      console.log()
    } catch (error) {
      console.log()
      showWarning('Clipboard unavailable')
      console.log()
    }
  }

  /**
   * View contact's public key
   */
  private async viewContactPublicKey(contact: Contact): Promise<void> {
    console.clear()
    printBanner()

    console.log(colors.successBold(`${contact.name}'s Public Key:\n`))
    printDivider()
    console.log(contact.public_key)
    printDivider()
    console.log()

    await escapeablePrompt([
      {
        type: 'input',
        name: 'continue',
        message: colors.muted('Press Enter to continue...'),
      },
    ])
  }

  /**
   * Rename a contact
   */
  private async renameContact(contact: Contact): Promise<void> {
    const { newName } = await escapeablePrompt([
      {
        type: 'input',
        name: 'newName',
        message: promptMessage('Enter new name:'),
        default: contact.name,
        validate: (input: string) =>
          input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    this.db.update(
      'contact',
      { key: 'id', value: contact.id },
      { name: newName.trim() }
    )
    console.log()
    showSuccess('Contact renamed!')
    console.log()
  }

  /**
   * Edit contact notes
   */
  private async editContactNotes(contact: Contact): Promise<void> {
    const { notes } = await escapeablePrompt([
      {
        type: 'input',
        name: 'notes',
        message: promptMessage('Enter notes:'),
        default: contact.notes || '',
      },
    ])

    this.db.update(
      'contact',
      { key: 'id', value: contact.id },
      { notes: notes.trim() || null }
    )
    console.log()
    showSuccess('Notes updated!')
    console.log()
  }

  /**
   * Toggle contact trust status
   */
  private async toggleContactTrust(contact: Contact): Promise<void> {
    const newTrustStatus = !contact.trusted
    this.db.update(
      'contact',
      { key: 'id', value: contact.id },
      {
        trusted: newTrustStatus,
        last_verified_at: newTrustStatus
          ? new Date().toISOString()
          : contact.last_verified_at,
      }
    )
    console.log()
    showSuccess(
      `Contact marked as ${newTrustStatus ? 'trusted' : 'untrusted'}!`
    )
    console.log()
  }

  /**
   * Delete a contact
   */
  private async deleteContact(contactId: number): Promise<boolean> {
    const { confirm } = await escapeablePrompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: colors.error('Are you sure? This action cannot be undone.'),
        default: false,
      },
    ])

    if (confirm) {
      this.db.delete('contact', { key: 'id', value: contactId })
      console.log()
      showSuccess('Contact deleted.')
      console.log()
      return true
    }
    return false
  }
}

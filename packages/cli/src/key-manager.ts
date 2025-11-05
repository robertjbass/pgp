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
} from './key-utils.js'
import {
  isGpgInstalled,
  listGpgKeys,
  exportGpgPublicKey,
  exportGpgSecretKey,
  getGpgHomeDir,
  type SystemKey,
} from './system-keys.js'

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
    console.log(chalk.blue('\n╔════════════════════════════════════════╗'))
    console.log(chalk.blue('║') + '  🔑  First Time Setup              ' + chalk.blue('║'))
    console.log(chalk.blue('╚════════════════════════════════════════╝\n'))

    console.log(
      chalk.yellow(
        'No PGP keypair found. You need to set up a keypair to use this tool.\n'
      )
    )

    // Check if GPG is available to offer system import
    const gpgAvailable = isGpgInstalled()
    const choices: any[] = [
      { name: '📥 Import existing keypair', value: 'import' },
    ]

    if (gpgAvailable) {
      choices.push({ name: '💻 Import from System GPG', value: 'import-gpg' })
    }

    choices.push(
      { name: '🔑 Generate new keypair', value: 'generate' },
      { name: '👋 Exit', value: 'exit' }
    )

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices,
      },
    ])

    if (action === 'exit') {
      console.log(chalk.blue('\n👋 Goodbye!\n'))
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
    console.log(chalk.blue('\n📥 Import Keypair\n'))

    // Check clipboard for keys
    let clipboardContent = ''
    let hasPublicInClipboard = false
    let hasPrivateInClipboard = false

    try {
      const clipboardy = (await import('clipboardy')).default
      clipboardContent = await clipboardy.read()
      hasPublicInClipboard = clipboardContent.includes('BEGIN PGP PUBLIC KEY BLOCK')
      hasPrivateInClipboard = clipboardContent.includes('BEGIN PGP PRIVATE KEY BLOCK')
    } catch (e) {
      // Clipboard not available, continue without it
    }

    // Prompt for keypair name
    const { name } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Keypair name (e.g., "Personal", "Work"):',
        default: 'Personal',
        validate: (input: string) => input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    // Get public and private keys
    let publicKey = ''
    let privateKey = ''
    let usedBothFromClipboard = false

    // Check if both keys are in clipboard
    if (hasPublicInClipboard && hasPrivateInClipboard) {
      const { useClipboard } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useClipboard',
          message: 'Both public and private keys detected in clipboard. Use them?',
          default: true,
        },
      ])

      if (useClipboard) {
        // Extract both keys from clipboard
        const publicMatch = clipboardContent.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/)
        const privateMatch = clipboardContent.match(/-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/)

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

    if (!publicKey) {
      console.log(chalk.yellow('\nPaste your PGP PUBLIC key (press Enter to finish, or press Enter then Ctrl+D):'))
      publicKey = await this.readKeyInput()
    }

    // Validate public key format
    if (!publicKey.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
      console.log(chalk.red('\n✗ Invalid public key format\n'))
      return
    }

    // Get private key if not already extracted
    if (!privateKey && hasPrivateInClipboard) {
      const { useClipboard } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useClipboard',
          message: 'Private key detected in clipboard. Use it?',
          default: true,
        },
      ])

      if (useClipboard) {
        const privateMatch = clipboardContent.match(/-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/)
        if (privateMatch) {
          privateKey = privateMatch[0]
        }
      }
    }

    if (!privateKey) {
      console.log(chalk.yellow('\nPaste your PGP PRIVATE key (press Enter to finish, or press Enter then Ctrl+D):'))
      privateKey = await this.readKeyInput()
    }

    // Validate private key format
    if (!privateKey.includes('BEGIN PGP PRIVATE KEY BLOCK')) {
      console.log(chalk.red('\n✗ Invalid private key format\n'))
      return
    }

    // Verify keys match
    console.log(chalk.blue('\n⏳ Verifying keypair...'))
    const keysMatch = await verifyKeyPair(publicKey, privateKey)

    if (!keysMatch) {
      console.log(
        chalk.red('\n✗ Public and private keys do not match. Please try again.\n')
      )
      return
    }

    // Prompt for passphrase if key is encrypted
    const { passphrase } = await inquirer.prompt([
      {
        type: 'password',
        name: 'passphrase',
        message: 'Enter passphrase for private key (leave empty if none):',
        mask: '*',
      },
    ])

    // Extract key information
    try {
      const keyInfo = await extractPrivateKeyInfo(privateKey, passphrase || undefined)

      console.log(chalk.blue('\n✓ Keypair verified!\n'))
      console.log(chalk.gray('Key Information:'))
      console.log(chalk.gray(`  Email: ${keyInfo.email}`))
      console.log(chalk.gray(`  Fingerprint: ${keyInfo.fingerprint}`))
      console.log(chalk.gray(`  Algorithm: ${keyInfo.algorithm} (${keyInfo.keySize})`))
      console.log(chalk.gray(`  Passphrase Protected: ${keyInfo.passphraseProtected ? 'Yes' : 'No'}`))
      console.log()

      // Check if default should be set
      let makeDefault = setAsDefault
      if (!setAsDefault) {
        const { setDefault } = await inquirer.prompt([
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
          this.db.update('keypair', { key: 'id', value: kp.id }, { is_default: false })
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

      console.log(chalk.green('\n✓ Keypair imported successfully!\n'))
    } catch (error) {
      console.log(chalk.red(`\n✗ Error importing keypair: ${error}\n`))
    }
  }

  /**
   * Generate a new PGP keypair
   */
  async generateKeypair(setAsDefault: boolean = false): Promise<void> {
    console.log(chalk.blue('\n🔑 Generate New Keypair\n'))

    // Prompt for keypair details
    const { name: userName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Your name:',
        validate: (input: string) => input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    const { email } = await inquirer.prompt([
      {
        type: 'input',
        name: 'email',
        message: 'Your email:',
        validate: (input: string) => {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
          return emailRegex.test(input) || 'Please enter a valid email address'
        },
      },
    ])

    const { keypairName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'keypairName',
        message: 'Keypair name (e.g., "Personal", "Work"):',
        default: 'Personal',
        validate: (input: string) => input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    const { passphrase } = await inquirer.prompt([
      {
        type: 'password',
        name: 'passphrase',
        message: 'Enter a passphrase to protect your private key:',
        mask: '*',
        validate: (input: string) => input.length >= 8 || 'Passphrase must be at least 8 characters',
      },
    ])

    const { passphraseConfirm } = await inquirer.prompt([
      {
        type: 'password',
        name: 'passphraseConfirm',
        message: 'Confirm passphrase:',
        mask: '*',
        validate: (input: string) => input === passphrase || 'Passphrases do not match',
      },
    ])

    console.log(chalk.blue('\n⏳ Generating keypair... (this may take a moment)\n'))

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
          this.db.update('keypair', { key: 'id', value: kp.id }, { is_default: false })
        }
      }

      this.db.insert('keypair', keypair)

      console.log(chalk.green('✓ Keypair generated successfully!\n'))
      console.log(chalk.blue('Keypair details:'))
      console.log(chalk.gray('─'.repeat(50)))
      console.log(`Name: ${keypairName}`)
      console.log(`Email: ${publicKeyInfo.email}`)
      console.log(`Fingerprint: ${publicKeyInfo.fingerprint}`)
      console.log(`Algorithm: ${publicKeyInfo.algorithm} (${publicKeyInfo.keySize} bits)`)
      console.log(chalk.gray('─'.repeat(50)) + '\n')
    } catch (error) {
      console.log(
        chalk.red('\n✗ Failed to generate keypair:'),
        error instanceof Error ? error.message : error
      )
    }
  }

  /**
   * Import a keypair from system GPG
   */
  async importFromSystemGpg(): Promise<void> {
    console.log(chalk.blue('\n💻 Import from System GPG\n'))

    // Check if GPG is installed
    if (!isGpgInstalled()) {
      console.log(chalk.yellow('GPG is not installed on this system.\n'))
      console.log(chalk.gray('Install GPG to import keys from your system keyring.\n'))
      return
    }

    const gpgHome = getGpgHomeDir()
    if (gpgHome) {
      console.log(chalk.gray(`GPG directory found: ${gpgHome}\n`))
    }

    // List available keys
    const { secretKeys } = listGpgKeys()

    if (secretKeys.length === 0) {
      console.log(chalk.yellow('No secret keys found in your GPG keyring.\n'))
      console.log(chalk.gray('Generate or import keys into GPG first using:'))
      console.log(chalk.gray('  gpg --gen-key\n'))
      return
    }

    console.log(chalk.blue('Available GPG keys:\n'))
    secretKeys.forEach((key, index) => {
      console.log(chalk.gray(`${index + 1}. ${key.name} <${key.email}>`))
      console.log(chalk.gray(`   Fingerprint: ${key.fingerprint}`))
      console.log()
    })

    // Prompt user to select a key
    const { selectedIndex } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedIndex',
        message: 'Select a key to import:',
        choices: [
          ...secretKeys.map((key, index) => ({
            name: `${key.name} <${key.email}>`,
            value: index,
          })),
          { name: '← Cancel', value: -1 },
        ],
      },
    ])

    if (selectedIndex === -1) {
      return
    }

    const selectedKey = secretKeys[selectedIndex]
    if (!selectedKey) {
      console.log(chalk.red('✗ Invalid key selection\n'))
      return
    }

    // Export the keys
    console.log(chalk.blue('\n⏳ Exporting keys from GPG...\n'))

    const publicKey = exportGpgPublicKey(selectedKey.fingerprint)
    const privateKey = exportGpgSecretKey(selectedKey.fingerprint)

    if (!publicKey || !privateKey) {
      console.log(chalk.red('✗ Failed to export keys from GPG\n'))
      return
    }

    // Prompt for keypair name
    const { name } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Keypair name:',
        default: selectedKey.name || 'Imported from GPG',
        validate: (input: string) => input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    // Prompt for passphrase
    const { passphrase } = await inquirer.prompt([
      {
        type: 'password',
        name: 'passphrase',
        message: 'Enter GPG key passphrase (if any, leave empty if none):',
        mask: '*',
      },
    ])

    // Extract key information
    try {
      const keyInfo = await extractPrivateKeyInfo(privateKey, passphrase || undefined)

      console.log(chalk.blue('\n✓ Key exported successfully!\n'))
      console.log(chalk.gray('Key Information:'))
      console.log(chalk.gray(`  Email: ${keyInfo.email}`))
      console.log(chalk.gray(`  Fingerprint: ${keyInfo.fingerprint}`))
      console.log(chalk.gray(`  Algorithm: ${keyInfo.algorithm} (${keyInfo.keySize})`))
      console.log(chalk.gray(`  Passphrase Protected: ${keyInfo.passphraseProtected ? 'Yes' : 'No'}`))
      console.log()

      // Check if default should be set
      const { setDefault } = await inquirer.prompt([
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
          this.db.update('keypair', { key: 'id', value: kp.id }, { is_default: false })
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

      console.log(chalk.green('\n✓ Keypair imported from GPG successfully!\n'))
    } catch (error) {
      console.log(chalk.red(`\n✗ Error importing keypair: ${error}\n`))
    }
  }

  /**
   * List all keypairs
   */
  listKeypairs(): void {
    const keypairs = this.db.select({ table: 'keypair' })

    if (keypairs.length === 0) {
      console.log(chalk.yellow('\nNo keypairs found.\n'))
      return
    }

    console.log(chalk.blue('\n🔑 Your Keypairs:\n'))

    for (const keypair of keypairs) {
      console.log(chalk.gray('─'.repeat(50)))
      console.log(formatKeypairInfo(keypair))
    }

    console.log(chalk.gray('─'.repeat(50)) + '\n')
  }

  /**
   * Show key management menu
   */
  async showKeyManagementMenu(): Promise<void> {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Key Management',
        choices: [
          { name: '🔑 View/Manage My Keys', value: 'view' },
          { name: '👥 View/Manage Contacts', value: 'contacts' },
          { name: '📥 Import keypair', value: 'import' },
          { name: '💻 Import from System GPG', value: 'import-gpg' },
          { name: '🔐 Generate new keypair', value: 'generate' },
          { name: '← Back to main menu', value: 'back' },
        ],
      },
    ])

    switch (action) {
      case 'view':
        await this.viewAndManageKeys()
        await this.showKeyManagementMenu()
        break
      case 'contacts':
        await this.viewAndManageContacts()
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
        return
    }
  }

  /**
   * View and manage individual keys
   */
  private async viewAndManageKeys(): Promise<void> {
    const keypairs = this.db.select({ table: 'keypair' })

    if (keypairs.length === 0) {
      console.log(chalk.yellow('\nNo keypairs found.\n'))
      return
    }

    const { keypairId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'keypairId',
        message: 'Select a key to manage:',
        choices: [
          ...keypairs.map((kp) => ({
            name: `${kp.name} - ${kp.email}${kp.is_default ? ' ✓ Default' : ''}`,
            value: kp.id,
          })),
          { name: '← Back', value: null },
        ],
      },
    ])

    if (keypairId === null) {
      return
    }

    const selectedKeypair = keypairs.find((kp) => kp.id === keypairId)
    if (!selectedKeypair) return

    await this.manageIndividualKey(selectedKeypair)
  }

  /**
   * Manage an individual key
   */
  private async manageIndividualKey(keypair: Keypair): Promise<void> {
    // Display key information
    console.log(chalk.blue('\n╔════════════════════════════════════════╗'))
    console.log(chalk.blue('║') + '  🔑  Key Details                   ' + chalk.blue('║'))
    console.log(chalk.blue('╚════════════════════════════════════════╝\n'))
    console.log(formatKeypairInfo(keypair))
    console.log()

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📋 Copy public key', value: 'copy-public' },
          { name: '💾 Export keypair', value: 'export' },
          { name: '✏️  Rename key', value: 'rename' },
          { name: '⭐ Set as default', value: 'set-default' },
          { name: '🗑️  Delete key', value: 'delete' },
          { name: '← Back to key list', value: 'back' },
        ],
      },
    ])

    switch (action) {
      case 'copy-public':
        await this.copyPublicKey(keypair)
        await this.manageIndividualKey(keypair)
        break
      case 'export':
        await this.exportKeypair(keypair)
        await this.manageIndividualKey(keypair)
        break
      case 'rename':
        await this.renameKeypair(keypair)
        // Refresh keypair data after rename
        const updated = this.db.select({
          table: 'keypair',
          where: { key: 'id', compare: 'is', value: keypair.id },
        })[0]
        if (updated) await this.manageIndividualKey(updated)
        break
      case 'set-default':
        await this.setDefaultKeypairById(keypair.id)
        // Refresh keypair data
        const refreshed = this.db.select({
          table: 'keypair',
          where: { key: 'id', compare: 'is', value: keypair.id },
        })[0]
        if (refreshed) await this.manageIndividualKey(refreshed)
        break
      case 'delete':
        const deleted = await this.deleteKeypairById(keypair.id)
        if (!deleted) {
          await this.manageIndividualKey(keypair)
        }
        break
      case 'back':
        return
    }
  }

  /**
   * Copy public key to clipboard
   */
  private async copyPublicKey(keypair: Keypair): Promise<void> {
    try {
      const clipboardy = (await import('clipboardy')).default
      await clipboardy.write(keypair.public_key)
      console.log(chalk.green('\n✓ Public key copied to clipboard!\n'))
    } catch (error) {
      console.log(chalk.red('\n✗ Failed to copy to clipboard\n'))
      console.log(chalk.gray('Public key:'))
      console.log(keypair.public_key)
      console.log()
    }
  }

  /**
   * Export keypair to files
   */
  private async exportKeypair(keypair: Keypair): Promise<void> {
    const { exportType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'exportType',
        message: 'What would you like to export?',
        choices: [
          { name: '🔓 Public key only', value: 'public' },
          { name: '🔐 Both public and private keys', value: 'both' },
          { name: '← Cancel', value: 'cancel' },
        ],
      },
    ])

    if (exportType === 'cancel') return

    const { exportMethod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'exportMethod',
        message: 'How would you like to export?',
        choices: [
          { name: '📋 Copy to clipboard', value: 'clipboard' },
          { name: '🖥️  Display on screen', value: 'display' },
          { name: '← Cancel', value: 'cancel' },
        ],
      },
    ])

    if (exportMethod === 'cancel') return

    let content = ''
    if (exportType === 'public') {
      content = keypair.public_key
    } else {
      content = `PUBLIC KEY:\n${keypair.public_key}\n\nPRIVATE KEY:\n${keypair.private_key}`
    }

    if (exportMethod === 'clipboard') {
      try {
        const clipboardy = (await import('clipboardy')).default
        await clipboardy.write(content)
        console.log(chalk.green(`\n✓ ${exportType === 'public' ? 'Public key' : 'Keypair'} copied to clipboard!\n`))
      } catch (error) {
        console.log(chalk.red('\n✗ Failed to copy to clipboard\n'))
      }
    } else {
      console.log(chalk.blue('\n╔════════════════════════════════════════╗'))
      console.log(chalk.blue('║') + '  📄 Exported Key(s)                ' + chalk.blue('║'))
      console.log(chalk.blue('╚════════════════════════════════════════╝\n'))
      console.log(content)
      console.log()
    }
  }

  /**
   * Rename a keypair
   */
  private async renameKeypair(keypair: Keypair): Promise<void> {
    const { newName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'newName',
        message: 'Enter new name:',
        default: keypair.name,
        validate: (input: string) => input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    this.db.update('keypair', { key: 'id', value: keypair.id }, { name: newName.trim() })
    console.log(chalk.green('\n✓ Keypair renamed!\n'))
  }

  /**
   * Set a keypair as default by ID
   */
  private async setDefaultKeypairById(keypairId: number): Promise<void> {
    const keypairs = this.db.select({ table: 'keypair' })

    // Unset all defaults
    for (const kp of keypairs) {
      this.db.update('keypair', { key: 'id', value: kp.id }, { is_default: false })
    }

    // Set new default
    this.db.update('keypair', { key: 'id', value: keypairId }, { is_default: true })

    console.log(chalk.green('\n✓ Set as default keypair!\n'))
  }

  /**
   * Delete a keypair by ID
   */
  private async deleteKeypairById(keypairId: number): Promise<boolean> {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.red('Are you sure? This action cannot be undone.'),
        default: false,
      },
    ])

    if (confirm) {
      this.db.delete('keypair', { key: 'id', value: keypairId })
      console.log(chalk.green('\n✓ Keypair deleted.\n'))
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
      console.log(chalk.yellow('\nNo keypairs available.\n'))
      return
    }

    const { keypairId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'keypairId',
        message: 'Select default keypair:',
        choices: keypairs.map((kp) => ({
          name: `${kp.name} (${kp.email}) ${kp.is_default ? '✓ Current Default' : ''}`,
          value: kp.id,
        })),
      },
    ])

    // Unset all defaults
    for (const kp of keypairs) {
      this.db.update('keypair', { key: 'id', value: kp.id }, { is_default: false })
    }

    // Set new default
    this.db.update('keypair', { key: 'id', value: keypairId }, { is_default: true })

    console.log(chalk.green('\n✓ Default keypair updated!\n'))
  }

  /**
   * Delete a keypair
   */
  private async deleteKeypair(): Promise<void> {
    const keypairs = this.db.select({ table: 'keypair' })

    if (keypairs.length === 0) {
      console.log(chalk.yellow('\nNo keypairs available.\n'))
      return
    }

    const { keypairId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'keypairId',
        message: 'Select keypair to delete:',
        choices: keypairs.map((kp) => ({
          name: `${kp.name} (${kp.email})`,
          value: kp.id,
        })),
      },
    ])

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.red('Are you sure? This action cannot be undone.'),
        default: false,
      },
    ])

    if (confirm) {
      this.db.delete('keypair', { key: 'id', value: keypairId })
      console.log(chalk.green('\n✓ Keypair deleted.\n'))
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

      rl.on('line', (line: string) => {
        lines.push(line)
        const content = lines.join('\n')

        // Check if we have a complete key block and current line is empty
        if (line.trim() === '' &&
            content.includes('-----BEGIN PGP') &&
            content.includes('-----END PGP')) {
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
  private async viewAndManageContacts(): Promise<void> {
    const contacts = this.db.select({ table: 'contact' })

    if (contacts.length === 0) {
      console.log(chalk.yellow('\nNo contacts found.\n'))
      return
    }

    const { contactId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'contactId',
        message: 'Select a contact to manage:',
        choices: [
          ...contacts.map((c) => ({
            name: `${c.name} - ${c.email}`,
            value: c.id,
          })),
          { name: '← Back', value: null },
        ],
      },
    ])

    if (contactId === null) {
      return
    }

    const selectedContact = contacts.find((c) => c.id === contactId)
    if (!selectedContact) return

    await this.manageIndividualContact(selectedContact)
  }

  /**
   * Manage an individual contact
   */
  private async manageIndividualContact(contact: Contact): Promise<void> {
    // Display contact information
    console.log(chalk.blue('\n╔════════════════════════════════════════╗'))
    console.log(chalk.blue('║') + '  👤 Contact Details                ' + chalk.blue('║'))
    console.log(chalk.blue('╚════════════════════════════════════════╝\n'))
    console.log(chalk.cyan('Name:') + ` ${contact.name}`)
    console.log(chalk.cyan('Email:') + ` ${contact.email}`)
    console.log(chalk.cyan('Fingerprint:') + ` ${contact.fingerprint}`)
    console.log(chalk.cyan('Algorithm:') + ` ${contact.algorithm} (${contact.key_size})`)
    console.log(chalk.cyan('Trusted:') + ` ${contact.trusted ? 'Yes' : 'No'}`)
    if (contact.expires_at) {
      console.log(chalk.cyan('Expires:') + ` ${contact.expires_at}`)
    }
    if (contact.notes) {
      console.log(chalk.cyan('Notes:') + ` ${contact.notes}`)
    }
    console.log()

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📋 Copy public key', value: 'copy-public' },
          { name: '🖥️  View public key', value: 'view-public' },
          { name: '✏️  Rename contact', value: 'rename' },
          { name: '📝 Edit notes', value: 'edit-notes' },
          { name: '⭐ Toggle trust', value: 'toggle-trust' },
          { name: '🗑️  Delete contact', value: 'delete' },
          { name: '← Back to contact list', value: 'back' },
        ],
      },
    ])

    switch (action) {
      case 'copy-public':
        await this.copyContactPublicKey(contact)
        await this.manageIndividualContact(contact)
        break
      case 'view-public':
        await this.viewContactPublicKey(contact)
        await this.manageIndividualContact(contact)
        break
      case 'rename':
        await this.renameContact(contact)
        const updated = this.db.select({
          table: 'contact',
          where: { key: 'id', compare: 'is', value: contact.id },
        })[0]
        if (updated) await this.manageIndividualContact(updated)
        break
      case 'edit-notes':
        await this.editContactNotes(contact)
        const updatedNotes = this.db.select({
          table: 'contact',
          where: { key: 'id', compare: 'is', value: contact.id },
        })[0]
        if (updatedNotes) await this.manageIndividualContact(updatedNotes)
        break
      case 'toggle-trust':
        await this.toggleContactTrust(contact)
        const refreshed = this.db.select({
          table: 'contact',
          where: { key: 'id', compare: 'is', value: contact.id },
        })[0]
        if (refreshed) await this.manageIndividualContact(refreshed)
        break
      case 'delete':
        const deleted = await this.deleteContact(contact.id)
        if (!deleted) {
          await this.manageIndividualContact(contact)
        }
        break
      case 'back':
        return
    }
  }

  /**
   * Copy contact's public key to clipboard
   */
  private async copyContactPublicKey(contact: Contact): Promise<void> {
    try {
      const clipboardy = (await import('clipboardy')).default
      await clipboardy.write(contact.public_key)
      console.log(chalk.green('\n✓ Public key copied to clipboard!\n'))
    } catch (error) {
      console.log(chalk.red('\n✗ Failed to copy to clipboard\n'))
      console.log(chalk.gray('Public key:'))
      console.log(contact.public_key)
      console.log()
    }
  }

  /**
   * View contact's public key
   */
  private async viewContactPublicKey(contact: Contact): Promise<void> {
    console.log(chalk.blue('\n╔════════════════════════════════════════╗'))
    console.log(chalk.blue('║') + '  📄 Public Key                     ' + chalk.blue('║'))
    console.log(chalk.blue('╚════════════════════════════════════════╝\n'))
    console.log(contact.public_key)
    console.log()

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: chalk.cyan('Press Enter to continue...'),
      },
    ])
  }

  /**
   * Rename a contact
   */
  private async renameContact(contact: Contact): Promise<void> {
    const { newName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'newName',
        message: 'Enter new name:',
        default: contact.name,
        validate: (input: string) => input.trim().length > 0 || 'Name cannot be empty',
      },
    ])

    this.db.update('contact', { key: 'id', value: contact.id }, { name: newName.trim() })
    console.log(chalk.green('\n✓ Contact renamed!\n'))
  }

  /**
   * Edit contact notes
   */
  private async editContactNotes(contact: Contact): Promise<void> {
    const { notes } = await inquirer.prompt([
      {
        type: 'input',
        name: 'notes',
        message: 'Enter notes:',
        default: contact.notes || '',
      },
    ])

    this.db.update('contact', { key: 'id', value: contact.id }, { notes: notes.trim() || null })
    console.log(chalk.green('\n✓ Notes updated!\n'))
  }

  /**
   * Toggle contact trust status
   */
  private async toggleContactTrust(contact: Contact): Promise<void> {
    const newTrustStatus = !contact.trusted
    this.db.update('contact', { key: 'id', value: contact.id }, {
      trusted: newTrustStatus,
      last_verified_at: newTrustStatus ? new Date().toISOString() : contact.last_verified_at
    })
    console.log(chalk.green(`\n✓ Contact marked as ${newTrustStatus ? 'trusted' : 'untrusted'}!\n`))
  }

  /**
   * Delete a contact
   */
  private async deleteContact(contactId: number): Promise<boolean> {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.red('Are you sure? This action cannot be undone.'),
        default: false,
      },
    ])

    if (confirm) {
      this.db.delete('contact', { key: 'id', value: contactId })
      console.log(chalk.green('\n✓ Contact deleted.\n'))
      return true
    }
    return false
  }
}

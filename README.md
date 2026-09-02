# LPGP

Interactive CLI tool for PGP encryption/decryption with SQLite key management.

> **Note:** This is a personal side project created to learn more about encryption and PGP. It's a work in progress and should be used for educational purposes.

## Project Status

This project is **actively being developed** as a learning exercise. While functional, it may contain bugs or security considerations that need addressing. Use at your own discretion and avoid using it for highly sensitive production data.

## Features

- **PGP Encryption/Decryption** - Secure message encryption using OpenPGP
- **SQLite Key Management** - Store and manage multiple keypairs and contacts
- **Passphrase Caching** - Unlock a key once per machine; the passphrase is kept in an owner-only encrypted cache
- **Clipboard Integration** - Seamlessly encrypt/decrypt from clipboard
- **Multiple Input Methods** - Clipboard, text editor, or inline terminal input
- **Cross-Platform Support** - Works on Linux, macOS, and Windows
- **Smart Editor Detection** - Auto-detects available editors (VS Code, Vim, Nano, etc.)
- **Scriptable CLI** - Non-interactive commands for CI/CD and scripting

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- pnpm (v10.19.0 or higher)

### Installation

#### Option 1: Automated Installer (Recommended for Non-Developers)

1. Clone the repository:

```bash
git clone https://github.com/robertjbass/lpgp.git
cd lpgp
```

2. Run the installer:

```bash
./install.sh
```

The installer will:

- Detect your operating system and shell
- Check for Node.js and install it if missing (using nvm)
- Check for pnpm and install it if missing
- Install all dependencies and compile native modules
- Build the project
- Optionally create an `lpgp` command alias

3. Run the tool and create or import your keys:

```bash
pnpm dev
```

Use the Key Management menu to generate new keypairs or import existing ones.

#### Option 2: Manual Installation (For Developers)

1. Clone the repository:

```bash
git clone https://github.com/robertjass/lpgp.git
cd lpgp
```

2. Install dependencies:

```bash
pnpm install
```

3. Build the project:

```bash
pnpm build
```

4. Database initialization:

The SQLite database is automatically created on first run at `~/.lpgp/data.db`. No manual setup required!

### Usage

#### Quick Start with npx

```bash
npx lpgp
```

#### Run from Source

```bash
pnpm dev
```

You'll be greeted with an interactive menu:

```
╔════════════════════════════════════════╗
║  🔐  PGP Encryption/Decryption Tool   ║
╚════════════════════════════════════════╝

? What would you like to do?
  🔒 Encrypt a message
  🔓 Decrypt a message
  👋 Exit
```

## How It Works

### Encrypting a Message

1. Select "🔒 Encrypt a message"
2. Choose your input method:
   - **📋 Paste from clipboard** - Automatically encrypts text from your clipboard
   - **📝 Use an editor** - Opens your preferred text editor
   - **⌨️ Type inline** - Enter text directly (press Enter, then Ctrl+D to finish)
3. The encrypted message is displayed and automatically copied to your clipboard

### Decrypting a Message

1. Select "🔓 Decrypt a message"
2. Choose your input method for the encrypted text
3. The decrypted message is displayed and automatically copied to your clipboard

### CLI Commands (Non-Interactive)

For scripting and CI/CD, lpgp supports non-interactive commands:

```bash
# Generate a new keypair
lpgp generate --name "Your Name" --email "you@example.com" --passphrase "secret"
lpgp generate --name "Your Name" --email "you@example.com" --no-passphrase
lpgp generate ... --type rsa --expires 730   # RSA 4096 instead of Curve25519, 2-year expiry

# List all keypairs
lpgp list-keys
lpgp list-keys --json

# Manage keypairs
lpgp import-key --file secret.asc --passphrase "secret" --set-default
lpgp set-default ABCD1234
lpgp rename-key ABCD1234 "Work"
lpgp delete-key ABCD1234 --yes
lpgp export-private --fingerprint ABCD1234 --output backup.asc
lpgp clear-cache --all              # forget cached passphrases
lpgp generate ... --no-cache        # never write the passphrase to the cache

# Contacts (other people's public keys)
lpgp import-contact --file alice.pub
lpgp list-contacts --json
lpgp remove-contact alice@example.com

# Export public key
lpgp export-public
lpgp export-public --fingerprint ABC123 --json

# Encrypt a message
lpgp encrypt "Hello World" --to user@example.com
lpgp encrypt --file message.txt --to ABC123 --output encrypted.pgp
echo "Hello" | lpgp encrypt --to user@example.com

# Decrypt a message
lpgp decrypt "-----BEGIN PGP MESSAGE-----..."
lpgp decrypt --file encrypted.pgp --passphrase "secret"
cat encrypted.pgp | lpgp decrypt
lpgp decrypt --key ABCD1234 --file encrypted.pgp   # force a specific keypair

# Signing (encrypt signs with your default key unless --no-sign)
lpgp encrypt "Hello" --to user@example.com --no-sign
lpgp encrypt "Hello" --to user@example.com --sign-with ABCD1234
lpgp sign "I approve this" > approval.asc           # clear-signed, not encrypted
lpgp verify --file approval.asc                     # status on stderr, text on stdout

# Help
lpgp --help
lpgp encrypt --help
```

**Signatures:** `decrypt` and `verify` report the signature result on stderr (`Signature: Signed by Alice <alice@example.com> (verified)`), keep the message on stdout, and exit with code 4 when a signature is invalid. Add a sender's public key as a contact to verify their signatures.

**Exit codes:** 0 success, 1 usage or unexpected error, 2 wrong passphrase / decryption failed, 3 key or recipient not found, 4 bad or unverifiable signature.

**Passphrase sources for decryption and signing:**
1. `--passphrase` command line option
2. `LPGP_PASSPHRASE` environment variable
3. Local passphrase cache at `~/.lpgp/.cache` (populated the first time you unlock a key interactively)

## Development

### Available Scripts

```bash
# Run the PGP tool (development)
pnpm dev

# Format code with Prettier
pnpm format

# Build the TypeScript project
pnpm build

# Run the built project
pnpm start
```

### Project Structure

```
lpgp/
├── src/
│   ├── pgp-tool.ts       # Main CLI entry point
│   ├── cli-commands.ts   # Non-interactive commands: generate, encrypt, decrypt, sign, verify
│   ├── cli-manage.ts     # Non-interactive key and contact management commands
│   ├── passphrase-store.ts # Encrypted local passphrase cache
│   ├── key-manager.ts    # Key management UI
│   ├── key-utils.ts      # Key utility functions
│   ├── db.ts             # SQLite database layer
│   ├── ui.ts             # Centralized UI styling
│   └── schema.sql        # Database schema
├── dist/                 # Built output (not in git)
├── package.json
├── tsconfig.json
└── README.md
```

## Roadmap

See [TODO.md](TODO.md) for the complete project roadmap. Completed and upcoming features:

- SQLite database integration
- Local passphrase cache
- Key generation and management
- Multi-recipient encryption
- Contact management
- File encryption/decryption (planned)
- GPG keyring import (planned)

## Security Considerations

As this is a learning project, please note:

- Keys are stored in a SQLite database at `~/.lpgp/data.db`. The directory and file are owner-only (`0700` / `0600`).
- Passphrases you enter interactively are cached in `~/.lpgp/.cache` (owner-only, AES-256-GCM). The cache key is derived from machine identity (hostname, username, home directory), not a secret, so it prevents casual reading but not a determined attacker with access to your home directory. Use "Clear cached passphrase" in the key manager to forget one.
- Passing `--passphrase` on the command line exposes it to shell history and process listings; prefer the `LPGP_PASSPHRASE` environment variable in scripts.
- The `.gitignore` excludes database and `.env` files
- This tool has not undergone professional security audit
- For production use, consider more secure key storage methods (e.g., hardware tokens)

## Contributing

This is primarily a personal learning project, but suggestions and feedback are welcome! Feel free to:

- Open issues for bugs or feature requests
- Submit pull requests with improvements
- Share your experience using the tool

## License

**Source Available Educational License** - NOT Open Source

This software is source-available for educational purposes, security auditing, and learning only. Commercial use and use by for-profit enterprises is prohibited without explicit permission. See the [LICENSE](LICENSE) file for full terms.

The source code is publicly available to promote transparency, enable security audits, and support learning about encryption and web development - but this does not make it open source software.

## Acknowledgments

- Built with [OpenPGP.js](https://openpgpjs.org/) for encryption
- [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) for beautiful CLI prompts
- [Chalk](https://github.com/chalk/chalk) for terminal styling
- [Clipboardy](https://github.com/sindresorhus/clipboardy) for clipboard operations

---

**Learning Focus:** This project explores:

- PGP encryption and cryptography fundamentals
- Node.js CLI development with TypeScript
- Security best practices for handling sensitive data
- Trade-offs in local credential caching

It's a work in progress and will continue to evolve as I learn more about encryption and secure communication.

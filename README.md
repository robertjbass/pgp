# LPGP

Interactive CLI tool for PGP encryption/decryption with SQLite key management.

> **Note:** This is a personal side project created to learn more about encryption and PGP. It's a work in progress and should be used for educational purposes.

## Project Status

This project is **actively being developed** as a learning exercise. While functional, it may contain bugs or security considerations that need addressing. Use at your own discretion and avoid using it for highly sensitive production data.

## Features

- **PGP Encryption/Decryption** - Secure message encryption using OpenPGP
- **SQLite Key Management** - Store and manage multiple keypairs and contacts
- **System Keychain Integration** - Passphrases stored securely in your OS keychain
- **Clipboard Integration** - Seamlessly encrypt/decrypt from clipboard
- **Multiple Input Methods** - Clipboard, text editor, or inline terminal input
- **Cross-Platform Support** - Works on Linux, macOS, and Windows
- **Smart Editor Detection** - Auto-detects available editors (VS Code, Vim, Nano, etc.)

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

This will install all Node.js dependencies including `better-sqlite3`, which requires native compilation.

3. Build the project:

```bash
pnpm build
```

4. Database initialization:

The SQLite database is automatically created on first run at `~/.lpgp/data.db`. No manual setup required!

### Usage

Run the PGP tool:

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
│   ├── encrypt.ts        # Encryption logic
│   ├── decrypt.ts        # Decryption logic
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
- System keychain passphrase storage
- Key generation and management
- Multi-recipient encryption
- Contact management
- File encryption/decryption (planned)
- GPG keyring import (planned)

## Security Considerations

As this is a learning project, please note:

- Passphrases are stored in your system keychain (macOS Keychain, Windows Credential Manager, etc.)
- Keys are stored in SQLite database at `~/.lpgp/data.db`
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
- System keychain integration for secure credential storage

It's a work in progress and will continue to evolve as I learn more about encryption and secure communication.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LPGP** is a learning project focused on PGP encryption/decryption. It's an interactive CLI tool for PGP operations with SQLite key management and system keychain integration.

**Key Learning Goals:**

- Understanding PGP encryption and cryptography
- Building secure CLI applications
- Security best practices for handling sensitive data

**Important:** This is an educational project - not production-ready. It's licensed under a source-available educational license (NOT open source).

## Development Commands

```bash
# Run the interactive PGP CLI tool (development)
pnpm dev

# Build TypeScript to JavaScript
pnpm build

# Run the built output
pnpm start

# Format all code with Prettier
pnpm format
```

## Architecture

### Project Structure

```
lpgp/
├── src/
│   ├── pgp-tool.ts      # Main CLI entry point (interactive + CLI routing)
│   ├── cli-commands.ts  # Non-interactive CLI command handlers
│   ├── encrypt.ts       # Encryption logic
│   ├── decrypt.ts       # Decryption logic
│   ├── key-manager.ts   # Key management UI
│   ├── key-utils.ts     # Key utility functions
│   ├── db.ts            # SQLite database layer
│   ├── ui.ts            # Centralized UI styling
│   └── schema.sql       # Database schema
├── dist/                # Built output
├── package.json
├── tsconfig.json
└── install.sh           # Automated installer
```

### Core Components

- **pgp-tool.ts** - Main CLI entry point; routes to interactive mode or CLI commands
- **cli-commands.ts** - Non-interactive CLI commands (generate, encrypt, decrypt, etc.)
- **encrypt.ts** - Encryption using OpenPGP.js with recipient selection
- **decrypt.ts** - Decryption with automatic key detection
- **key-manager.ts** - Key management (generate, import, export, contacts)
- **key-utils.ts** - Shared key utilities and validation
- **db.ts** - SQLite database for storing keys and contacts
- **ui.ts** - Centralized UI module with colors, icons, and helpers

### Data Storage

- **Database:** `~/.lpgp/data.db` - SQLite database for keys and contacts
- **Passphrases:** System keychain via `cross-keychain` (secure storage)

### Input Methods (Interactive Mode)

The interactive CLI supports three input methods for encrypt/decrypt:

1. **Clipboard** - Uses `clipboardy` to read from system clipboard
2. **Editor** - Dynamically detects available editors (VS Code, Vim, Nano, etc.)
3. **Inline** - Node.js `readline` for multiline terminal input (Ctrl+D to finish)

### CLI Commands (Non-Interactive)

Running with arguments invokes non-interactive mode via commander.js:

```bash
lpgp generate --name "Name" --email "email" --passphrase "secret"
lpgp export-public [--fingerprint <fp>] [--json]
lpgp list-keys [--json]
lpgp encrypt "message" --to <fingerprint|email>
lpgp decrypt "message" [--passphrase <pass>]
lpgp              # No args = interactive mode
```

## Code Style & Patterns

- **TypeScript:** Strict mode enabled with rigorous type checking
- **Module System:** ESM (ES Modules) with `"type": "module"`
- **UI Consistency:** All menus use centralized `ui.ts` for colors and icons
- **Error Handling:** User-facing errors use chalk for colored console output
- **Async/Await:** Preferred over callbacks/promise chains

## Security Considerations

- Passphrases stored in system keychain (not in files)
- Keys stored in SQLite database at `~/.lpgp/data.db`
- Never commit `.env` files (in `.gitignore`)
- This is educational code - not audited for production use

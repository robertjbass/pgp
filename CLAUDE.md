# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LPGP** is a learning project focused on PGP encryption/decryption. It's an interactive CLI tool for PGP operations with SQLite key management and a local passphrase cache.

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
│   ├── cli-commands.ts  # Non-interactive commands: generate, encrypt, decrypt, sign, verify
│   ├── cli-manage.ts    # Non-interactive key/contact management commands
│   ├── passphrase-store.ts # Encrypted local passphrase cache
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
- **cli-commands.ts** - Non-interactive commands (generate, export, list, encrypt, decrypt, sign, verify) plus shared CLI helpers
- **cli-manage.ts** - Non-interactive key/contact management (import, set-default, delete, rename, contacts, cache)
- **passphrase-store.ts** - Local passphrase cache, AES-256-GCM with a per-install random secret
- **key-utils.ts** - Key parsing, capability detection, message/key matching, signature verification helpers
- **key-manager.ts** - Key management (generate, import, export, contacts)
- **db.ts** - SQLite database for storing keys and contacts
- **ui.ts** - Centralized UI module with colors, icons, and helpers

### Data Storage

- **Database:** `~/.lpgp/data.db` - SQLite database for keys and contacts
- **Passphrases:** `~/.lpgp/.cache` - AES-256-GCM encrypted with a machine-derived key (see `passphrase-store.ts`); owner-only permissions

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
lpgp encrypt "message" --to <fingerprint|email> [--no-sign | --sign-with <fp>]
lpgp decrypt "message" [--passphrase <pass>] [--key <fp>]
lpgp sign "message" [--key <fp>]
lpgp verify "signed message"
lpgp import-key [armored] [--file <path>] [--passphrase <pass>] [--set-default]
lpgp import-contact [armored] [--file <path>]  |  lpgp list-contacts [--json]  |  lpgp remove-contact <fp|email>
lpgp set-default <fp>  |  lpgp rename-key <fp> <name>  |  lpgp delete-key <fp> --yes
lpgp export-private [--fingerprint <fp>] [--output <path>]  |  lpgp clear-cache [--fingerprint <fp> | --all]
lpgp              # No args = interactive mode
```

## Code Style & Patterns

- **TypeScript:** Strict mode enabled with rigorous type checking
- **Module System:** ESM (ES Modules) with `"type": "module"`
- **UI Consistency:** All menus use centralized `ui.ts` for colors and icons
- **Error Handling:** User-facing errors use chalk for colored console output
- **Async/Await:** Preferred over callbacks/promise chains

## Security Considerations

- `~/.lpgp` and everything in it must stay owner-only (0700 dir, 0600 files); `config.ts` enforces this on startup
- Keys stored in SQLite database at `~/.lpgp/data.db`
- Cached passphrases live in `~/.lpgp/.cache`; the cache key is machine-derived, not secret
- Never commit `.env` files (in `.gitignore`)
- This is educational code - not audited for production use

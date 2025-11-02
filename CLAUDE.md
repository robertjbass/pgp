# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Dash** is a learning project focused on PGP encryption/decryption with two main components:
1. A fully-functional interactive CLI tool for PGP operations (current)
2. A planned web application with progressive enhancement (future)

**Key Learning Goals:**
- Understanding PGP encryption and cryptography
- Building accessible web applications that work without JavaScript
- Progressive enhancement: server-side encryption fallback + client-side enhancements
- Security best practices for handling sensitive data

**Important:** This is an educational project - not production-ready. It's licensed under a source-available educational license (NOT open source).

## Development Commands

### Running the Application
```bash
# Run the interactive PGP CLI tool (main entrypoint)
pnpm pgp

# Run the placeholder web server (not yet implemented)
pnpm serve

# Build TypeScript to JavaScript
pnpm build

# Run the built output
pnpm start
```

### Code Maintenance
```bash
# Format all code with Prettier
pnpm format
```

## Architecture

### Current State: CLI Tool Only

The project currently consists of:
- **[src/pgp-tool.ts](src/pgp-tool.ts)** - Main CLI application with interactive menus, encryption/decryption, and multiple input methods
- **[src/index.ts](src/index.ts)** - Placeholder HTTP server (to be replaced with Express)

### Core Encryption Flow

All encryption/decryption uses **OpenPGP.js**:

1. **Encryption** ([src/pgp-tool.ts:21-34](src/pgp-tool.ts#L21-L34)):
   - Reads `PGP_PUBLIC_KEY` from environment
   - Uses `openpgp.encrypt()` with the public key
   - Returns armored encrypted message

2. **Decryption** ([src/pgp-tool.ts:36-59](src/pgp-tool.ts#L36-L59)):
   - Reads `PGP_PRIVATE_KEY` and `PGP_PASSPHRASE` from environment
   - Decrypts the private key using the passphrase
   - Uses `openpgp.decrypt()` to decrypt the message
   - **Important:** Passphrase is ALWAYS required because the private key stored in `.env` is passphrase-protected

### Input Methods Architecture

The CLI supports three input methods (implemented for both encrypt/decrypt):

1. **Clipboard** - Uses `clipboardy` to read from system clipboard
2. **Editor** - Dynamically detects available editors (VS Code, Vim, Nano, etc.) using `which` command, then opens selected editor via Inquirer's editor prompt
3. **Inline** - Uses Node.js `readline` interface for multiline terminal input (Ctrl+D to finish)

Editor detection ([src/pgp-tool.ts:70-96](src/pgp-tool.ts#L70-L96)) checks platform and availability, supporting different defaults on macOS (TextEdit), Windows (Notepad), and Linux (detected editors).

### Environment Configuration

**Current:** `.env` file with three required variables:
- `PGP_PUBLIC_KEY` - Armored public key for encryption
- `PGP_PRIVATE_KEY` - Armored private key for decryption (must be passphrase-protected)
- `PGP_PASSPHRASE` - Passphrase to unlock the private key

**Important:** There must be a blank line after the `BEGIN` header in PGP keys in the `.env` file.

**Planned Migration:** Move from `.env` to a config file (JSON/YAML) for better structure and validation.

## Future Architecture (Web Application)

The roadmap includes building a web application with **progressive enhancement**:

### Progressive Enhancement Strategy

The web UI will support TWO modes:

1. **No JavaScript (Baseline):**
   - Traditional HTML forms with POST requests
   - Server-side encryption using Express backend
   - Form submission sends plaintext to server, returns encrypted result
   - Ensures functionality for users without JS or with accessibility tools

2. **JavaScript Enabled (Enhancement):**
   - Real-time "encrypt as you type" using Petite Vue
   - Client-side encryption for immediate feedback
   - Still falls back to server-side if needed

### Planned Tech Stack

- **Backend:** Express.js (replacing [src/index.ts](src/index.ts) placeholder)
- **Database:** SQLite for storing configurations/keys
- **Frontend:** Minimal HTML + Petite Vue for progressive enhancement
- **Forms:** Traditional POST-based forms as baseline

## Code Style & Patterns

- **TypeScript:** Strict mode enabled with rigorous type checking
- **Module System:** ESM (ES Modules) with `"type": "module"` in package.json
- **Path Aliases:** `@/*` maps to `src/*` (configured in [tsconfig.json](tsconfig.json))
- **Error Handling:** User-facing errors use chalk for colored console output
- **Async/Await:** Preferred over callbacks/promises chains

## Security Considerations

- Never commit `.env` files (already in `.gitignore`)
- Private keys in environment variables are NOT production-safe - this is acknowledged as educational code
- Future: Consider hardware tokens, system keychains, or proper key management systems
- The passphrase protection on the private key is mandatory for this codebase

## Roadmap Reference

See [TODO.md](TODO.md) for the full roadmap. High-priority items:
- SQLite database integration
- Config file to replace `.env`
- Express backend setup
- **Progressive enhancement landing page** (core learning goal)
- PGP key detection from system (`~/.gnupg`)

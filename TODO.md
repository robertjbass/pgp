# TODO List

## High Priority

- [ ] Add SQLite database integration
  - Set up database connection with better-sqlite3
  - Implement core database schema migration
  - Update Keypair table with missing fields:
    - Add `expires_at` (ISO date or null)
    - Add `revoked` (boolean)
    - Add `revocation_reason` (string, optional)
    - Add `algorithm` (string: "RSA", "EdDSA", etc.)
    - Add `key_size` (number or curve name)
    - Add `can_sign`, `can_encrypt`, `can_certify`, `can_authenticate` (boolean flags)
    - Add `last_used_at` (timestamp, optional)
  - Update Contact table with missing fields:
    - Add `expires_at` (ISO date or null)
    - Add `revoked` (boolean)
    - Add `last_verified_at` (timestamp, optional)
    - Add `algorithm` (string)
    - Add `key_size` (number)
  - Restructure Settings table from key/value to typed fields:
    - `default_keypair_id` (number or null)
    - `auto_sign_messages` (boolean)
    - `prefer_inline_pgp` (boolean)
    - `keyserver_url` (string)
  - Add database constraints:
    - UNIQUE constraint on `fingerprint` for both Keypair and Contact
    - UNIQUE constraint on `email` for Keypair
    - Indexes on `email` and `fingerprint` for fast lookups
  - Migrate existing JSON data to SQLite
  - Update Database class to use SQLite instead of JSON file

- [ ] Create bash install script
  - Automate dependency installation
  - Set up environment configuration
  - Handle PGP key setup

- [ ] Create config file to replace environment variables
  - Design configuration file structure (JSON/YAML)
  - Implement config file parser
  - Migrate from .env to config file
  - Add config validation

## Medium Priority

- [ ] Install Express as backend server
  - Set up Express server to replace placeholder
  - Create API endpoints for PGP operations
  - Handle encryption/decryption via HTTP requests
  - Prepare for web UI integration

- [ ] Create standalone landing page with progressive enhancement
  - Build simple, lightweight UI for quick encryption
  - **Implement server-side encryption to work WITHOUT JavaScript in browser**
  - Use traditional HTML forms with POST requests for no-JS fallback
  - Implement real-time encrypt option with Petite Vue (encrypt as you type) when JS is enabled
  - Progressive enhancement: basic functionality works without JS, enhanced features with JS
  - Keep page minimal and fast-loading
  - Support both public key and passphrase-based encryption
  - Test thoroughly with JS disabled in browser

- [ ] Add settings management
  - Create settings interface
  - Implement settings CRUD operations
  - Add settings persistence
  - Allow customization of default editor, clipboard behavior, etc.

- [ ] Add PGP key detection
  - Auto-detect PGP keys from common locations (~/.gnupg)
  - Import existing keys from system
  - Validate key format and expiration
  - Support multiple key profiles

- [ ] Add UI improvements
  - Enhance current CLI interface
  - Add progress indicators for long operations
  - Improve error messages and user feedback
  - Add color themes/customization

## Future Enhancements

- [ ] Add key generation feature
- [ ] Support for multiple recipients
- [ ] File encryption/decryption
- [ ] Key management (import/export/delete)
- [ ] Backup and restore functionality
- [ ] Add tests (unit and integration)
- [ ] Add logging functionality
- [ ] Create documentation

## Completed

- [x] Basic PGP encryption/decryption
- [x] Interactive CLI with inquirer
- [x] Multiple input methods (clipboard, editor, inline)
- [x] Auto-detect available text editors
- [x] Clipboard integration
- [x] Graceful exit handling

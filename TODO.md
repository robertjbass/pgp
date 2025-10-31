# TODO List

## High Priority

- [ ] Add SQLite database integration
  - Set up database schema
  - Add database connection management
  - Implement data persistence layer

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

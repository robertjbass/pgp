# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.0] - 2026-09-02

### Features

- Messages are signed with the default key by default; decrypt verifies and reports signatures (green verified, yellow unknown signer, red invalid). Toggle under "Manage keys & contacts".
- New `sign` and `verify` commands for clear-signed text; `encrypt --no-sign` / `--sign-with <fp>`.
- Non-interactive key and contact management: `import-key`, `import-contact`, `list-contacts`, `remove-contact`, `set-default`, `delete-key`, `rename-key`, `export-private`, `clear-cache`, and `generate --no-cache`.
- `decrypt --key <fingerprint>` to force a specific keypair.
- Generate offers Curve25519 (default) or RSA 4096 and an optional expiry; CLI `generate --type ecc|rsa --expires <days>`.
- Contacts can be added manually from a pasted or clipboard public key.
- "Copy decrypted text to clipboard" is now a setting.

### Bug Fixes

- Decrypt matches messages against encryption subkeys, so a second or non-default keypair can decrypt in both interactive and CLI modes.
- Setting a default keypair is transactional and happens after a successful insert; a failed import can no longer leave no default. Deleting the default promotes or prompts for a new one; startup recovers when keys exist but none is default.
- Keypairs may share an email address (one-time table rebuild for existing databases).
- CLI output is flushed before exit; large encrypted messages no longer truncate through a pipe. Decrypted plaintext is written byte-exact.
- `--to` requires an exact email, full fingerprint, or 8+ hex suffix and errors on ambiguous matches; unknown subcommands error instead of opening the menu.
- Escape works after using the inline editor, no longer swallows the next error, and skips startup prompts instead of crashing.
- VS Code and TextEdit wait for the file to be saved; encrypt failures keep the message; expired or revoked contacts are labelled and disabled.
- Key capability and revocation flags are read from the key; sign-only keys import.
- GPG import shows the primary fingerprint and first user ID.
- The key-management menu no longer blocks on npm on every render; version detection works for pnpm installs; prerelease versions compare correctly.
- Imported keys verify the passphrase with retries and cache it.

### Security

- `~/.lpgp` is created 0700 and `data.db` 0600; stale WAL/SHM journal files are removed.
- Passphrase cache is encrypted with a random per-install secret (old caches migrate transparently) and is never wiped by a failed read; cached passphrases are removed when a key is deleted or the passphrase stops working.
- Private-key export asks for confirmation and keeps the private block out of terminal scrollback when copying to the clipboard.
- Database saves are atomic; a corrupt file reports clearly at startup.

### Documentation

- README and CLAUDE.md describe the local passphrase cache honestly (the OS keychain is no longer used), list every CLI command, and document exit codes.
- New `plans/` folder with a master tracker and per-plan files.

### Removed

- Dead `encrypt.ts`, `decrypt.ts`, `keychain.ts` modules and the `cross-keychain` and `@types/inquirer` dependencies.

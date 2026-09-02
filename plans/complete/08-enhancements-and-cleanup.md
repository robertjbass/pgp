# 08 - Enhancements and cleanup

**Status:** complete
**Priority:** 8
**Source:** Audit 2026-09-02

## Enhancements

- [x] **Add contact manually** in the contacts menu (paste public key). Today contacts only appear as a side effect of encrypting to a pasted key.
- [x] **Import from private key only.** Derive the public block with `privateKey.toPublic().armor()` instead of requiring a separate public block.
- [x] **Modern key defaults.** Offer curve25519 (`type: 'ecc'`) with an expiry, keep RSA-4096 as an option.
- [x] **Passphrase cache key.** The AES key is derived from hostname, username, and home dir, all public. Options: keep as obfuscation but document it honestly, or derive from a random secret stored 0600 (still same-user readable, but survives hostname changes), or return to the OS keychain. Also stop wiping the whole cache when one entry fails to decrypt.
- [x] **Atomic DB save.** Write to a temp file and rename; catch "file is not a database" on init with a recovery message.
- [x] **Clipboard.** Ask before copying decrypted plaintext, or make it a setting.
- [x] **Contact list masking** matches keypair views (recent commit 67842dc masked keypair emails only).
- [x] **Algorithm display**: show "RSA" not `rsaEncryptSign`.
- [x] **Inline editor**: strip `\r` from pasted CRLF text; handle Tab. (Wide-character cursor math left as is; cosmetic only.)

## Cleanup

- [x] Delete dead files: `src/encrypt.ts`, `src/decrypt.ts`, `src/keychain.ts`. Remove `cross-keychain` from `package.json` (pulls in a native optional dep).
- [x] Remove unused imports/functions in `src/key-manager.ts` (`chalk`, `SystemKey`, `readMultilineInput`, `setDefaultKeypair`, `deleteKeypair`).
- [x] `.npmrc` and `install.sh` still reference better-sqlite3.
- [x] `settings.default_keypair_id` documented as unused in `schema.sql` (dropping it needs a table rebuild for no benefit; no FK behaviour is relied on).
- [x] `db.insert()` returns raw 0/1 booleans; `like` does not escape `%`/`_`; `where.key` type accepts wrong-table columns.
- [x] `package.json`: removed `@types/inquirer`; `engines.node >=20`. (No `lint` script: ESLint is not set up in this repo; ask before adding it.)
- [x] `version-check.yml` treats a registry failure as `0.0.0`, letting a non-bumped PR pass when npm is unreachable.

## Completion notes (2026-09-02)

- Contacts menu has "Add contact (paste public key)" (clipboard-aware, refuses own keys, updates an existing fingerprint). Contact emails are masked like keypair views.
- Interactive import no longer asks for a public key; it is derived from the private key unless one is in the clipboard.
- Generate offers Curve25519 (default) or RSA 4096 and Never / 1 year / 2 years expiry; CLI `generate --type ecc|rsa --expires <days>` (default ecc, never).
- `passphrase-store.ts`: cache key derived from a random per-install secret in `~/.lpgp/.cache-key` (0600). Caches written with the old hostname-derived key are read and re-encrypted transparently. An unreadable cache is reported once and replaced only on the next write, never on a read.
- `db.ts`: atomic save (temp + rename); a corrupt file fails at startup with a clear message; `insert()` returns converted booleans; `like` escapes `%`/`_`; `where.key` is typed per table; versioned migration 2 adds `copy_decrypted_to_clipboard`.
- "Copy decrypted text to clipboard" is a toggle in the key-management menu (default on).
- Algorithm labels are human-friendly ("RSA 4096", "EdDSA (ed25519)"); ECC key size records the curve.
- Removed `src/encrypt.ts`, `src/decrypt.ts`, `src/keychain.ts`, the `cross-keychain` and `@types/inquirer` dependencies, dead key-manager functions and imports, and better-sqlite3 leftovers in `.npmrc` / `install.sh`.
- Both workflows fail instead of assuming `0.0.0` when npm is unreachable.
- Verified by script: legacy cache migration, unreadable cache, atomic save, corrupt DB message, boolean conversion, LIKE escaping, settings column, ecc/rsa generation with expiry, signed round trip with an ecc key. Menu changes verified by review.

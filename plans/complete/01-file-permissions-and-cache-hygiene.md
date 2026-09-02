# 01 - File permissions and passphrase-cache hygiene

**Status:** complete
**Priority:** 1
**Source:** Audit 2026-09-02

## Why

`~/.lpgp` is created 0755 and `data.db` (which holds armored private keys) is written 0644, so any local user, backup agent, or sync tool can read every private key. The passphrase cache is 0600 but sits next to the keys, so the protection is nullified. Stale `data.db-wal` / `data.db-shm` files from the better-sqlite3 era are also world-readable and may hold private-key pages. Deleting a keypair never removes its cached passphrase. A wrong cached passphrase is never evicted.

## Scope

- [x] `src/config.ts` / `src/db.ts`: create `~/.lpgp` with mode 0700; write `data.db` with mode 0600; chmod existing dir and file on init so current users are fixed on next launch.
- [x] `src/db.ts`: on init, if stale `data.db-wal` / `data.db-shm` exist, warn and remove them (sql.js never reads them; a real SQLite client would replay a stale WAL over newer data).
- [x] `src/key-manager.ts`: call `removeCachedPassphrase(fingerprint)` in every keypair-delete path.
- [x] `src/pgp-tool.ts` `unlockKeypair`: when a cached passphrase fails to unlock the key, evict it so the "Saved passphrase is invalid" warning does not repeat every launch.
- [x] `src/key-manager.ts`: warn and confirm before exporting a private key; do not echo the private block to the terminal when the destination is the clipboard.
- [x] Docs: README and CLAUDE.md still say passphrases are in the system keychain. Describe the local cache (and its limits) accurately.

## Out of scope

Replacing the cache's machine-derived key with a real secret (see plan 08). Removing `keychain.ts` / `cross-keychain` (plan 08).

## Verification

- `ls -la ~/.lpgp` shows `drwx------` and `-rw-------` after one launch.
- Delete a keypair, confirm its fingerprint is gone from `.cache`.
- Corrupt a cached passphrase, launch, confirm the warning appears once and the entry is removed.

## Completion notes (2026-09-02)

- `config.ts` now exports `ensurePrivate`, `PRIVATE_DIR_MODE`, `PRIVATE_FILE_MODE`; `getConfigDir()` creates and tightens the dir.
- `db.ts` writes with mode 0600 and chmods on every save; removes `-wal`/`-shm` on init with a stderr notice.
- `key-manager.ts`: `removeKeypair()` helper deletes the row and the cached passphrase; both delete paths use it. Private export asks for confirmation, warns, and does not echo the private block when copying to clipboard.
- `pgp-tool.ts`: a cached passphrase that fails to unlock is evicted.
- README and CLAUDE.md describe the local cache honestly.
- Verified in a throwaway HOME: dir 0700, db 0600, stale journals removed.

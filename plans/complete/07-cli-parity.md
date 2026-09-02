# 07 - CLI parity with interactive mode

**Status:** complete
**Priority:** 7
**Source:** Audit 2026-09-02

## Why

CLAUDE.md and README describe the tool as CLI-first, but most key management is interactive-only. After a "no default key" state (plan 02) there is no non-interactive way to recover.

## Scope

- [x] `import-key` (armored private [+ public] from file/stdin, `--passphrase`, `--set-default`)
- [x] `import-contact` (armored public key), `list-contacts [--json]`, `remove-contact <fp|email>`
- [x] `set-default <fingerprint>`
- [x] `delete-key <fingerprint>` (with `--yes`), also removes the cached passphrase
- [x] `rename-key <fingerprint> <name>`
- [x] `export-private [--fingerprint <fp>]` with a stderr warning
- [x] `cache clear [--fingerprint <fp>]`
- [x] `decrypt --key <fp>` (landed in plan 03)
- [x] `generate --no-cache` so scripted use does not persist the passphrase; document argv/env exposure in README.
- [x] Update README command list.

## Out of scope

Signing commands (plan 06).

## Completion notes (2026-09-02)

- New module `src/cli-manage.ts`: `import-key` (derives the public key when only a private block is given; verifies the passphrase; `--name`, `--set-default`, `--no-cache`), `import-contact` (adds or refreshes; refuses your own keys), `list-contacts [--json]`, `remove-contact <fp|email>`, `set-default`, `delete-key --yes` (forgets the cached passphrase and promotes the only remaining key), `rename-key`, `export-private` (stderr warning; `--output` written 0600), `clear-cache --fingerprint|--all`.
- `generate --no-cache`.
- Shared helpers (`fail`, `readInput`, `writeStdout`, `requireKeypairByFingerprint`, `resolvePassphrase`, `getDb`) exported from `cli-commands.ts`.
- README and CLAUDE.md list every command.
- Verified by script in a throwaway HOME: all commands, wrong passphrase (rc 2), duplicate import (rc 1), missing contact (rc 3), delete without `--yes` refused, default promotion after delete.

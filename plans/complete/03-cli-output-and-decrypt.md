# 03 - CLI: stdout truncation, decrypt with any key, recipient lookup

**Status:** complete
**Priority:** 3
**Source:** Audit 2026-09-02

## Why

Every CLI command calls `process.exit()` right after writing to stdout. On macOS pipes are asynchronous, so output larger than the pipe buffer is truncated: a 543 KB encrypted message came out as exactly 65,536 bytes through `| wc -c`. `lpgp encrypt ... | pbcopy` silently produces a broken message. CLI `decrypt` only ever tries the default keypair, the same class of bug fixed interactively in plan 00. `--to` uses substring matching with no ambiguity check, so `--to ""` and `--to e` both succeed and encrypt to the first row.

## Scope

- [x] `src/cli-commands.ts`: never call `process.exit` after writing output. Set `process.exitCode` and return, or wait for the write callback. Apply to encrypt, decrypt, export-public, list-keys.
- [x] CLI `decrypt`: collect the message's encryption key IDs, match against all stored keypairs via `key.getKeys(id)` (share the helper from `src/pgp-tool.ts` by moving it to `src/key-utils.ts`), then resolve a passphrase per candidate (`--passphrase` -> `LPGP_PASSPHRASE` -> cache). Add `--key <fingerprint>` to force one.
- [x] `resolveRecipient`: reject empty input; match exact fingerprint, exact email (case-insensitive), or unique fingerprint suffix; error with a list when more than one candidate matches. Normalize whitespace the same way `getKeypairByFingerprint` does.
- [x] `decrypt`: write plaintext with `process.stdout.write` (no trailing newline) so round trips are byte-exact.
- [x] `src/db.ts`: migration messages go to stderr so `--json` output stays valid on first run after upgrade.
- [x] `src/pgp-tool.ts` dispatch: let commander own routing so an unknown subcommand errors instead of opening the TUI.
- [x] Exit codes: "no default keypair" -> `EXIT_KEY_NOT_FOUND`; unparseable private key should not say "Wrong passphrase?".

## Verification

- `lpgp encrypt --file big.txt --to <fp> | wc -c` equals the `--output` file size.
- `printf hi | lpgp encrypt --to <fp> | lpgp decrypt | xxd` shows exactly `hi`.
- Message for a non-default key decrypts via CLI with its cached passphrase.
- `lpgp encrypt x --to ""` and an ambiguous partial fingerprint both error.
- `lpgp encrpyt` prints commander's unknown-command error.

## Completion notes (2026-09-02)

- `cli-commands.ts` rewritten: all stdout goes through an awaited `writeStdout()` before `process.exit`; a 1 MB encrypted message now arrives intact through a pipe.
- `decrypt` matches the message's recipient key IDs against every stored keypair (shared `filterKeysForMessage()` in `key-utils.ts`, also used by the interactive path), prefers the default, resolves a passphrase per key (`--passphrase` -> `LPGP_PASSPHRASE` -> cache), and supports `--key <fingerprint>`.
- Recipient and fingerprint lookup (`fingerprintMatches()`): exact email, full fingerprint, or a suffix of 8+ hex chars; empty and short inputs are rejected; ambiguous matches list the candidates and exit 3.
- Plaintext is written without a trailing newline (byte-exact round trip verified with xxd).
- DB migration messages go to stderr; `list-keys --json` stays valid.
- Dispatch: no args = interactive, anything else = commander, which rejects unknown subcommands ("Did you mean encrypt?").
- Exit codes: missing default / unknown recipient / message not for your keys = 3; wrong passphrase or crypto failure = 2; usage/parse errors = 1.

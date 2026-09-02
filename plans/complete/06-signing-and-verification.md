# 06 - Signing and signature verification

**Status:** complete
**Priority:** 6
**Source:** Audit 2026-09-02

## Why

Neither mode signs outgoing messages or verifies incoming ones. `openpgp.decrypt` returns signatures and the code discards them, so a user cannot tell a verified message from an unsigned one. `settings.auto_sign_messages` exists in the schema and is never read. For a PGP tool this is the biggest feature gap.

## Decisions (made 2026-09-02)

- Default behavior: sign by default when the sender has an unlocked key, or opt-in per message?
- Verification display: show "Signed by <contact>" / "Signed by unknown key" / "Signature INVALID" on decrypt. Should an invalid signature still show the plaintext (with a warning)?
- CLI flags: `encrypt --sign [--sign-with <fp>]`, `decrypt` prints verification status to stderr, plus `sign` / `verify` commands for clear-signed text.

## Scope

- [x] Interactive encrypt: pass `signingKeys` (default keypair, unlocked) when signing is on.
- [x] Interactive decrypt: pass `verificationKeys` (all contacts + own keys), await each signature's `verified`, display result.
- [x] Read/write `settings.auto_sign_messages`; expose it in the key-management menu.
- [x] CLI: `--sign`, verification output on decrypt, `sign` and `verify` commands.
- [x] Docs.

## Verification

- Round trip signed message between two local keypairs; tamper one byte of the ciphertext; confirm the invalid-signature path.

## Completion notes (2026-09-02)

Decisions: sign by default; invalid signature still shows plaintext under a warning; CLI flags `--no-sign`, `--sign-with <fp>`, `--passphrase` on `encrypt`; `sign` and `verify` commands; verification status on stderr; exit code 4 for a bad or unverifiable signature.

- `key-utils.ts`: `readVerificationKeys()`, `summarizeSignatures()`, `describeSignature()` shared by both modes. Every stored keypair and contact is a verification key; a signer whose key is not stored reports as "unknown".
- `db.ts`: `getSettings()` / `updateSettings()`; `update()` no longer adds `updated_at` to the settings table; `PRAGMA user_version` migration framework, step 1 turns `auto_sign_messages` on once for existing databases. Schema default is now 1.
- Interactive: encrypt signs with the unlocked default key when the setting is on (warns when it cannot); the summary shows "Signed with"; decrypt prints signature lines under the plaintext and a red banner above it when invalid. Key-management menu has a "Sign my messages: On/Off (toggle)" entry.
- CLI: `encrypt` signs by default and fails with a hint when the signing key's passphrase is unavailable; `decrypt` reports signatures on stderr; `sign` produces clear-signed text; `verify` checks it (exit 4 on invalid or unknown signer).
- Verified via script: signed round trip, `--no-sign`, `--sign-with`, wrong passphrase (rc 2), unknown signer (rc 0 with notice), tampered clear-signed text (rc 4), settings migration runs once and respects a later toggle. Interactive display verified by review only.

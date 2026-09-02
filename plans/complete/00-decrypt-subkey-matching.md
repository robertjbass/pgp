# 00 - Decrypt: match message recipients against subkeys

**Status:** complete
**Priority:** 1
**Source:** Bug report (2026-09-02): after generating a second keypair and making it default, decrypting a message for it failed with "not encrypted for any of your keys".

## Why

OpenPGP encrypts to the encryption *subkey*. The interactive decrypt fallback compared the message's recipient key ID to the suffix of the stored primary-key fingerprint, which never matches for any key this tool generates. The bug was hidden for the first key because its passphrase was already cached at startup, so the fallback path was never reached.

## Scope

- [x] Add `findKeypairsForMessage()` in `src/pgp-tool.ts` that parses each stored public key and checks `key.getKeys(keyID)` for every recipient key ID (primary + subkeys).
- [x] Use it in `decryptWithSession()` for the locked-key fallback.
- [x] Use it in `markKeyAsUsed()` so `last_used_at` actually updates.
- [x] Cache the passphrase when a keypair is generated (`src/key-manager.ts`) so a fresh key is usable in the same session.

## Verification

- `pnpm exec tsc --noEmit` passes.
- Scratch script: generated two RSA keys, encrypted to B, confirmed the lookup matches B only.

## Notes

The CLI `decrypt` command has the same class of bug (only tries the default key). That is tracked in plan 03.

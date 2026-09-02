# 05 - Remaining functional bugs

**Status:** complete
**Priority:** 5
**Source:** Audit 2026-09-02

Independent bugs that do not share a root cause. Each is small; do them as one commit per bullet or grouped by file.

## Scope

- [x] **Editors return empty.** `src/pgp-tool.ts` launches VS Code as `code` and TextEdit as `open -e`; both return immediately so the temp file is read while empty. Use `code --wait` and `open -W -e`.
- [x] **Encrypt to expired/revoked contact crashes the action.** `actionEncrypt` has no try/catch around `openpgp.encrypt`; the error bubbles to the main loop, which clears the unlocked-key session and loses the typed message. Catch, show the reason, keep the message, and mark expired/revoked contacts in the picker (expiry is stored but never checked).
- [x] **Key capability flags are hardcoded.** `src/key-utils.ts`: `canSign`/`canCertify` are literally `true`, `canAuthenticate` `false`, `canEncrypt` can never be false (openpgp 6 throws instead of returning null, which also aborts import of sign-only keys), `revoked` always `false`. Use `getSigningKey()`/`getEncryptionKey()` in try/catch, `isRevoked()`, and read key-flag bits.
- [x] **GPG import shows the subkey fingerprint and last UID.** `src/system-keys.ts` overwrites `fingerprint` on every `fpr` line and `name`/`email` on every `uid`. Take only the first of each after `pub`/`sec`. Use `execFileSync` with arg arrays instead of shell strings.
- [x] **Key-management menu blocks on npm.** `src/version-check.ts` runs `npm list -g` and `npm view` synchronously with no timeout on every render. Cache once per process, add a timeout, run off the menu path. `getInstalledVersion` should also recognize pnpm installs (or use the running binary's version).
- [x] **Imported keys prompt for the passphrase twice.** Both import flows validate the passphrase but never cache it. Cache on success (matches plan 00's generate fix).
- [x] **Import wrong-passphrase restarts the whole paste.** Add a retry loop like `unlockKeypair`.
- [x] **Clipboard auto-detect offers to encrypt to yourself** after "Copy my public key". Skip keys that match a stored keypair.
- [x] **Misleading decrypt error.** `tryWith` swallows every openpgp error; a corrupt message for an unlocked key reports "not encrypted for any of your keys". Surface the last error when a matching key exists.
- [x] **Deleted keys stay usable for the session.** Prune `unlockedKeys` against the DB when returning from the key manager.
- [x] **`install.sh` alias changes the shell cwd.** Use a subshell or `pnpm --dir`.
- [x] **`isOlderVersion` mishandles prerelease tags** (`0.7.0-beta` compares equal to `0.7.0`).

## Verification

Per bullet; each has an obvious manual check listed in the audit.

## Completion notes (2026-09-02)

- Editors: VS Code launches as `code --wait`, TextEdit as `open -W -e`; availability is probed by binary name with `execFileSync`.
- Encrypt failures are caught, the reason shown, and the plaintext copied back to the clipboard. Expired/revoked contacts are labelled and disabled in both pickers; an expired/revoked or own key in the clipboard is skipped.
- `key-utils.ts` `detectKeyCapabilities()` probes signing/encryption keys, reads certify/authenticate key flags, and calls `isRevoked()`. All create paths store the real `revoked` flag.
- `system-keys.ts`: first `fpr`/`uid` only, ignores subkey fingerprints, `execFileSync` with arg arrays. Parser exported for tests.
- `version-check.ts`: async `execFile` probes with a 4 s timeout, memoised per process; installed version read from the `lpgp` binary on PATH (works for pnpm/yarn installs); `isOlderVersion` handles prerelease tags.
- Imports: `promptPassphraseWithRetry()` verifies the passphrase with up to 3 attempts, insists on one for protected keys, and caches it.
- Decrypt reports the real openpgp error when the matching key is already unlocked. Session unlocked-key map is pruned/refreshed after leaving the key manager.
- `install.sh` alias runs in a subshell.
- Verified with a scratch script (capabilities incl. sign-only and revoked keys, parser, version compare, memoised probes). Editor and picker changes verified by review only (interactive).

# 04 - Escape and Ctrl+C handling

**Status:** complete
**Priority:** 4
**Source:** Audit 2026-09-02

## Why

Three separate defects make Escape unreliable:

1. `src/inline-editor.ts` calls `stdin.setEncoding('utf8')` and never resets it. `src/prompts.ts` compares `data[0] === 27` / `=== 3`, which only works on Buffers. After the first inline-editor use, every "esc" hint is dead and the graceful Ctrl+C path never fires.
2. Escape sets `escapeTriggered = true` and rejects with `EscapeError`. The main loop's catch short-circuits on `instanceof EscapeError`, so the flag is never reset. The next unrelated error is treated as a cancel and silently swallowed.
3. First-time setup, the initial default-key unlock, `unlockAllCached()`, and the `pause()` in the generic catch all run outside the main loop's error handling, so Escape there exits with "Fatal: Escape pressed" and code 1. Escape inside the "Set as default?" confirm in both import flows is caught by a generic try/catch and rendered as an error.

## Scope

- [x] `src/prompts.ts`: handle both `Buffer` and `string` stdin data (compare against `'\x1b'` / `'\x03'` when string). Also restore the previous encoding in the inline editor's cleanup.
- [x] `src/prompts.ts` / `src/pgp-tool.ts`: reset `escapeTriggered` whenever an `EscapeError` is caught, so it cannot leak into the next error.
- [x] `src/pgp-tool.ts` `main()`: wrap startup prompts so Escape returns to the main menu (or exits cleanly during first-time setup) instead of a fatal error.
- [x] `src/key-manager.ts`: move the "Set as default?" confirms out of the generic try/catch, or rethrow `EscapeError` from those catches.
- [x] After 3 wrong passphrase attempts in `unlockKeypair`, show a message instead of returning silently. Fix the misleading "Decryption will be unavailable" startup warning (decrypt re-prompts lazily).

## Verification

- Use Inline input once, then press Esc on a later menu: returns to main menu.
- Press Esc at a passphrase prompt, then trigger a real error (encrypt to expired contact): error is shown.
- Press Esc at the startup passphrase prompt: lands on main menu, no fatal.

## Completion notes (2026-09-02)

- `prompts.ts`: escape/Ctrl+C detection handles both Buffer and string chunks (`isSingleByte`). Node offers no way to unset `setEncoding`, so this is the fix rather than restoring encoding in the inline editor.
- `pgp-tool.ts`: the main loop always resets the escape flag when it catches an error; `pause()` after an error ignores Escape; every startup step (first-time setup, default unlock, cached unlocks) runs through `startupStep()`, which treats Escape as "skip for now".
- `key-manager.ts`: both import flows rethrow `EscapeError` instead of printing it as an import error; error text no longer includes the "Error:" prefix twice.
- `unlockKeypair` reports "Too many incorrect attempts"; the startup message now says the key stays locked and will be asked for when needed.
- Verified escape detection with synthetic stdin events (Buffer and string, single Esc vs. arrow sequences).

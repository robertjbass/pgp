# 02 - Default-key invariants and schema constraint

**Status:** complete
**Priority:** 2
**Source:** Audit 2026-09-02

## Why

Three flows (generate, import, GPG import, plus the CLI `generate`) clear `is_default` on every row *before* inserting the new key. If the insert fails on the `email UNIQUE` or `fingerprint UNIQUE` constraint, no key is default. Deleting the default key also leaves no default. Either way the next launch says "No keypair found" and forces first-time setup, and CLI commands that need a default fail. The `email UNIQUE` constraint itself blocks the "Personal" + "Work" setup the name prompt literally suggests, and only surfaces after a 4096-bit RSA generation finishes.

## Scope

- [x] `src/db.ts`: add `setDefaultKeypair(id)` that clears and sets in one transaction (`BEGIN`/`COMMIT` via `exec`, single save).
- [x] Reorder every create flow (interactive generate, import, GPG import, CLI `generate`): insert first, then set default. Check for an existing fingerprint before generating/importing and show a friendly message instead of a raw constraint error.
- [x] `src/schema.sql` + `src/db.ts`: drop `UNIQUE` on `keypair.email`. Needs a one-time migration for existing DBs (rebuild table without the constraint, keep `fingerprint UNIQUE`).
- [x] On delete of the default key, promote another key (single remaining key: automatic; several: prompt) or clearly state there is no default.
- [x] `src/pgp-tool.ts` `main()`: if keys exist but none is default, offer to pick one instead of forcing first-time setup.
- [x] Menu `generateKeypair()` is called with `setAsDefault=false` and never asks; ask like the import flows do.

## Out of scope

`settings.default_keypair_id` column cleanup (plan 08).

## Verification

- Generate a key with an email already in use: succeeds, both keys listed, default unchanged unless chosen.
- Import a key whose fingerprint already exists: friendly error, default unchanged.
- Delete the default key with another present: a default remains; launch goes to main menu.
- `lpgp generate` twice with the same email: second succeeds.

## Completion notes (2026-09-02)

- `db.ts`: `setDefaultKeypair(id)` runs both updates in one transaction; `insertKeypair(record, { makeDefault })` rejects duplicate fingerprints, inserts, then switches the default (first key is always default); `getKeypairById`, `getKeypairByFingerprint`, `getDefaultKeypair` helpers.
- `schema.sql`: dropped `UNIQUE` on `keypair.email`. `db.ts` `migrateDropKeypairEmailUnique()` rebuilds the table once for existing databases and recreates the indexes.
- All four create flows (interactive generate, import, GPG import, CLI generate) use `insertKeypair`. Menu-generated keys now ask "Set as default?" before generation. Both import flows check for an already-stored fingerprint before prompting for a passphrase.
- `removeKeypair()` promotes the only remaining key automatically, or prompts (with "Skip for now") when several remain.
- `main()` offers to choose a default when keys exist but none is marked; "Setup complete!" only prints when setup actually added a key.
- Verified with a scratch script against an old-schema DB and with the CLI in a throwaway HOME.

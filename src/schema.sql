-- SQLite Schema for PGP Key Manager
-- This schema defines the database structure for managing PGP keypairs, contacts, and settings

-- Table: keypair
-- Stores your own keypairs (you have both public and private keys)
CREATE TABLE IF NOT EXISTS keypair (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                      -- e.g., "Work", "Personal"
  email TEXT NOT NULL UNIQUE,              -- Your email address
  fingerprint TEXT NOT NULL UNIQUE,        -- Unique identifier for the keypair
  public_key TEXT NOT NULL,                -- Armored public key
  private_key TEXT NOT NULL,               -- Armored private key
  passphrase_protected INTEGER NOT NULL,   -- Boolean: 1 if passphrase-protected, 0 otherwise

  -- Key metadata
  algorithm TEXT NOT NULL,                 -- e.g., "RSA", "EdDSA", "ECDSA"
  key_size TEXT NOT NULL,                  -- e.g., "4096", "ed25519"

  -- Key capabilities
  can_sign INTEGER NOT NULL DEFAULT 1,
  can_encrypt INTEGER NOT NULL DEFAULT 1,
  can_certify INTEGER NOT NULL DEFAULT 0,
  can_authenticate INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle tracking
  expires_at TEXT,                         -- ISO 8601 date or NULL for no expiration
  revoked INTEGER NOT NULL DEFAULT 0,      -- Boolean: 1 if revoked, 0 otherwise
  revocation_reason TEXT,                  -- Optional reason for revocation

  -- Timestamps
  created_at TEXT NOT NULL,                -- ISO 8601 timestamp
  updated_at TEXT NOT NULL,                -- ISO 8601 timestamp
  last_used_at TEXT,                       -- ISO 8601 timestamp, NULL if never used

  -- Default keypair selection
  is_default INTEGER NOT NULL DEFAULT 0    -- Boolean: 1 if default, 0 otherwise
);

-- Table: contact
-- Stores other people's public keys (for encrypting messages to them)
CREATE TABLE IF NOT EXISTS contact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                      -- Contact's name
  email TEXT NOT NULL,                     -- Contact's email
  fingerprint TEXT NOT NULL UNIQUE,        -- Unique identifier for the key
  public_key TEXT NOT NULL,                -- Armored public key

  -- Key metadata
  algorithm TEXT NOT NULL,                 -- e.g., "RSA", "EdDSA", "ECDSA"
  key_size TEXT NOT NULL,                  -- e.g., "4096", "ed25519"

  -- Trust and verification
  trusted INTEGER NOT NULL DEFAULT 0,      -- Boolean: 1 if verified, 0 otherwise
  last_verified_at TEXT,                   -- ISO 8601 timestamp, NULL if never verified
  notes TEXT,                              -- Optional notes about this contact

  -- Lifecycle tracking
  expires_at TEXT,                         -- ISO 8601 date or NULL for no expiration
  revoked INTEGER NOT NULL DEFAULT 0,      -- Boolean: 1 if revoked, 0 otherwise

  -- Timestamps
  created_at TEXT NOT NULL,                -- ISO 8601 timestamp
  updated_at TEXT NOT NULL                 -- ISO 8601 timestamp
);

-- Table: settings
-- Stores application settings (single row with typed fields)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),   -- Ensure only one row exists
  default_keypair_id INTEGER,              -- References keypair.id
  auto_sign_messages INTEGER NOT NULL DEFAULT 0,
  prefer_inline_pgp INTEGER NOT NULL DEFAULT 1,
  keyserver_url TEXT NOT NULL DEFAULT 'https://keys.openpgp.org',

  FOREIGN KEY (default_keypair_id) REFERENCES keypair(id) ON DELETE SET NULL
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_keypair_email ON keypair(email);
CREATE INDEX IF NOT EXISTS idx_keypair_fingerprint ON keypair(fingerprint);
CREATE INDEX IF NOT EXISTS idx_contact_email ON contact(email);
CREATE INDEX IF NOT EXISTS idx_contact_fingerprint ON contact(fingerprint);

-- Initialize settings table with default values
INSERT OR IGNORE INTO settings (id, auto_sign_messages, prefer_inline_pgp, keyserver_url)
VALUES (1, 0, 1, 'https://keys.openpgp.org');

# Monorepo Structure

This project is organized as a **pnpm workspace monorepo** with two packages:

## Packages

### 🖥️ `@pgp/cli`
**Location:** `packages/cli/`

Interactive CLI tool for PGP operations with SQLite key management.

**Scripts:**
```bash
# Run the CLI (from root)
pnpm pgp

# Build the CLI
pnpm build
```

**Features:**
- Interactive menu for encryption/decryption
- SQLite database for key management
- Multiple input methods (clipboard, editor, inline)
- Passphrase-protected private keys
- Self-contained encryption/decryption utilities

**Dependencies:**
- inquirer, chalk, clipboardy, better-sqlite3, openpgp

**Internal Modules:**
- `src/encrypt.ts` - PGP encryption utility
- `src/decrypt.ts` - PGP decryption utility
- `src/pgp-tool.ts` - Main CLI application
- `src/db.ts` - SQLite database layer
- `src/schema.sql` - Database schema

---

### ⚡ `@pgp/api`
**Location:** `packages/api/`

Web interface + serverless API for PGP encryption, deployed to Vercel.

**Structure:**
```
packages/api/
├── api/
│   └── encrypt.ts          # POST /api/encrypt serverless function
├── public/
│   └── index.html          # Static HTML form (no JS required)
└── tsconfig.json           # TypeScript configuration
```

**Endpoints:**
- `GET /` - HTML form for encryption
- `POST /api/encrypt` - Serverless encryption endpoint
- `GET /api/encrypt` - API status check

**Scripts:**
```bash
# Run locally (from root)
pnpm serve

# Deploy to Vercel (from root)
pnpm deploy:vercel
```

**Features:**
- No JavaScript required (works in browsers with JavaScript disabled)
- Form-based encryption with POST
- CORS enabled for API access
- Handles both JSON and form-encoded data
- Modern, beautiful UI with pure CSS

**Dependencies:**
- `@vercel/node` - Vercel runtime
- `openpgp` - PGP operations (encryption logic inlined in serverless function)

---

## Root Scripts

From the project root, you can run:

```bash
# Run the CLI tool
pnpm pgp

# Run the web interface locally (localhost:3000)
pnpm serve

# Deploy web interface to Vercel
pnpm deploy:vercel

# Build CLI package
pnpm build

# Clean rebuild (remove everything and rebuild)
pnpm rebuild

# Format all code
pnpm format

# Clean all build artifacts and node_modules
pnpm clean
```

## Development Workflow

### 1. Initial Setup
```bash
# Install dependencies for all packages
pnpm install

# No build required for API - Vercel compiles TypeScript automatically
# CLI can be run directly with tsx
```

### 2. Local Development

**CLI Development:**
```bash
pnpm pgp
```

**Web Development:**
```bash
# Starts Vercel dev server at localhost:3000
pnpm serve

# Visit http://localhost:3000 in your browser
```

### 3. Deployment

**Deploy to Vercel:**
```bash
pnpm deploy:vercel
```

This deploys from the monorepo root and serves:
- `https://yoursite.vercel.app/` → HTML form
- `https://yoursite.vercel.app/api/encrypt` → Serverless function

## Workspace Configuration

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - 'packages/*'
```

**Package Independence:**

Both packages are self-contained:
- CLI has its own encryption/decryption utilities in `src/`
- API has encryption logic inlined in the serverless function
- No shared dependencies between packages

## TypeScript Configuration

The monorepo uses **TypeScript project references** for type safety:

- **Root `tsconfig.json`**: References all packages
- **`tsconfig.base.json`**: Shared compiler options
- **Package `tsconfig.json`**: Extends base config with package-specific settings

## Project Structure

```
pgp/
├── packages/
│   ├── api/                  # Web interface + API
│   │   ├── api/
│   │   │   └── encrypt.ts    # Serverless function
│   │   ├── public/
│   │   │   └── index.html    # Static HTML
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── cli/                  # CLI tool
│       ├── src/
│       │   ├── encrypt.ts    # Encryption utility
│       │   ├── decrypt.ts    # Decryption utility
│       │   ├── pgp-tool.ts   # Main CLI app
│       │   ├── db.ts         # Database layer
│       │   └── schema.sql    # DB schema
│       ├── db/               # SQLite database
│       ├── package.json
│       └── tsconfig.json
├── package.json              # Root workspace
├── pnpm-workspace.yaml       # Workspace config
├── tsconfig.base.json        # Shared TS config
├── tsconfig.json             # Root TS config
├── vercel.json               # Vercel deployment config
└── MONOREPO.md              # This file
```

## Deployment

### CLI
The CLI is not deployed - it runs locally. You can:
- Use it directly with `pnpm pgp`
- Build and distribute with `pnpm build`
- Package for npm publishing

### Web Interface (API + HTML)
Deploy to Vercel from the monorepo root:

```bash
pnpm deploy:vercel
```

**What gets deployed:**
- HTML form at the root URL
- Serverless function at `/api/encrypt`
- Static assets from `packages/api/public/`

**Vercel Configuration:**
- Detects pnpm workspace automatically
- Compiles TypeScript serverless functions
- Serves static files from `outputDirectory`
- No build step required (Vercel handles TypeScript compilation)

## Progressive Enhancement (Future)

The HTML form currently works without JavaScript. Future enhancements:
- Add client-side encryption with Petite Vue (optional)
- Real-time "encrypt as you type" (progressive enhancement)
- Still fallback to server-side for browsers with JavaScript disabled

## Architecture Notes

### Why No Shared Package?

Initially, this monorepo had a `@pgp/shared` package for common encryption utilities. We removed it because:

1. **Vercel Deployment Simplicity**: Serverless functions work best when self-contained
2. **No Code Duplication**: The encryption logic is simple enough to inline
3. **Independent Packages**: CLI and API serve different purposes and don't need to share code
4. **Build Simplification**: No need to build shared package before deploying

The encryption/decryption logic is:
- In `packages/cli/src/encrypt.ts` and `decrypt.ts` for CLI
- Inlined in `packages/api/api/encrypt.ts` for the serverless function

This keeps both packages independent and easy to deploy.

# Monorepo Structure

This project is organized as a **pnpm workspace monorepo** with three packages:

## Packages

### 📦 `@pgp/shared`
**Location:** `packages/shared/`

Shared PGP encryption/decryption utilities used by both CLI and API.

**Exports:**
- `encryptMessage(message: string, publicKeyArmored: string): Promise<string>`
- `decryptMessage(encryptedMessage: string, privateKeyArmored: string, passphrase: string): Promise<string>`

**Scripts:**
```bash
pnpm build:shared
```

---

### 🖥️ `@pgp/cli`
**Location:** `packages/cli/`

Interactive CLI tool for PGP operations with SQLite key management.

**Scripts:**
```bash
# Run the CLI (from root)
pnpm pgp

# Build the CLI
pnpm build:cli
```

**Features:**
- Interactive menu for encryption/decryption
- SQLite database for key management
- Multiple input methods (clipboard, editor, inline)
- Passphrase-protected private keys

**Dependencies:**
- `@pgp/shared` (workspace package)
- inquirer, chalk, clipboardy, better-sqlite3, openpgp

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
└── vercel.json             # Vercel configuration
```

**Endpoints:**
- `GET /` - HTML form for encryption
- `POST /api/encrypt` - Serverless encryption endpoint
- `GET /api/encrypt` - API status check

**Scripts:**
```bash
# Run locally (from root)
pnpm serve

# Deploy to Vercel
pnpm deploy
```

**Features:**
- No JavaScript required (works in browsers with JavaScript disabled)
- Form-based encryption with POST
- CORS enabled for API access
- Handles both JSON and form-encoded data

**Dependencies:**
- `@pgp/shared` (workspace package)
- `@vercel/node` - Vercel runtime
- `openpgp` - PGP operations

---

## Root Scripts

From the project root, you can run:

```bash
# Run the CLI tool
pnpm pgp

# Run the web interface locally (localhost:3000)
pnpm serve

# Deploy web interface to Vercel
pnpm deploy

# Build all packages
pnpm build

# Clean rebuild (remove everything and rebuild)
pnpm rebuild

# Build specific packages
pnpm build:shared
pnpm build:cli

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

# Build the shared package (required first)
pnpm build:shared
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
pnpm deploy
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

**Package Dependencies:**

The CLI and API depend on the shared package using workspace protocol:
```json
"dependencies": {
  "@pgp/shared": "workspace:*"
}
```

This creates a local symlink to the shared package during development.

## TypeScript Configuration

The monorepo uses **TypeScript project references** for type safety:

- **Root `tsconfig.json`**: References all packages
- **`tsconfig.base.json`**: Shared compiler options
- **Package `tsconfig.json`**: Extends base config with package-specific settings

The shared package has `"composite": true` to support project references.

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
│   │   ├── tsconfig.json
│   │   └── vercel.json
│   ├── cli/                  # CLI tool
│   │   ├── src/
│   │   ├── db/               # SQLite database
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── shared/               # Shared utilities
│       ├── src/
│       │   ├── encrypt.ts
│       │   ├── decrypt.ts
│       │   └── index.ts
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
- Build and distribute with `pnpm build:cli`
- Package for npm publishing

### Web Interface (API + HTML)
Deploy to Vercel from the monorepo root:

```bash
pnpm deploy
```

**What gets deployed:**
- HTML form at the root URL
- Serverless function at `/api/encrypt`
- Static assets from `packages/api/public/`

**Vercel Configuration:**
- Detects pnpm workspace automatically
- Builds shared package first
- Compiles TypeScript serverless functions
- Serves static files from `outputDirectory`

## Progressive Enhancement (Future)

The HTML form currently works without JavaScript. Future enhancements:
- Add client-side encryption with Petite Vue (optional)
- Real-time "encrypt as you type" (progressive enhancement)
- Still fallback to server-side for browsers with JavaScript disabled

## Migration Notes

### What Changed

1. **Monorepo Structure**: Code split into logical packages
2. **Shared Logic**: Common PGP operations extracted to `@pgp/shared`
3. **API Package**: New Vercel serverless function for encryption
4. **Frontend Integrated**: HTML moved into API package's `public/` folder
5. **Root Package**: Private workspace root with aggregated scripts

### What Stayed the Same

- CLI functionality is identical
- Database structure unchanged
- All dependencies preserved
- Build process compatible with existing workflows

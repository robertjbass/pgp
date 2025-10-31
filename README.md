# 🔐 Dash - PGP Encryption CLI Tool

> **Note:** This is a personal side project created to learn more about encryption, PGP, and implementing secure web applications that work without JavaScript. It's a work in progress and should be used for educational purposes.

A beautiful, interactive command-line tool for encrypting and decrypting messages using PGP (Pretty Good Privacy). Built with Node.js and TypeScript, Dash provides a user-friendly interface for secure message encryption with multiple input methods and cross-platform support.

## ⚠️ Project Status

This project is **actively being developed** as a learning exercise. While functional, it may contain bugs or security considerations that need addressing. Use at your own discretion and avoid using it for highly sensitive production data.

## ✨ Features

- 🔒 **PGP Encryption/Decryption** - Secure message encryption using OpenPGP
- 📋 **Clipboard Integration** - Seamlessly encrypt/decrypt from clipboard
- ✍️ **Multiple Input Methods**:
  - Paste from clipboard
  - Open in your preferred text editor
  - Type inline directly in the terminal
- 🎨 **Beautiful CLI Interface** - Colorful, intuitive prompts with emoji icons
- 🖥️ **Cross-Platform Support** - Works on Linux, macOS, and Windows
- 🛠️ **Smart Editor Detection** - Auto-detects available editors (VS Code, Vim, Nano, Notepad, etc.)
- 👋 **Graceful Exit Handling** - Clean Ctrl+C interruption handling

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- pnpm (v10.19.0 or higher)
- PGP key pair (public and private keys)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/dash.git
cd dash
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up your environment variables:

Create a `.env` file in the root directory with your PGP keys:

See `.env.example`

**Important:** Make sure there's a blank line after the `BEGIN` header in your PGP keys.

### Usage

Run the PGP tool:

```bash
pnpm pgp
```

You'll be greeted with an interactive menu:

```
╔════════════════════════════════════════╗
║  🔐  PGP Encryption/Decryption Tool   ║
╚════════════════════════════════════════╝

? What would you like to do?
  🔒 Encrypt a message
  🔓 Decrypt a message
  👋 Exit
```

## 🎯 How It Works

### Encrypting a Message

1. Select "🔒 Encrypt a message"
2. Choose your input method:
   - **📋 Paste from clipboard** - Automatically encrypts text from your clipboard
   - **📝 Use an editor** - Opens your preferred text editor
   - **⌨️ Type inline** - Enter text directly (press Enter, then Ctrl+D to finish)
3. The encrypted message is displayed and automatically copied to your clipboard

### Decrypting a Message

1. Select "🔓 Decrypt a message"
2. Choose your input method for the encrypted text
3. The decrypted message is displayed and automatically copied to your clipboard

## 🛠️ Development

### Available Scripts

```bash
# Run the PGP tool
pnpm pgp

# Start the development server (placeholder)
pnpm serve

# Format code with Prettier
pnpm format

# Build the TypeScript project
pnpm build

# Run the built project
pnpm start
```

### Project Structure

```
dash/
├── src/
│   ├── index.ts          # Placeholder server
│   └── pgp-tool.ts       # Main PGP CLI tool
├── .env                  # Environment variables (not in git)
├── package.json
├── tsconfig.json
├── TODO.md              # Project roadmap
└── README.md
```

## 📋 Roadmap

See [TODO.md](TODO.md) for the complete project roadmap. Upcoming features include:

- SQLite database integration
- Configuration file support (replacing .env)
- Web UI with Express backend
- **Standalone landing page with progressive enhancement**
  - Real-time encryption with JavaScript enabled
  - Server-side encryption fallback when JavaScript is disabled
  - Learn how to build accessible, secure web apps that work without client-side JavaScript
- PGP key detection from system
- Key generation and management
- File encryption/decryption
- Multi-recipient support

## 🔒 Security Considerations

As this is a learning project, please note:

- Store your `.env` file securely and never commit it to version control
- The `.gitignore` already excludes `.env` files
- Consider the security implications of storing private keys in environment variables
- For production use, consider more secure key storage methods (e.g., hardware tokens, key management systems)
- This tool has not undergone professional security audit

## 🤝 Contributing

This is primarily a personal learning project, but suggestions and feedback are welcome! Feel free to:

- Open issues for bugs or feature requests
- Submit pull requests with improvements
- Share your experience using the tool

## 📝 License

**Source Available Educational License** - NOT Open Source

This software is source-available for educational purposes, security auditing, and learning only. Commercial use and use by for-profit enterprises is prohibited without explicit permission. See the [LICENSE](LICENSE) file for full terms.

The source code is publicly available to promote transparency, enable security audits, and support learning about encryption and web development - but this does not make it open source software.

## 🙏 Acknowledgments

- Built with [OpenPGP.js](https://openpgpjs.org/) for encryption
- [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) for beautiful CLI prompts
- [Chalk](https://github.com/chalk/chalk) for terminal styling
- [Clipboardy](https://github.com/sindresorhus/clipboardy) for clipboard operations

---

**Learning Focus:** This project explores:
- PGP encryption and cryptography fundamentals
- Node.js CLI development with TypeScript
- Security best practices for handling sensitive data
- **Progressive enhancement and building web applications that work without JavaScript**
- Server-side vs. client-side encryption trade-offs
- Accessible web design principles

It's a work in progress and will continue to evolve as I learn more about encryption, secure communication, and building resilient web applications.

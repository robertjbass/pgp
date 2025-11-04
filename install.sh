#!/usr/bin/env bash

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_header() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}  🔐  Layerbase PGP Installer          ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
    echo ""
}

# Detect OS
detect_os() {
    print_info "Detecting operating system..."

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        print_success "Detected: Linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        print_success "Detected: macOS"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        OS="windows"
        print_success "Detected: Windows"
    else
        OS="unknown"
        print_error "Unknown operating system: $OSTYPE"
        exit 1
    fi
}

# Detect shell
detect_shell() {
    print_info "Detecting shell..."

    CURRENT_SHELL=$(basename "$SHELL")
    print_success "Current shell: $CURRENT_SHELL"

    # Detect shell config file
    if [[ "$CURRENT_SHELL" == "bash" ]]; then
        if [[ "$OS" == "macos" ]]; then
            SHELL_CONFIG="$HOME/.bash_profile"
        else
            SHELL_CONFIG="$HOME/.bashrc"
        fi
    elif [[ "$CURRENT_SHELL" == "zsh" ]]; then
        SHELL_CONFIG="$HOME/.zshrc"
    elif [[ "$CURRENT_SHELL" == "fish" ]]; then
        SHELL_CONFIG="$HOME/.config/fish/config.fish"
    else
        SHELL_CONFIG="$HOME/.profile"
    fi

    print_info "Shell config: $SHELL_CONFIG"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Node.js installation
check_nodejs() {
    print_info "Checking for Node.js installation..."

    if command_exists node; then
        NODE_VERSION=$(node --version)
        print_success "Node.js is installed: $NODE_VERSION"

        # Check if version is >= 18
        NODE_MAJOR_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_MAJOR_VERSION" -lt 18 ]; then
            print_warning "Node.js version $NODE_VERSION is installed, but v18+ is recommended"
            print_info "Consider upgrading Node.js for the best experience"
        fi
        return 0
    else
        print_warning "Node.js is not installed"
        return 1
    fi
}

# Install Node.js using nvm
install_nodejs() {
    print_info "Installing Node.js..."

    # Check if nvm is installed
    if [ ! -d "$HOME/.nvm" ] && ! command_exists nvm; then
        print_info "Installing nvm (Node Version Manager)..."

        # Download and install nvm
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash

        # Load nvm
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

        print_success "nvm installed successfully"
    else
        print_info "nvm is already installed"
        # Load nvm
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi

    # Install Node.js LTS
    print_info "Installing Node.js LTS..."
    nvm install --lts
    nvm use --lts

    NODE_VERSION=$(node --version)
    print_success "Node.js $NODE_VERSION installed successfully"
}

# Check pnpm installation
check_pnpm() {
    print_info "Checking for pnpm installation..."

    if command_exists pnpm; then
        PNPM_VERSION=$(pnpm --version)
        print_success "pnpm is installed: v$PNPM_VERSION"
        return 0
    else
        print_warning "pnpm is not installed"
        return 1
    fi
}

# Install pnpm
install_pnpm() {
    print_info "Installing pnpm..."

    if command_exists npm; then
        npm install -g pnpm
        print_success "pnpm installed successfully"
    else
        print_error "npm is not available. Cannot install pnpm."
        exit 1
    fi
}

# Check git installation
check_git() {
    print_info "Checking for git installation..."

    if command_exists git; then
        GIT_VERSION=$(git --version)
        print_success "git is installed: $GIT_VERSION"
        return 0
    else
        print_error "git is not installed"
        print_info "Please install git and try again"

        if [[ "$OS" == "macos" ]]; then
            print_info "Install with: brew install git"
        elif [[ "$OS" == "linux" ]]; then
            print_info "Install with: sudo apt-get install git (Debian/Ubuntu)"
            print_info "            or: sudo yum install git (RHEL/CentOS)"
        fi
        return 1
    fi
}

# Install dependencies
install_dependencies() {
    print_info "Installing project dependencies..."

    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Are you in the correct directory?"
        exit 1
    fi

    pnpm install
    print_success "Dependencies installed successfully"
}

# Build the project
build_project() {
    print_info "Building the project..."
    pnpm build
    print_success "Project built successfully"
}

# Setup environment
setup_environment() {
    print_info "Setting up environment..."

    if [ -f ".env" ]; then
        print_warning ".env file already exists. Skipping creation."
    else
        if [ -f ".env.example" ]; then
            print_info "Creating .env file from .env.example..."
            cp .env.example .env
            print_success ".env file created"
            print_warning "⚠ IMPORTANT: Edit .env and add your PGP keys before running the tool"
        else
            print_warning ".env.example not found. You'll need to create .env manually"
        fi
    fi
}

# Create shell alias
create_alias() {
    print_info "Would you like to create an 'lpgp' command alias? (y/n)"
    read -r response

    if [[ "$response" =~ ^[Yy]$ ]]; then
        INSTALL_DIR=$(pwd)

        # Create alias command
        ALIAS_CMD="alias lpgp='cd $INSTALL_DIR && pnpm pgp'"

        # Add to shell config if not already there
        if ! grep -q "alias lpgp=" "$SHELL_CONFIG" 2>/dev/null; then
            echo "" >> "$SHELL_CONFIG"
            echo "# Layerbase PGP Tool" >> "$SHELL_CONFIG"
            echo "$ALIAS_CMD" >> "$SHELL_CONFIG"
            print_success "Alias added to $SHELL_CONFIG"
            print_info "Run 'source $SHELL_CONFIG' or restart your terminal to use the 'lpgp' command"
        else
            print_warning "Alias already exists in $SHELL_CONFIG"
        fi
    fi
}

# Main installation process
main() {
    print_header

    # Detect system
    detect_os
    detect_shell

    echo ""
    print_info "Starting installation checks..."
    echo ""

    # Check git
    if ! check_git; then
        exit 1
    fi

    # Check/Install Node.js
    if ! check_nodejs; then
        print_info "Node.js is required. Would you like to install it now? (y/n)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            install_nodejs
        else
            print_error "Node.js is required. Installation cancelled."
            exit 1
        fi
    fi

    # Check/Install pnpm
    if ! check_pnpm; then
        print_info "pnpm is required. Would you like to install it now? (y/n)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            install_pnpm
        else
            print_error "pnpm is required. Installation cancelled."
            exit 1
        fi
    fi

    echo ""
    print_info "All prerequisites satisfied!"
    echo ""

    # Install dependencies
    install_dependencies

    # Build project
    build_project

    # Setup environment
    setup_environment

    echo ""
    print_success "Installation complete!"
    echo ""

    # Offer to create alias
    create_alias

    echo ""
    print_info "Next steps:"
    echo "  1. Edit .env file and add your PGP keys"
    echo "  2. Run: pnpm pgp"
    echo ""
    print_success "Enjoy using Layerbase PGP! 🔐"
    echo ""
}

# Run main installation
main

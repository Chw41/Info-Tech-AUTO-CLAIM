#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

load_homebrew_path() {
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_homebrew() {
  echo "Installing Homebrew..."
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl not found. Install Homebrew or Node.js LTS first: https://nodejs.org/"
    exit 1
  fi
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_homebrew_path
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew was installed, but this shell cannot find brew yet. Open a new terminal and run setup.sh again."
    exit 1
  fi
}

install_node() {
  echo "Installing Node.js LTS with Homebrew..."
  load_homebrew_path
  if ! command -v brew >/dev/null 2>&1; then
    install_homebrew
  fi
  if brew list node >/dev/null 2>&1; then
    brew upgrade node || true
  else
    brew install node
  fi
  export PATH="$(brew --prefix)/bin:$PATH"
}

load_homebrew_path

if ! command -v node >/dev/null 2>&1; then
  install_node
fi

if ! command -v npm >/dev/null 2>&1; then
  install_node
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js was installed, but this shell cannot find node/npm yet. Open a new terminal and run setup.sh again."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 or newer is required. Current version: $(node -v)"
  install_node
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "Node.js is still older than 18 after installation. Open a new terminal and run setup.sh again."
    exit 1
  fi
fi

echo "Installing npm dependencies..."
npm install

echo "Installing Playwright Chromium..."
npx --yes playwright install chromium

echo "Setup completed."

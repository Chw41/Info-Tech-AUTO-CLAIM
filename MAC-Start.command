#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

show_dialog() {
  if command -v osascript >/dev/null 2>&1; then
    osascript - "$1" <<'OSA' >/dev/null
on run argv
  display dialog (item 1 of argv) buttons {"OK"} default button "OK" with title "Auto Infotech Claim"
end run
OSA
  else
    printf '%s\n' "$1"
  fi
}

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
    show_dialog "curl was not found, so Homebrew cannot be installed automatically. Please install Homebrew or Node.js LTS first, then open MAC-Start.command again."
    exit 1
  fi
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_homebrew_path
  if ! command -v brew >/dev/null 2>&1; then
    show_dialog "Homebrew installation was attempted, but brew is still not available in this terminal window. Please close this window and open MAC-Start.command again."
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
  show_dialog "Node.js installation was attempted, but node/npm is still not available in this terminal window. Please close this window and open MAC-Start.command again."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 or newer is required. Current version: $(node -v)"
  install_node
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$NODE_MAJOR" -lt 18 ]; then
    show_dialog "Node.js is still older than version 18. Current version: $(node -v). Please close this window and open MAC-Start.command again."
    exit 1
  fi
fi

echo "Checking npm dependencies..."
npm install

if ! node -e "const fs = require('fs'); const { chromium } = require('playwright'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1);" >/dev/null 2>&1; then
  echo "First-time setup: installing Playwright Chromium..."
  npx --yes playwright install chromium
fi

echo "Launching Auto Infotech Claim..."
node src/auto-claim-ui.js

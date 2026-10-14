#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# Android Dev Hub — Termux ARM64 Automated Setup Script
# ==============================================================================

set -e

echo "📱 Setting up Android Dev Hub on Android ARM64..."

# 1. Verify Termux environment
if [ -z "$PREFIX" ] || [ ! -d "/data/data/com.termux" ]; then
  echo "⚠️ Warning: This script is intended to run inside Termux on Android."
  echo "Proceeding anyway with general Linux/Unix setup..."
fi

# 2. Update Termux repositories and packages
echo "📦 Updating Termux package list..."
pkg update -y || apt-get update -y

# 3. Install core dependencies: Node.js, Git
echo "📦 Installing Node.js LTS and Git..."
pkg install -y nodejs-lts git || apt-get install -y nodejs git

echo "✅ Node version: $(node -v)"
echo "✅ Git version:  $(git --version)"

# 4. Create projects workspace directory
PROJECTS_DIR="$HOME/projects"
if [ ! -d "$PROJECTS_DIR" ]; then
  echo "📁 Creating default workspace at $PROJECTS_DIR..."
  mkdir -p "$PROJECTS_DIR"
fi

# 5. Install dependencies and compile TypeScript
echo "🔨 Installing project dependencies..."
npm install

echo "⚙️ Building TypeScript source..."
npm run build

# 6. Make CLI executable and symlink to Termux bin for global access
chmod +x dist/bin/adh.js
if [ -d "$PREFIX/bin" ]; then
  echo "🔗 Creating global 'adh' command in Termux..."
  ln -sf "$(pwd)/dist/bin/adh.js" "$PREFIX/bin/adh"
  echo "✅ 'adh' command registered globally!"
fi

# 7. Check for Antigravity CLI
echo "🔍 Checking for Antigravity AI CLI..."
if command -v antigravity &> /dev/null || command -v agy &> /dev/null; then
  echo "✨ Antigravity CLI detected! AI coding assistant integration is active."
else
  echo "ℹ️ Antigravity CLI not found in PATH yet. Local assistant mode will be used."
fi

echo ""
echo "🎉 Setup Complete!"
echo "To start your Android development workspace, run:"
echo "   adh start"
echo ""
echo "Then open the displayed localhost URL in Chrome or your tablet browser."

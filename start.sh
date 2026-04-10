#!/bin/bash
# Run this script to start Android Media Copier on Linux or macOS.
# The browser opens automatically. Close the browser tab to stop the app.

set -e
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -f "dist/server.js" ]; then
  echo "Building..."
  npm run build
fi

# Detect platform and check for bundled ADB binary
OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  ADB_BIN="bin/mac/adb"
else
  ADB_BIN="bin/linux/adb"
fi

if [ ! -f "$ADB_BIN" ]; then
  echo "Downloading ADB tools (one-time setup, requires internet)..."
  node scripts/setup.js --current
fi

node dist/server.js

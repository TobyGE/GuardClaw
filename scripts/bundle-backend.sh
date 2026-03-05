#!/bin/bash
# Bundle the Node.js backend into GuardClawBar.app
# Usage: ./scripts/bundle-backend.sh <path-to-app-bundle>
#
# This script:
# 1. Downloads a standalone Node.js binary (if not cached)
# 2. Copies server/, client/dist/, package.json, node_modules/ into .app/Contents/Resources/backend/
# 3. The app will auto-start the backend on launch

set -euo pipefail

APP_BUNDLE="${1:?Usage: $0 <path-to-GuardClawBar.app>}"
NODE_VERSION="${NODE_VERSION:-22.14.0}"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) NODE_ARCH="arm64" ;;
  x86_64)        NODE_ARCH="x64" ;;
  *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

PLATFORM="darwin"
NODE_DIST="node-v${NODE_VERSION}-${PLATFORM}-${NODE_ARCH}"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.gz"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="${PROJECT_ROOT}/.node-cache"
BACKEND_DIR="${APP_BUNDLE}/Contents/Resources/backend"

echo "=== Bundling GuardClaw backend into ${APP_BUNDLE} ==="
echo "    Node.js: v${NODE_VERSION} (${NODE_ARCH})"

# Step 1: Download Node.js binary (cached)
mkdir -p "$CACHE_DIR"
NODE_TARBALL="${CACHE_DIR}/${NODE_DIST}.tar.gz"
NODE_BIN="${CACHE_DIR}/${NODE_DIST}/bin/node"

if [ ! -f "$NODE_BIN" ]; then
  echo "--- Downloading Node.js v${NODE_VERSION}..."
  curl -fsSL "$NODE_URL" -o "$NODE_TARBALL"
  tar -xzf "$NODE_TARBALL" -C "$CACHE_DIR"
  rm -f "$NODE_TARBALL"
else
  echo "--- Using cached Node.js binary"
fi

# Step 2: Create backend directory structure
echo "--- Creating backend bundle..."
rm -rf "$BACKEND_DIR"
mkdir -p "$BACKEND_DIR"

# Copy Node.js binary
cp "$NODE_BIN" "$BACKEND_DIR/node"
chmod +x "$BACKEND_DIR/node"

# Copy server code
cp -R "$PROJECT_ROOT/server" "$BACKEND_DIR/server"

# Copy client dist (for the dashboard web UI)
mkdir -p "$BACKEND_DIR/client"
cp -R "$PROJECT_ROOT/client/dist" "$BACKEND_DIR/client/dist"

# Copy package.json (needed for ES module resolution)
cp "$PROJECT_ROOT/package.json" "$BACKEND_DIR/package.json"

# Copy node_modules (production deps only if possible)
if [ -d "$PROJECT_ROOT/node_modules" ]; then
  echo "--- Copying node_modules..."
  cp -R "$PROJECT_ROOT/node_modules" "$BACKEND_DIR/node_modules"
fi

# Step 3: Clean up unnecessary files from the bundle
echo "--- Cleaning up bundle..."
# Remove dev-only files
rm -rf "$BACKEND_DIR/node_modules/.cache"
rm -rf "$BACKEND_DIR/node_modules/.package-lock.json"
# Remove test files from native modules
find "$BACKEND_DIR/node_modules" -name "test" -type d -maxdepth 3 -exec rm -rf {} + 2>/dev/null || true
find "$BACKEND_DIR/node_modules" -name "*.md" -maxdepth 3 -delete 2>/dev/null || true

# Step 4: Bundle Python venv with mlx-lm (for built-in LLM engine)
echo "--- Setting up Python venv with mlx-lm..."
PYTHON_ENV_DIR="${APP_BUNDLE}/Contents/Resources/python-env"

# Find Python 3.10+
SYSTEM_PYTHON=""
for py in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$py" &>/dev/null; then
    ver=$("$py" --version 2>&1 | grep -oE '3\.[0-9]+')
    minor=$(echo "$ver" | cut -d. -f2)
    if [ "$minor" -ge 10 ] 2>/dev/null; then
      SYSTEM_PYTHON="$py"
      break
    fi
  fi
done

if [ -n "$SYSTEM_PYTHON" ]; then
  echo "    Using Python: $SYSTEM_PYTHON ($($SYSTEM_PYTHON --version))"
  "$SYSTEM_PYTHON" -m venv "$PYTHON_ENV_DIR"
  "$PYTHON_ENV_DIR/bin/python3" -m pip install --quiet --no-cache-dir mlx-lm
  # Clean up pip cache and unnecessary files to reduce size
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/*/pip*
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/*/setuptools*
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/*/__pycache__/pip*
  find "$PYTHON_ENV_DIR" -name "*.pyc" -delete 2>/dev/null || true
  find "$PYTHON_ENV_DIR" -name "__pycache__" -empty -delete 2>/dev/null || true
  VENV_SIZE=$(du -sh "$PYTHON_ENV_DIR" | cut -f1)
  echo "    Python env bundled: ${VENV_SIZE}"
else
  echo "    WARNING: No Python 3.10+ found, skipping mlx-lm bundling"
fi

# Calculate bundle size
BUNDLE_SIZE=$(du -sh "$BACKEND_DIR" | cut -f1)
TOTAL_SIZE=$(du -sh "$APP_BUNDLE" | cut -f1)
echo "=== Backend bundle complete: ${BUNDLE_SIZE} (total app: ${TOTAL_SIZE}) ==="
echo "    Location: ${BACKEND_DIR}"

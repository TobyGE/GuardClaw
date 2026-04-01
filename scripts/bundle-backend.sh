#!/bin/bash
# Bundle the Node.js backend into GuardClawBar.app
# Usage: ./scripts/bundle-backend.sh <path-to-app-bundle>
#
# This script:
# 1. Downloads a standalone Node.js binary (if not cached)
# 2. Copies server/, client/dist/, package manifests into .app/Contents/Resources/backend/
# 3. Installs production dependencies with the bundled Node runtime
# 4. The app will auto-start the backend on launch

set -euo pipefail

APP_BUNDLE="${1:?Usage: $0 <path-to-GuardClawBar.app>}"
NODE_VERSION="${NODE_VERSION:-22.21.1}"

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
NODE_NPM="${CACHE_DIR}/${NODE_DIST}/bin/npm"

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

# Copy package manifest + lockfile (needed for deterministic dependency install)
cp "$PROJECT_ROOT/package.json" "$BACKEND_DIR/package.json"
cp "$PROJECT_ROOT/package-lock.json" "$BACKEND_DIR/package-lock.json"

# Copy OC plugin (for one-click install from Dashboard)
cp -R "$PROJECT_ROOT/plugin" "$BACKEND_DIR/plugin"

# Install production dependencies with the bundled Node runtime.
# This avoids ABI mismatches for native modules (e.g. better-sqlite3).
echo "--- Installing production dependencies with bundled Node..."
"$NODE_NPM" ci --omit=dev --prefix "$BACKEND_DIR"

# Step 3: Clean up unnecessary files from the bundle
echo "--- Cleaning up bundle..."
# Remove dev-only files
rm -rf "$BACKEND_DIR/node_modules/.cache"
# Remove test files from native modules
find "$BACKEND_DIR/node_modules" -name "test" -type d -maxdepth 3 -exec rm -rf {} + 2>/dev/null || true
find "$BACKEND_DIR/node_modules" -name "*.md" -maxdepth 3 -delete 2>/dev/null || true

# Step 4: Bundle standalone Python + mlx-lm (for built-in LLM engine)
echo "--- Bundling standalone Python with mlx-lm..."
PYTHON_ENV_DIR="${APP_BUNDLE}/Contents/Resources/python-env"

# Use python-build-standalone for a fully portable Python
# These are self-contained builds that don't depend on system libraries
PY_VERSION="3.12.10"
PY_TAG="20250409"
PY_ARCH="aarch64"  # Apple Silicon only (MLX requires it)
PY_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PY_TAG}/cpython-${PY_VERSION}+${PY_TAG}-${PY_ARCH}-apple-darwin-install_only.tar.gz"
PY_TARBALL="${CACHE_DIR}/python-standalone-${PY_VERSION}-${PY_ARCH}.tar.gz"
PY_EXTRACT="${CACHE_DIR}/python-standalone-${PY_VERSION}"

mkdir -p "$CACHE_DIR"

if [ ! -f "${PY_EXTRACT}/python/bin/python3" ]; then
  echo "    Downloading standalone Python ${PY_VERSION}..."
  curl -fsSL "$PY_URL" -o "$PY_TARBALL"
  mkdir -p "$PY_EXTRACT"
  tar -xzf "$PY_TARBALL" -C "$PY_EXTRACT"
  rm -f "$PY_TARBALL"
fi

STANDALONE_PYTHON="${PY_EXTRACT}/python/bin/python3"

if [ -f "$STANDALONE_PYTHON" ]; then
  echo "    Using standalone Python: $($STANDALONE_PYTHON --version)"

  # Copy the standalone Python into the app bundle
  cp -R "${PY_EXTRACT}/python" "$PYTHON_ENV_DIR"

  # Install mlx-lm and agent-audit into the standalone Python
  "$PYTHON_ENV_DIR/bin/python3" -m pip install --quiet --no-cache-dir mlx-lm
  "$PYTHON_ENV_DIR/bin/python3" -m pip install --quiet --no-cache-dir agent-audit

  # Clean up to reduce size
  rm -rf "$PYTHON_ENV_DIR/share"
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/test
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/*/pip*
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/*/setuptools*
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/ensurepip
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/idlelib
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/tkinter
  rm -rf "$PYTHON_ENV_DIR/lib/python"*/turtle*
  find "$PYTHON_ENV_DIR" -name "*.pyc" -delete 2>/dev/null || true
  find "$PYTHON_ENV_DIR" -name "__pycache__" -type d -empty -delete 2>/dev/null || true

  VENV_SIZE=$(du -sh "$PYTHON_ENV_DIR" | cut -f1)
  echo "    Python env bundled: ${VENV_SIZE}"
else
  echo "    WARNING: Failed to download standalone Python, skipping mlx-lm bundling"
fi

# Calculate bundle size
BUNDLE_SIZE=$(du -sh "$BACKEND_DIR" | cut -f1)
TOTAL_SIZE=$(du -sh "$APP_BUNDLE" | cut -f1)
echo "=== Backend bundle complete: ${BUNDLE_SIZE} (total app: ${TOTAL_SIZE}) ==="
echo "    Location: ${BACKEND_DIR}"

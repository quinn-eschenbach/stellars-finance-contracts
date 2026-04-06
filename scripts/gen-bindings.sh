#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_DIR="$ROOT/target/wasm32v1-none/release"
BIND_OUT="$ROOT/packages/bindings"

CONTRACTS=(
  vault
  position-manager
  config-manager
  oracle-router
  mock-oracle
  mock-token
)

# --- Clean ---
echo "Cleaning old bindings..."
for contract in "${CONTRACTS[@]}"; do
  rm -rf "$BIND_OUT/$contract"
done

# --- Generate ---
for contract in "${CONTRACTS[@]}"; do
  wasm="$WASM_DIR/${contract//-/_}.optimized.wasm"
  if [ ! -f "$wasm" ]; then
    echo "Error: $wasm not found. Run 'make optimize' first."
    exit 1
  fi
  echo "Generating $contract..."
  stellar contract bindings typescript \
    --wasm "$wasm" \
    --output-dir "$BIND_OUT/$contract" \
    --overwrite
done

# --- Parent package.json ---
cat > "$BIND_OUT/package.json" <<'EOF'
{
  "name": "@stellars/bindings",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    "./vault": "./vault/dist/index.js",
    "./position-manager": "./position-manager/dist/index.js",
    "./config-manager": "./config-manager/dist/index.js",
    "./oracle-router": "./oracle-router/dist/index.js",
    "./mock-oracle": "./mock-oracle/dist/index.js",
    "./mock-token": "./mock-token/dist/index.js"
  },
  "dependencies": {
    "@stellar/stellar-sdk": "^14.1.1",
    "buffer": "6.0.3"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
EOF

# --- Install deps ---
echo "Installing dependencies..."
pnpm install --filter @stellars/bindings

# --- Build ---
TSC="$BIND_OUT/node_modules/.bin/tsc"
for contract in "${CONTRACTS[@]}"; do
  echo "Building $contract..."
  (cd "$BIND_OUT/$contract" && "$TSC" 2>/dev/null || true)
  if [ -f "$BIND_OUT/$contract/dist/index.js" ]; then
    echo "  OK"
  else
    echo "  FAILED - no dist output"
    exit 1
  fi
done

echo ""
echo "All bindings generated and built:"
for contract in "${CONTRACTS[@]}"; do
  echo "  - $contract/"
done

#!/usr/bin/env bash
# deploy-local.sh — Build, deploy, and initialize all contracts on the local Stellar network.
# Writes contract addresses to .env.local for the indexer/keepers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_DIR="$ROOT/target/wasm32v1-none/release"
ENV_FILE="$ROOT/.env.local"

RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"

# Ensure 'local' network is configured in CLI
if ! stellar network ls 2>/dev/null | grep -q '^local'; then
  echo "Configuring 'local' network in Stellar CLI..."
  stellar network add local \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE"
fi

# Stellar CLI identity — create an ephemeral 'admin' key if missing
if ! stellar keys address admin &>/dev/null; then
  echo "Creating 'admin' identity..."
  stellar keys generate admin --no-fund
fi
ADMIN_ADDR=$(stellar keys address admin)
echo "Admin: $ADMIN_ADDR"

# Wait for friendbot to be ready (it starts after core syncs)
echo "Waiting for friendbot..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:8000/friendbot?addr=${ADMIN_ADDR}" > /dev/null 2>&1; then
    echo "Admin funded."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "❌ Friendbot not ready after 120s. Is the local network running? (make up)"
    exit 1
  fi
  sleep 2
done

# ---------- Build ----------
echo ""
echo "=== Building WASMs ==="
(cd "$ROOT" && make build)

# ---------- Helper ----------
deploy() {
  local name=$1
  local wasm="$WASM_DIR/$(echo "$name" | tr '-' '_').wasm"
  echo "Deploying $name..." >&2
  stellar contract deploy \
    --wasm "$wasm" \
    --source admin \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE"
}

invoke() {
  stellar contract invoke \
    --source admin \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    "$@"
}

# ---------- Deploy contracts ----------
echo ""
echo "=== Deploying contracts ==="

CM_ID=$(deploy config-manager)
echo "  config-manager : $CM_ID"

OR_ID=$(deploy oracle-router)
echo "  oracle-router  : $OR_ID"

ORACLE_ID=$(deploy oracle)
echo "  oracle (mock)  : $ORACLE_ID"

MOCK_TOKEN_ID=$(deploy mock-token)
echo "  mock-token     : $MOCK_TOKEN_ID"

VAULT_ID=$(deploy vault)
echo "  vault          : $VAULT_ID"

PM_ID=$(deploy position-manager)
echo "  position-mgr   : $PM_ID"

# ---------- Initialize contracts ----------
echo ""
echo "=== Initializing contracts ==="

echo "  config-manager.initialize(admin)"
invoke --id "$CM_ID" -- initialize \
  --admin_address "$ADMIN_ADDR"

echo "  oracle-router.initialize(config_manager)"
invoke --id "$OR_ID" -- initialize \
  --config_manager_address "$CM_ID"

echo "  oracle.initialize(config_manager)"
invoke --id "$ORACLE_ID" -- initialize \
  --config_manager "$CM_ID"

echo "  mock-token.initialize(admin, 7, USDC, USDC)"
invoke --id "$MOCK_TOKEN_ID" -- initialize \
  --admin "$ADMIN_ADDR" \
  --decimals 7 \
  --name "USDC" \
  --symbol "USDC"

echo "  vault.initialize(admin, usdc, config_manager, position_manager)"
invoke --id "$VAULT_ID" -- initialize \
  --admin "$ADMIN_ADDR" \
  --asset "$MOCK_TOKEN_ID" \
  --config_manager "$CM_ID" \
  --position_manager "$PM_ID"

echo "  position-manager.initialize(admin, vault, config_manager, oracle_router)"
invoke --id "$PM_ID" -- initialize \
  --admin "$ADMIN_ADDR" \
  --vault_address "$VAULT_ID" \
  --config_manager "$CM_ID" \
  --oracle_router "$OR_ID"

# ---------- Grant roles ----------
echo ""
echo "=== Granting roles ==="

echo "  grant KEEPER to admin"
invoke --id "$CM_ID" -- grant_role \
  --caller "$ADMIN_ADDR" \
  --role KEEPER \
  --account "$ADMIN_ADDR"

echo "  grant PAUSER to admin"
invoke --id "$CM_ID" -- grant_role \
  --caller "$ADMIN_ADDR" \
  --role PAUSER \
  --account "$ADMIN_ADDR"

# ---------- Wire oracle ----------
echo ""
echo "=== Configuring oracle ==="

echo "  set oracle sources: BTCUSD → mock-oracle"
invoke --id "$OR_ID" -- set_oracle_sources \
  --caller "$ADMIN_ADDR" \
  --symbol BTCUSD \
  --primary '["'"$ORACLE_ID"'"]' \
  --secondary '[]'

echo "  set oracle sources: ETHUSD → mock-oracle"
invoke --id "$OR_ID" -- set_oracle_sources \
  --caller "$ADMIN_ADDR" \
  --symbol ETHUSD \
  --primary '["'"$ORACLE_ID"'"]' \
  --secondary '[]'

echo "  set oracle config"
invoke --id "$OR_ID" -- set_oracle_config \
  --caller "$ADMIN_ADDR" \
  --config '{"cache_duration":60,"max_deviation_bps":"500","staleness_threshold":600}'

# ---------- Seed oracle prices ----------
echo ""
echo "=== Seeding oracle prices ==="

echo "  BTC = 650000000000 (65,000 * 1e7)"
invoke --id "$ORACLE_ID" -- set_price \
  --caller "$ADMIN_ADDR" \
  --symbol BTCUSD \
  --price 650000000000

echo "  ETH = 35000000000 (3,500 * 1e7)"
invoke --id "$ORACLE_ID" -- set_price \
  --caller "$ADMIN_ADDR" \
  --symbol ETHUSD \
  --price 35000000000

# ---------- Capture current ledger ----------
LATEST_LEDGER=$(curl -sf "$RPC_URL" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' \
  | grep -o '"sequence":[0-9]*' | head -1 | cut -d: -f2)
LATEST_LEDGER=${LATEST_LEDGER:-1}
echo "  Latest ledger: $LATEST_LEDGER"

# ---------- Write .env.local ----------
echo ""
echo "=== Writing $ENV_FILE ==="
cat > "$ENV_FILE" <<EOF
# Auto-generated by scripts/deploy-local.sh — $(date -u +%Y-%m-%dT%H:%M:%SZ)
DATABASE_URL=postgresql://stellars:stellars@localhost:5432/stellars
RPC_URL=$RPC_URL
NETWORK=testnet
START_LEDGER=$LATEST_LEDGER
POLL_INTERVAL_MS=3000
HEALTH_PORT=3001

# Contract addresses
VAULT_CONTRACT=$VAULT_ID
PM_CONTRACT=$PM_ID
CM_CONTRACT=$CM_ID
OR_CONTRACT=$OR_ID

# Extras (not consumed by indexer, useful for scripts)
ORACLE_CONTRACT=$ORACLE_ID
MOCK_TOKEN_CONTRACT=$MOCK_TOKEN_ID
ADMIN_ADDRESS=$ADMIN_ADDR
EOF

echo ""
echo "=== Done ==="
echo "Contracts deployed and initialized. Addresses in $ENV_FILE"
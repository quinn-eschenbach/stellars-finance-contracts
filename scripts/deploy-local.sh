#!/usr/bin/env bash
# deploy-local.sh — Build, deploy, and initialize all contracts on the local Stellar network.
# Writes contract addresses to .env.local for the indexer/keepers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_DIR="$ROOT/target/wasm32v1-none/release"
ENV_FILE="$ROOT/.env.local"
ADDRESSES_FILE="$ROOT/packages/config/addresses.json"
NETWORK_KEY="${NETWORK_KEY:-local}"

RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq is required to write $ADDRESSES_FILE — install via 'brew install jq'"
  exit 1
fi

current_ledger() {
  curl -sf "$RPC_URL" \
    -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' \
    | grep -o '"sequence":[0-9]*' | head -1 | cut -d: -f2
}

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

# Separate keeper identity. Sharing admin causes sequence-number contention
# between keeper submissions and admin-issued sim/oracle calls.
if ! stellar keys address keeper &>/dev/null; then
  echo "Creating 'keeper' identity..."
  stellar keys generate keeper --no-fund
fi
KEEPER_ADDR=$(stellar keys address keeper)
echo "Keeper: $KEEPER_ADDR"

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

# Fund keeper account.
curl -sf "http://localhost:8000/friendbot?addr=${KEEPER_ADDR}" > /dev/null 2>&1 || true
echo "Keeper funded."

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
CM_LEDGER=$(current_ledger)
echo "  config-manager : $CM_ID  (ledger $CM_LEDGER)"

OR_ID=$(deploy oracle-router)
OR_LEDGER=$(current_ledger)
echo "  oracle-router  : $OR_ID  (ledger $OR_LEDGER)"

ORACLE_ID=$(deploy oracle)
ORACLE_LEDGER=$(current_ledger)
echo "  oracle (mock)  : $ORACLE_ID  (ledger $ORACLE_LEDGER)"

MOCK_TOKEN_ID=$(deploy mock-token)
MOCK_TOKEN_LEDGER=$(current_ledger)
echo "  mock-token     : $MOCK_TOKEN_ID  (ledger $MOCK_TOKEN_LEDGER)"

VAULT_ID=$(deploy vault)
VAULT_LEDGER=$(current_ledger)
echo "  vault          : $VAULT_ID  (ledger $VAULT_LEDGER)"

PM_ID=$(deploy position-manager)
PM_LEDGER=$(current_ledger)
echo "  position-mgr   : $PM_ID  (ledger $PM_LEDGER)"

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

echo "  grant KEEPER to keeper"
invoke --id "$CM_ID" -- grant_role \
  --caller "$ADMIN_ADDR" \
  --role KEEPER \
  --account "$KEEPER_ADDR"

echo "  grant PAUSER to admin"
invoke --id "$CM_ID" -- grant_role \
  --caller "$ADMIN_ADDR" \
  --role PAUSER \
  --account "$ADMIN_ADDR"

# ---------- Relax protocol limits for local dev ----------
echo ""
echo "=== Setting local protocol limits (zero cooldowns) ==="
invoke --id "$CM_ID" -- update_protocol_limits \
  --caller "$ADMIN_ADDR" \
  --limits '{"min_collateral":"10000000","cooldown_duration":0,"min_position_lifetime":0,"max_utilization_ratio":"8500","funding_cut_bps":500,"adl_pnl_bps":9000,"adl_utilization_bps":9500}'

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

# ---------- Configure markets in PositionManager ----------
echo ""
echo "=== Configuring PositionManager markets ==="

echo "  set_max_leverage(BTCUSD, 50)"
invoke --id "$PM_ID" -- set_max_leverage \
  --caller "$ADMIN_ADDR" \
  --symbol BTCUSD \
  --max_leverage 50

echo "  set_max_leverage(ETHUSD, 50)"
invoke --id "$PM_ID" -- set_max_leverage \
  --caller "$ADMIN_ADDR" \
  --symbol ETHUSD \
  --max_leverage 50

# ---------- Write addresses.json ----------
echo ""
echo "=== Writing $ADDRESSES_FILE [$NETWORK_KEY] ==="
TMP_ADDR=$(mktemp)
jq \
  --arg net "$NETWORK_KEY" \
  --arg vault "$VAULT_ID"           --argjson vaultL    "${VAULT_LEDGER:-0}" \
  --arg pm "$PM_ID"                 --argjson pmL       "${PM_LEDGER:-0}" \
  --arg cm "$CM_ID"                 --argjson cmL       "${CM_LEDGER:-0}" \
  --arg or "$OR_ID"                 --argjson orL       "${OR_LEDGER:-0}" \
  --arg oracle "$ORACLE_ID"         --argjson oracleL   "${ORACLE_LEDGER:-0}" \
  '.[$net].contracts.vault          = {address: $vault,  startLedger: $vaultL}
   | .[$net].contracts.positionManager = {address: $pm,    startLedger: $pmL}
   | .[$net].contracts.configManager   = {address: $cm,    startLedger: $cmL}
   | .[$net].contracts.oracleRouter    = {address: $or,    startLedger: $orL}
   | .[$net].contracts.oracle          = {address: $oracle,startLedger: $oracleL}' \
  "$ADDRESSES_FILE" > "$TMP_ADDR"
mv "$TMP_ADDR" "$ADDRESSES_FILE"

# ---------- Write .env.local (services + extras only) ----------
echo ""
echo "=== Writing $ENV_FILE ==="
KEEPER_SECRET=$(stellar keys show keeper)
cat > "$ENV_FILE" <<EOF
# Auto-generated by scripts/deploy-local.sh — $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Contract addresses live in packages/config/addresses.json under network "$NETWORK_KEY".
DATABASE_URL=postgresql://stellars:stellars@localhost:5432/stellars
NETWORK=$NETWORK_KEY
POLL_INTERVAL_MS=3000
HEALTH_PORT=3001

# Keeper runs on its own keypair (granted KEEPER role above) so it doesn't
# contend with admin for sequence numbers during sim/oracle calls.
KEEPER_SECRET=$KEEPER_SECRET

# Extras (not consumed by indexer, useful for scripts/sim)
ORACLE_CONTRACT=$ORACLE_ID
MOCK_TOKEN_CONTRACT=$MOCK_TOKEN_ID
ADMIN_ADDRESS=$ADMIN_ADDR
KEEPER_ADDRESS=$KEEPER_ADDR
EOF

echo ""
echo "=== Done ==="
echo "Contracts deployed and initialized."
echo "  Addresses → $ADDRESSES_FILE"
echo "  Services  → $ENV_FILE"
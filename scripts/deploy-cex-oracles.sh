#!/usr/bin/env bash
# deploy-cex-oracles.sh — Deploy and register Binance + KuCoin oracle instances.
#
# Each CEX gets its own on-chain `oracle` contract (so OracleRouter can
# median across sources) and its own publisher keypair (so they don't
# contend on sequence numbers when running in parallel).
#
# Idempotent: skips deployment if addresses.json already has a non-empty
# slot for the source. Always re-grants ORACLE and re-registers router
# primaries so the script can be safely re-run after editing TICKERS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_DIR="$ROOT/target/wasm32v1-none/release"
ENV_FILE="$ROOT/.env.local"
ADDRESSES_FILE="$ROOT/packages/config/addresses.json"
NETWORK_KEY="${NETWORK_KEY:-local}"

RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"

# Tickers to register for both sources. Edit here AND in each oracle
# package's src/index.ts to add a new market — the script and the oracle
# loop must agree on what's published.
TICKERS=("BTCUSD" "ETHUSD")

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq is required — install via 'brew install jq'"
  exit 1
fi

current_ledger() {
  curl -sf "$RPC_URL" \
    -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' \
    | grep -o '"sequence":[0-9]*' | head -1 | cut -d: -f2
}

invoke() {
  stellar contract invoke \
    --source admin \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    "$@"
}

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

# ---------- Pull required base addresses ----------
CM_ID=$(jq -r ".[\"$NETWORK_KEY\"].contracts.configManager.address" "$ADDRESSES_FILE")
OR_ID=$(jq -r ".[\"$NETWORK_KEY\"].contracts.oracleRouter.address" "$ADDRESSES_FILE")
MOCK_ORACLE_ID=$(jq -r ".[\"$NETWORK_KEY\"].contracts.oracle.address" "$ADDRESSES_FILE")
ADMIN_ADDR=$(stellar keys address admin 2>/dev/null || true)

if [[ -z "$CM_ID" || "$CM_ID" == "null" || -z "$OR_ID" || "$OR_ID" == "null" || -z "$ADMIN_ADDR" ]]; then
  echo "❌ Base contracts not deployed. Run 'make deploy' first."
  exit 1
fi

# ---------- Build (only oracle wasm needed) ----------
echo ""
echo "=== Building oracle wasm ==="
(cd "$ROOT" && cargo build --target wasm32v1-none --release -p oracle)

# ---------- Generate / load per-source keypairs ----------
ensure_key() {
  local name=$1
  if ! stellar keys address "$name" &>/dev/null; then
    echo "Creating '$name' identity..."
    stellar keys generate "$name"
  fi
  stellar keys address "$name"
}

BINANCE_KEY_ADDR=$(ensure_key binance-oracle)
KUCOIN_KEY_ADDR=$(ensure_key kucoin-oracle)

# Friendbot returns 200 on first fund and 400 on subsequent ("already funded").
# We must treat the 400-with-existing-account case as success — but we cannot
# treat a curl failure as success, otherwise the account never lands on-chain
# and the publisher dies later with "Account not found". Verify against the
# RPC after each attempt and retry until visible.
account_exists() {
  local addr=$1
  # Horizon at :8000 returns 200 if the account is funded and visible,
  # 4xx otherwise. We use this rather than the Soroban RPC because the
  # local quickstart container already exposes Horizon here.
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8000/accounts/${addr}")
  [[ "$code" == "200" ]]
}

fund_account() {
  local addr=$1
  local label=$2
  for attempt in $(seq 1 30); do
    curl -sf "http://localhost:8000/friendbot?addr=${addr}" >/dev/null 2>&1 || true
    if account_exists "$addr"; then
      echo "  $label funded ($addr)"
      return 0
    fi
    sleep 1
  done
  echo "❌ Failed to fund $label ($addr) after 30s"
  echo "   Re-run manually: curl 'http://localhost:8000/friendbot?addr=$addr'"
  exit 1
}

echo "Funding publisher keypairs..."
fund_account "$BINANCE_KEY_ADDR" binance-oracle
fund_account "$KUCOIN_KEY_ADDR" kucoin-oracle

# ---------- Deploy oracle instances ----------
# Always deploy fresh. The previous "reuse if addresses.json has an entry"
# optimization was unsafe across `make reset` — the chain wipe leaves stale
# addresses in addresses.json that point to dead contracts, and downstream
# init/set_price calls fail with confusing "Contract not found" errors.
echo ""
echo "=== Deploying oracle instances ==="
BINANCE_ID=$(deploy oracle)
BINANCE_LEDGER=$(current_ledger)
echo "  binance-oracle : $BINANCE_ID  (ledger $BINANCE_LEDGER)"

KUCOIN_ID=$(deploy oracle)
KUCOIN_LEDGER=$(current_ledger)
echo "  kucoin-oracle  : $KUCOIN_ID  (ledger $KUCOIN_LEDGER)"

# ---------- Initialize ----------
# Surface any failure rather than swallowing it — the previous version
# masked "Contract not found" / arg-mismatch / RPC errors as "already
# initialized" and the publishers later died with cryptic Storage errors.
echo ""
echo "=== Initializing oracle instances ==="
echo "  binance-oracle.initialize($CM_ID)"
invoke --id "$BINANCE_ID" -- initialize --config_manager "$CM_ID"
echo "  kucoin-oracle.initialize($CM_ID)"
invoke --id "$KUCOIN_ID" -- initialize --config_manager "$CM_ID"

# ---------- Grant ORACLE role to publishers ----------
grant_oracle() {
  local addr=$1
  local label=$2
  echo "  grant ORACLE to $label ($addr)"
  # OZ AccessControl::grant_role is idempotent — granting a role already
  # held is a silent no-op — so we don't need to swallow "already granted"
  # errors. Any failure here (wrong CM, missing admin role, network) is
  # genuine and should halt the script.
  invoke --id "$CM_ID" -- grant_role \
    --caller "$ADMIN_ADDR" \
    --role ORACLE \
    --account "$addr"
}

echo ""
echo "=== Granting ORACLE role ==="
grant_oracle "$ADMIN_ADDR" admin       # so deploy-local seeding + sim still work
grant_oracle "$BINANCE_KEY_ADDR" binance-oracle
grant_oracle "$KUCOIN_KEY_ADDR" kucoin-oracle

# ---------- Register sources on the OracleRouter ----------
# Strategy: rewrite primaries to [mock_oracle, binance, kucoin] so the
# existing simulation (which pushes through mock_oracle) keeps working
# alongside the live CEX feeds. Router takes the median across all three.
echo ""
echo "=== Registering router primaries (${TICKERS[*]}) ==="
PRIMARY_JSON=$(jq -nc \
  --arg m "$MOCK_ORACLE_ID" \
  --arg b "$BINANCE_ID" \
  --arg k "$KUCOIN_ID" \
  '[$m, $b, $k]')

for ticker in "${TICKERS[@]}"; do
  echo "  set_oracle_sources($ticker)"
  invoke --id "$OR_ID" -- set_oracle_sources \
    --caller "$ADMIN_ADDR" \
    --symbol "$ticker" \
    --primary "$PRIMARY_JSON" \
    --secondary '[]'
done

# ---------- Persist addresses.json ----------
echo ""
echo "=== Updating $ADDRESSES_FILE ==="
TMP=$(mktemp)
jq \
  --arg net "$NETWORK_KEY" \
  --arg b "$BINANCE_ID"   --argjson bL "${BINANCE_LEDGER:-0}" \
  --arg k "$KUCOIN_ID"    --argjson kL "${KUCOIN_LEDGER:-0}" \
  '.[$net].contracts.binanceOracle = {address: $b, startLedger: $bL}
   | .[$net].contracts.kucoinOracle  = {address: $k, startLedger: $kL}' \
  "$ADDRESSES_FILE" > "$TMP"
mv "$TMP" "$ADDRESSES_FILE"

# ---------- Append publisher secrets to .env.local ----------
BINANCE_SECRET=$(stellar keys show binance-oracle)
KUCOIN_SECRET=$(stellar keys show kucoin-oracle)

echo ""
echo "=== Updating $ENV_FILE with publisher secrets ==="
# Strip any prior CEX-publisher block before re-appending, so re-running the
# script doesn't grow the env file with duplicates.
if [[ -f "$ENV_FILE" ]]; then
  TMP_ENV=$(mktemp)
  awk '/^# --- CEX oracle publishers ---$/{stop=1} !stop' "$ENV_FILE" > "$TMP_ENV"
  mv "$TMP_ENV" "$ENV_FILE"
fi
cat >> "$ENV_FILE" <<EOF
# --- CEX oracle publishers ---
BINANCE_ORACLE_SECRET=$BINANCE_SECRET
KUCOIN_ORACLE_SECRET=$KUCOIN_SECRET
EOF

echo ""
echo "=== Done ==="
echo "  binance-oracle : $BINANCE_ID  (publisher $BINANCE_KEY_ADDR)"
echo "  kucoin-oracle  : $KUCOIN_ID  (publisher $KUCOIN_KEY_ADDR)"
echo ""
echo "Run 'make oracles-cex' to start both publisher loops."

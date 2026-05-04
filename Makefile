CONTRACTS = vault position-manager config-manager oracle oracle-router mock-oracle mock-token
WASM_DIR  = target/wasm32v1-none/release

# Local network
RPC_URL       ?= http://localhost:8000/soroban/rpc
PASSPHRASE    ?= Standalone Network ; February 2017
SOURCE        ?= admin
DEPLOY_CONTRACTS = config-manager oracle-router vault position-manager
ENV_FILE      = .env.local

.PHONY: build optimize test clean up down deploy db-migrate db-generate db-push sim sim-one sim-cleanup grant-keepers indexer keeper api frontend server oracles cex-oracles oracle-binance oracle-kucoin oracles-cex

build:
	cargo build --target wasm32v1-none --release \
		-p vault \
		-p position-manager \
		-p config-manager \
		-p oracle \
		-p oracle-router \
		-p mock-token \
		-p mock-oracle

optimize: build
	@for contract in $(CONTRACTS); do \
		wasm="$(WASM_DIR)/$$(echo $$contract | tr '-' '_').wasm"; \
		echo "Optimizing $$wasm..."; \
		stellar contract optimize --wasm "$$wasm"; \
	done

bind: optimize
	bash scripts/gen-bindings.sh

test:
	cargo test

clean:
	cargo clean

# ---- Local dev environment ----

up:
	docker compose up -d --wait
	@echo "Local services ready."

down:
	docker compose down

reset:
	docker compose down -v
	$(MAKE) local

deploy: build
	bash scripts/deploy-local.sh

grant-keepers:
	bash scripts/grant-keepers.sh

db-migrate:
	pnpm --filter @stellars/db migrate

# Generate a new migration from the current schema. Usage: `make db-generate NAME=add_foo`.
db-generate:
	cd packages/db && pnpm exec tsc && pnpm exec drizzle-kit generate --name $(NAME)

# Direct schema push — bypasses migrations. Use only for local exploration;
# never against shared environments. Real changes must go through db-migrate.
db-push:
	pnpm --filter @stellars/db push

indexer:
	pnpm --filter @stellars/indexer dev

keeper:
	pnpm --filter @stellars/keeper dev

api:
	pnpm --filter @stellars/api dev

frontend:
	pnpm --filter @stellars/frontend dev

# Local-dev convenience: run everything in the server bundle in parallel.
# Production deploys ship api + indexer + keeper as services and serve the
# frontend statically; oracle publishers run in their own bundle (see the
# project memory on server-vs-oracles split). `make server` collapses all
# of that into one command for local iteration. Requires `make cex-oracles`
# to have been run first so the publishers find populated addresses.
server:
	pnpm --parallel \
	  --filter @stellars/indexer \
	  --filter @stellars/keeper \
	  --filter @stellars/api \
	  --filter @stellars/frontend \
	  --filter @stellars/oracle-binance \
	  --filter @stellars/oracle-kucoin dev

# Oracles run as a separate service in production. oracle-keeper is currently
# a stub; this target reserves the slot.
oracles:
	pnpm --filter @stellars/oracle-keeper dev

# ---- CEX oracle implementations (Binance, KuCoin) ----
# One-time setup: deploys two `oracle` contract instances, generates
# per-source publisher keypairs, grants ORACLE role, and registers them as
# additional primaries on the OracleRouter alongside the existing mock.
cex-oracles:
	bash scripts/deploy-cex-oracles.sh

# Run individual publishers (foreground).
oracle-binance:
	pnpm --filter @stellars/oracle-binance dev

oracle-kucoin:
	pnpm --filter @stellars/oracle-kucoin dev

# Run both publishers in parallel — typical local dev flow after `make cex-oracles`.
oracles-cex:
	pnpm --parallel \
	  --filter @stellars/oracle-binance \
	  --filter @stellars/oracle-kucoin dev

sim:
	pnpm --filter @stellars/simulation sim

sim-one:
	pnpm --filter @stellars/simulation sim:one -- $(SCENARIO)

sim-cleanup:
	pnpm --filter @stellars/simulation cleanup

# Full local bootstrap (on-chain only): services → schema → core contracts →
# CEX oracle contracts. After this, `make server` brings up all off-chain
# processes (indexer, keeper, api, frontend, oracle publishers) in parallel.
local: up db-migrate deploy cex-oracles
	@echo ""
	@echo "Local environment ready! Run 'make server' to start the off-chain stack, then 'make sim'."

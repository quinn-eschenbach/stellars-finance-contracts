CONTRACTS = vault position-manager config-manager oracle oracle-router mock-oracle mock-token
WASM_DIR  = target/wasm32v1-none/release

# Local network
RPC_URL       ?= http://localhost:8000/soroban/rpc
PASSPHRASE    ?= Standalone Network ; February 2017
SOURCE        ?= admin
DEPLOY_CONTRACTS = config-manager oracle-router vault position-manager
ENV_FILE      = .env.local

.PHONY: build optimize test clean up down deploy db-push sim sim-one sim-cleanup grant-keepers indexer keeper api server oracles

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
	docker compose up -d
	@echo "Waiting for Stellar RPC..."
	@until curl -sf http://localhost:8000 >/dev/null 2>&1; do sleep 2; done
	@echo "Waiting for friendbot..."
	@until curl -sf 'http://localhost:8000/friendbot?addr=GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7' >/dev/null 2>&1; do sleep 2; done
	@echo "Waiting for Postgres..."
	@until docker exec stellars-postgres pg_isready -U stellars >/dev/null 2>&1; do sleep 1; done
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

db-push:
	pnpm --filter @stellars/db push

indexer:
	pnpm --filter @stellars/indexer dev

keeper:
	pnpm --filter @stellars/keeper dev

api:
	pnpm --filter @stellars/api dev

# Production deploy unit: api + indexer + db + keeper share one server bundle.
server:
	pnpm --parallel --filter @stellars/indexer --filter @stellars/keeper --filter @stellars/api dev

# Oracles run as a separate service in production. oracle-keeper is currently
# a stub; this target reserves the slot.
oracles:
	pnpm --filter @stellars/oracle-keeper dev

sim:
	pnpm --filter @stellars/simulation sim

sim-one:
	pnpm --filter @stellars/simulation sim:one -- $(SCENARIO)

sim-cleanup:
	pnpm --filter @stellars/simulation cleanup

# Full local bootstrap: services → schema → contracts → indexer hint
local: up db-push deploy
	@echo ""
	@echo "Local environment ready! Run 'make indexer' in another terminal, then 'make sim'."

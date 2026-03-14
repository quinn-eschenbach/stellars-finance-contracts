CONTRACTS = vault position-manager config-manager oracle-router
WASM_DIR  = target/wasm32v1-none/release

.PHONY: build optimize test bind sdk publish-sdk clean

build:
	cargo build --target wasm32v1-none --release \
		-p vault \
		-p position-manager \
		-p config-manager \
		-p oracle-router \
		-p mock-token \
		-p mock-oracle

optimize: build
	@for contract in $(CONTRACTS); do \
		wasm="$(WASM_DIR)/$$(echo $$contract | tr '-' '_').wasm"; \
		echo "Optimizing $$wasm..."; \
		stellar contract optimize --wasm "$$wasm"; \
	done

test:
	cargo test

bind: optimize
	@for contract in $(CONTRACTS); do \
		wasm="$(WASM_DIR)/$$(echo $$contract | tr '-' '_').optimized.wasm"; \
		echo "Generating TypeScript bindings for $$contract..."; \
		stellar contract bindings typescript \
			--wasm "$$wasm" \
			--output-dir "bindings/$$contract" \
			--overwrite; \
		echo "Patching package name for $$contract..."; \
		sed -i '' 's/"name": *"[^"]*"/"name": "@stellars-finance\/'"$$contract"'"/' \
			"bindings/$$contract/package.json"; \
	done

sdk: bind
	@for contract in $(CONTRACTS); do \
		echo "Building bindings for $$contract..."; \
		(cd bindings/$$contract && npm install && (npm run build || true)); \
	done
	cd sdk && npm install && npm run build

publish-sdk: sdk
	cd sdk && npm publish

clean:
	cargo clean

CONTRACTS = vault position-manager config-manager oracle-router
WASM_DIR  = target/wasm32-unknown-unknown/release

.PHONY: build optimize test bind clean

build:
	cargo build --target wasm32-unknown-unknown --release

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
			--contract-id placeholder \
			--output-dir "bindings/$$contract" \
			--overwrite; \
	done

clean:
	cargo clean

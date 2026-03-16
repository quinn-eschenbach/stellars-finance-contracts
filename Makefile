CONTRACTS = vault position-manager config-manager oracle oracle-router
WASM_DIR  = target/wasm32v1-none/release

.PHONY: build optimize test clean

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

BIND_CONTRACTS = vault position-manager config-manager oracle-router
BIND_OUT       = packages/bindings

bind: optimize
	@rm -rf $(BIND_OUT)
	@mkdir -p $(BIND_OUT)
	@for contract in $(BIND_CONTRACTS); do \
		wasm="$(WASM_DIR)/$$(echo $$contract | tr '-' '_').optimized.wasm"; \
		echo "Generating bindings for $$contract..."; \
		stellar contract bindings typescript \
			--wasm "$$wasm" \
			--output-dir "$(BIND_OUT)/$$contract" \
			--overwrite; \
	done
	@echo '{ "name": "@stellars/bindings", "version": "0.0.1", "private": true, "type": "module" }' > $(BIND_OUT)/package.json

test:
	cargo test

clean:
	cargo clean

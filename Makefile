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

test:
	cargo test

clean:
	cargo clean

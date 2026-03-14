# stellars-finance-sdk

TypeScript SDK for the Stellars Finance perpetual DEX on Stellar/Soroban.

Wraps auto-generated contract bindings for all four protocol contracts into a single package with aliased clients, namespaced types, and network helpers.

## Install

```bash
npm install stellars-finance-sdk
```

## Quick start

```ts
import {
  VaultClient,
  PositionManagerClient,
  ConfigManagerClient,
  OracleRouterClient,
  Networks,
} from 'stellars-finance-sdk';

const network = Networks.testnet;

const vault = new VaultClient({
  contractId: network.contractIds.vault,
  rpcUrl: network.rpcUrl,
  networkPassphrase: network.networkPassphrase,
});

// Read vault state (no signing needed)
const freeL = await vault.free_liquidity();
console.log('Free liquidity:', freeL.result);

// Deposit into vault (requires signing)
const tx = await vault.deposit({
  assets: 1_000_0000000n, // 1000 USDC (7 decimals)
  receiver: publicKey,
  from: publicKey,
  operator: publicKey,
});
await tx.signAndSend();
```

## Exports

### Clients

| Export | Contract |
|---|---|
| `VaultClient` | SEP-41 LP token + USDC treasury (ERC-4626) |
| `PositionManagerClient` | Trading engine: positions, liquidations, ADL |
| `ConfigManagerClient` | Role management, fees, protocol limits |
| `OracleRouterClient` | SEP-40 median price aggregation |

### Namespaced types

Each contract's full type set is available under a namespace to avoid collisions:

```ts
import { vault, positionManager, configManager, oracleRouter } from 'stellars-finance-sdk';

type Position = positionManager.Position;
type OracleConfig = oracleRouter.OracleConfig;
type FeeSplits = configManager.FeeSplits;
```

### Network helpers

```ts
import { Networks, getContractIds } from 'stellars-finance-sdk';

// Pre-configured network settings
const { rpcUrl, networkPassphrase, contractIds } = Networks.testnet;

// Or just the IDs
const ids = getContractIds('testnet');
```

## Improving JSDoc on generated bindings

Doc comments from the Rust contract source (`///`) automatically flow into the TypeScript bindings via the WASM contract spec. To add or improve documentation visible to SDK consumers:

1. Add `///` doc comments to public functions in `src/contract.rs`
2. Add `///` doc comments to types/fields in `src/types.rs` or `shared/src/lib.rs`
3. Run `make sdk` to regenerate

## Building from source

```bash
# From the repo root
make sdk    # build -> optimize -> bind -> npm build
```

Requires: `stellar` CLI, Rust with `wasm32v1-none` target, Node.js 18+.

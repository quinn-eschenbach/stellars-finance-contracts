import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Network = "local" | "testnet" | "mainnet";

export interface ContractInfo {
  /** Deployed contract address (C...). Empty string if not yet deployed. */
  address: string;
  /** Ledger sequence at which this contract was deployed. 0 if not yet deployed. */
  startLedger: number;
}

export interface NetworkContracts {
  vault: ContractInfo;
  positionManager: ContractInfo;
  configManager: ContractInfo;
  oracleRouter: ContractInfo;
  oracle: ContractInfo;
  /** Per-source oracle instances populated by scripts/deploy-cex-oracles.sh. */
  binanceOracle: ContractInfo;
  kucoinOracle: ContractInfo;
  /** Test-only mock USDC token. Empty address on mainnet. */
  mockToken: ContractInfo;
}

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  /** Markets supported on this network. Single source of truth for oracle
   *  publishers, indexer poller, frontend symbol picker, and deploy scripts. */
  tickers: readonly string[];
  contracts: NetworkContracts;
}

export type Addresses = Record<Network, NetworkConfig>;

// Read the source addresses.json at runtime (not bundled into dist), so that
// `make deploy` updates are picked up without rebuilding this package.
//
// __dirname resolves to:
//   - packages/config/dist  when consumed as a built package (the normal case)
//   - packages/config       when imported directly from source (e.g. via bun)
// addresses.json lives at packages/config/addresses.json — try both layouts.
const here = dirname(fileURLToPath(import.meta.url));

function loadAddresses(): Addresses {
  const candidates = [
    resolve(here, "..", "addresses.json"),
    resolve(here, "addresses.json"),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Addresses;
    } catch {
      // try next
    }
  }
  throw new Error(
    `@stellars/config: addresses.json not found. Looked in:\n  ${candidates.join("\n  ")}`,
  );
}

export const config: Addresses = loadAddresses();

export function getNetworkConfig(network: Network): NetworkConfig {
  return config[network];
}

export * from "./constants.js";

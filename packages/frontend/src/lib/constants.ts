import addresses from "@stellars/config/addresses.json";

const NETWORK = (import.meta.env.VITE_NETWORK ?? "local") as keyof typeof addresses;
const networkConfig = addresses[NETWORK];
if (!networkConfig) {
  throw new Error(`addresses.json: network "${NETWORK}" not found`);
}

export const CONTRACTS = {
  vault: networkConfig.contracts.vault.address,
  positionManager: networkConfig.contracts.positionManager.address,
  configManager: networkConfig.contracts.configManager.address,
  oracleRouter: networkConfig.contracts.oracleRouter.address,
  oracle: networkConfig.contracts.oracle.address,
};

export const RPC_URL = networkConfig.rpcUrl;
export const NETWORK_PASSPHRASE = networkConfig.networkPassphrase;
export const NETWORK_NAME = NETWORK;

/** Mock USDC token, populated by `make deploy` for local/testnet. Empty on mainnet. */
export const MOCK_TOKEN_CONTRACT = networkConfig.contracts.mockToken?.address ?? "";

/** Symbols supported in the UI. Sourced from addresses.json so the protocol
 *  decides what trades; the UI never gets out of sync. */
export const SUPPORTED_SYMBOLS = networkConfig.tickers as readonly string[];
export type Symbol = string;

/** Backend API base URL. Vite proxies /api → API in dev. */
export const API_BASE = (import.meta.env.VITE_API_URL ?? "/api") as string;

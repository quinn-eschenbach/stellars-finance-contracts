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

/** Mock token contract — sourced from .env at build time (Vite injects). */
export const MOCK_TOKEN_CONTRACT = (import.meta.env.VITE_MOCK_TOKEN_CONTRACT ?? "") as string;

/** Symbols supported in the UI. Mirrors what the protocol has configured. */
export const SUPPORTED_SYMBOLS = ["BTCUSD", "ETHUSD"] as const;
export type Symbol = (typeof SUPPORTED_SYMBOLS)[number];

/** Backend API base URL. Vite proxies /api → API in dev. */
export const API_BASE = (import.meta.env.VITE_API_URL ?? "/api") as string;

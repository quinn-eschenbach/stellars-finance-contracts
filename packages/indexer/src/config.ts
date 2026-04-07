import { getNetworkConfig, type Network } from "@stellars/config";

export interface IndexerConfig {
  databaseUrl: string;
  network: Network;
  rpcUrl: string;
  networkPassphrase: string;
  pollIntervalMs: number;
  startLedger: number;
  healthPort: number;
  contracts: {
    vault: string;
    positionManager: string;
    configManager: string;
    oracleRouter: string;
  };
}

export function loadConfig(): IndexerConfig {
  const network = (process.env.NETWORK ?? "testnet") as Network;
  const networkConfig = getNetworkConfig(network);

  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    network,
    rpcUrl: process.env.RPC_URL ?? networkConfig.rpcUrl,
    networkPassphrase: networkConfig.networkPassphrase,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
    startLedger: Number(process.env.START_LEDGER ?? 0),
    healthPort: Number(process.env.HEALTH_PORT ?? 3001),
    contracts: {
      vault: process.env.VAULT_CONTRACT ?? networkConfig.contracts.vault,
      positionManager: process.env.PM_CONTRACT ?? networkConfig.contracts.positionManager,
      configManager: process.env.CM_CONTRACT ?? networkConfig.contracts.configManager,
      oracleRouter: process.env.OR_CONTRACT ?? networkConfig.contracts.oracleRouter,
    },
  };
}

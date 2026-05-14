import {
  getNetworkConfig,
  INDEXER_POLL_INTERVAL_MS,
  type ContractInfo,
  type Network,
} from "@stellars/config";

export interface IndexerConfig {
  databaseUrl: string;
  network: Network;
  rpcUrl: string;
  networkPassphrase: string;
  pollIntervalMs: number;
  healthPort: number;
  tickers: readonly string[];
  contracts: {
    vault: ContractInfo;
    positionManager: ContractInfo;
    configManager: ContractInfo;
    oracleRouter: ContractInfo;
  };
}

export function loadConfig(): IndexerConfig {
  const network = (process.env.NETWORK ?? "testnet") as Network;
  const networkConfig = getNetworkConfig(network);

  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    network,
    rpcUrl: networkConfig.rpcUrl,
    networkPassphrase: networkConfig.networkPassphrase,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? INDEXER_POLL_INTERVAL_MS),
    healthPort: Number(process.env.HEALTH_PORT ?? 3001),
    tickers: networkConfig.tickers,
    contracts: {
      vault: networkConfig.contracts.vault,
      positionManager: networkConfig.contracts.positionManager,
      configManager: networkConfig.contracts.configManager,
      oracleRouter: networkConfig.contracts.oracleRouter,
    },
  };
}

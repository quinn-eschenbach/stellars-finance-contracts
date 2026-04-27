import { getNetworkConfig, type ContractInfo, type Network } from "@stellars/config";

export interface KeeperConfig {
  databaseUrl: string;
  network: Network;
  rpcUrl: string;
  networkPassphrase: string;
  keeperSecret: string;
  pollIntervalMs: number;
  indexUpdateThresholdSec: number;
  contracts: {
    positionManager: ContractInfo;
  };
}

export function loadConfig(): KeeperConfig {
  const network = (process.env.NETWORK ?? "local") as Network;
  const networkConfig = getNetworkConfig(network);

  const keeperSecret = process.env.KEEPER_SECRET ?? "";
  if (!keeperSecret) {
    throw new Error("KEEPER_SECRET environment variable is required");
  }

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  return {
    databaseUrl,
    network,
    rpcUrl: networkConfig.rpcUrl,
    networkPassphrase: networkConfig.networkPassphrase,
    keeperSecret,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 5000),
    indexUpdateThresholdSec: Number(process.env.INDEX_UPDATE_THRESHOLD_SEC ?? 60),
    contracts: {
      positionManager: networkConfig.contracts.positionManager,
    },
  };
}

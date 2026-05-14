import {
  getNetworkConfig,
  type ContractInfo,
  type Network,
} from "@stellars/config";

export interface KeeperConfig {
  databaseUrl: string;
  network: Network;
  rpcUrl: string;
  networkPassphrase: string;
  keeperSecret: string;
  /** Cold loop cadence (indices, TP/SL, ADL). */
  pollIntervalMs: number;
  /** Hot loop sleep when no liquidation candidates were found. */
  liquidationIdleMs: number;
  indexUpdateThresholdSec: number;
  liquidationSafetyMarginBps: number;
  /** Indexer lag (seconds) at which we log a degraded-mode warning. */
  staleAlertSec: number;
  /** Indexer lag (seconds) at which both loops skip the tick entirely. */
  staleHardSkipSec: number;
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
  // Refuse to start in production unless the operator opted in to a
  // plaintext-env-injected seed (the expected mainnet path is a secrets
  // manager + sidecar-derived signer, not static env).
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PLAINTEXT_KEY !== "1") {
    throw new Error(
      "KEEPER_SECRET: plaintext seed in NODE_ENV=production requires ALLOW_PLAINTEXT_KEY=1",
    );
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
    liquidationIdleMs: Number(process.env.LIQUIDATION_IDLE_MS ?? 500),
    indexUpdateThresholdSec: Number(process.env.INDEX_UPDATE_THRESHOLD_SEC ?? 60),
    liquidationSafetyMarginBps: Number(process.env.LIQUIDATION_SAFETY_MARGIN_BPS ?? 200),
    staleAlertSec: Number(process.env.STALE_ALERT_SEC ?? 30),
    staleHardSkipSec: Number(process.env.STALE_HARD_SKIP_SEC ?? 300),
    contracts: {
      positionManager: networkConfig.contracts.positionManager,
    },
  };
}

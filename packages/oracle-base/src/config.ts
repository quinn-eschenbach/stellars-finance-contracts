import { getNetworkConfig, type Network } from "@stellars/config";

/** Resolved network + identity context shared across all oracle implementations. */
export interface OracleEnv {
  network: Network;
  rpcUrl: string;
  networkPassphrase: string;
  oracleSecret: string;
  /** Deployed address of *this* source's oracle contract instance. */
  oracleContract: string;
}

/**
 * Load common environment variables. The contract address comes from the
 * caller (each source reads its own slot from addresses.json) so this stays
 * source-agnostic.
 */
export function loadOracleEnv(args: { secretEnv: string; oracleContract: string }): OracleEnv {
  const network = (process.env.NETWORK ?? "local") as Network;
  const networkConfig = getNetworkConfig(network);

  const oracleSecret = process.env[args.secretEnv] ?? "";
  if (!oracleSecret) {
    throw new Error(`${args.secretEnv} environment variable is required`);
  }
  if (!args.oracleContract) {
    throw new Error(
      "oracle contract address is empty — run scripts/deploy-cex-oracles.sh first",
    );
  }

  return {
    network,
    rpcUrl: networkConfig.rpcUrl,
    networkPassphrase: networkConfig.networkPassphrase,
    oracleSecret,
    oracleContract: args.oracleContract,
  };
}

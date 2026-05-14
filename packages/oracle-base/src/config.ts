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
  // Refuse to start in production unless the operator explicitly opts in
  // to plaintext secret material. The expected path is a secrets manager
  // (Infisical, KMS, Vault Transit) injecting the value, NOT a static .env.
  // ALLOW_PLAINTEXT_KEY=1 documents that the operator knows the risk.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PLAINTEXT_KEY !== "1") {
    throw new Error(
      `${args.secretEnv}: plaintext seed in NODE_ENV=production requires ALLOW_PLAINTEXT_KEY=1`,
    );
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

/**
 * Best-effort wipe of a string in place. JS strings are immutable in the
 * language model — this is purely defensive cleanup of an env-var derived
 * value where we want to drop the reference and trim retained heap. The
 * real defense is the secrets-manager + KMS path; this function only stops
 * us from leaking the secret via a stale `OracleEnv` long-lived reference.
 */
export function scrubOracleEnv(env: OracleEnv): void {
  // Replace the string with an empty one so subsequent reads see nothing.
  (env as { oracleSecret: string }).oracleSecret = "";
}

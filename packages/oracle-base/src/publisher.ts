import { Client as OracleClient } from "@stellars/bindings/oracle";
import { client } from "@stellars/protocol-clients";
import { keypairSigner } from "@stellars/protocol-clients/node";
import { PRECISION as CONFIG_PRECISION } from "@stellars/config";
import { scrubOracleEnv, type OracleEnv } from "./config.js";

/** Contract-side fixed-point scaling: prices stored as i128 = floor(usd * 1e7). */
export const PRECISION = CONFIG_PRECISION;

export interface OraclePublisher {
  publicKey: string;
  /** Push a price (already scaled to 1e7) for `symbol` on-chain. */
  setPrice(symbol: string, scaledPrice: bigint): Promise<void>;
}

export function createPublisher(env: OracleEnv): OraclePublisher {
  const signer = keypairSigner(env.oracleSecret, env.networkPassphrase);
  // Scrub the seed from the long-lived OracleEnv object now that the
  // Keypair-bearing signer has been derived. Subsequent heap dumps,
  // serialisation of `env`, or accidental console.log(env) will not leak it.
  scrubOracleEnv(env);
  const oracleClient = client(
    OracleClient,
    { rpcUrl: env.rpcUrl, networkPassphrase: env.networkPassphrase },
    env.oracleContract,
    signer,
  );

  return {
    publicKey: signer.publicKey,
    async setPrice(symbol, scaledPrice) {
      const tx = await oracleClient.set_price({
        caller: signer.publicKey,
        symbol,
        price: scaledPrice,
      });
      await tx.signAndSend();
    },
  };
}

/** Convert a USD float price (e.g. 65_432.10) to the contract's i128 form. */
export function scaleUsd(priceUsd: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error(`scaleUsd: refusing to publish non-positive price ${priceUsd}`);
  }
  // Multiply in float then floor — fine for prices well under 2^53/1e7 (~9e8 USD).
  return BigInt(Math.floor(priceUsd * 10_000_000));
}

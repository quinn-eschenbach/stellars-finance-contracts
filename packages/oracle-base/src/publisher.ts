import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as OracleClient } from "@stellars/bindings/oracle";
import type { OracleEnv } from "./config.js";

/** Contract-side fixed-point scaling: prices stored as i128 = floor(usd * 1e7). */
export const PRECISION = 10_000_000n;

export interface OraclePublisher {
  publicKey: string;
  /** Push a price (already scaled to 1e7) for `symbol` on-chain. */
  setPrice(symbol: string, scaledPrice: bigint): Promise<void>;
}

export function createPublisher(env: OracleEnv): OraclePublisher {
  const kp = Keypair.fromSecret(env.oracleSecret);
  const publicKey = kp.publicKey();
  const { signTransaction, signAuthEntry } = basicNodeSigner(kp, env.networkPassphrase);

  const client = new OracleClient({
    contractId: env.oracleContract,
    networkPassphrase: env.networkPassphrase,
    rpcUrl: env.rpcUrl,
    publicKey,
    signTransaction,
    signAuthEntry,
    allowHttp: env.rpcUrl.startsWith("http://"),
  });

  return {
    publicKey,
    async setPrice(symbol, scaledPrice) {
      const tx = await client.set_price({
        caller: publicKey,
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

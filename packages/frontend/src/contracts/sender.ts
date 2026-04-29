import { rpc, TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "@/lib/constants";

/**
 * Submit a Soroban contract call signed by the connected wallet.
 *
 * Flow:
 *   1. Caller invokes a binding's `await client.method(args)` with
 *      `publicKey` set to the wallet address. The binding builds and
 *      simulates the tx.
 *   2. We pass the resulting AssembledTransaction to `signAndSendWithWallet`.
 *   3. We extract the unsigned XDR, hand to the wallet for signing,
 *      replace the tx with the signed version, and submit via the RPC.
 *   4. Poll for inclusion; throw on FAILED.
 *
 * Bindings auto-pad simulation results, but we add a small CPU+IO margin
 * because mainnet sees the same sim-vs-execute drift we hit in local sims.
 */

interface SignFn {
  (xdr: string, networkPassphrase: string): Promise<string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function signAndSendWithWallet(tx: any, sign: SignFn): Promise<{ status: string; hash: string }> {
  // Pull the unsigned XDR from the AssembledTransaction.
  const built = tx.built;
  if (!built) throw new Error("transaction has not been simulated");

  const unsignedXdr = built.toXDR();
  const signedXdr = await sign(unsignedXdr, NETWORK_PASSPHRASE);

  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResp = await server.sendTransaction(signedTx);
  if (sendResp.status !== "PENDING") {
    throw new Error(`send failed: ${sendResp.status} ${JSON.stringify(sendResp.errorResult ?? {})}`);
  }

  // Poll for completion. Soroban ledger close ~5–6s; allow up to 30s.
  const hash = sendResp.hash;
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = await server.getTransaction(hash);
    if (got.status === "SUCCESS") return { status: "SUCCESS", hash };
    if (got.status === "FAILED") {
      throw new Error(`tx failed on-chain: ${hash}`);
    }
  }
  throw new Error(`tx still pending after 30s: ${hash}`);
}

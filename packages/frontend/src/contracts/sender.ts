import { rpc, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "@/lib/constants";
import {
  extractContractErrorFromTxMeta,
  parseContractError,
  type SubmitErrorDetails,
  txResultCodeToMessage,
} from "@/lib/contract-errors";

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
 *   4. Poll for inclusion; throw `SubmitError` (with parsed details) on
 *      either rejection (txMalformed, txInsufficientBalance, …) or
 *      on-chain failure (extracts the contract error code if present).
 */

interface SignFn {
  (xdr: string, networkPassphrase: string): Promise<string>;
}

/**
 * Carries structured error details up from `sendTransaction` / `getTransaction`
 * so the toast layer can render a clean message without scraping the raw XDR.
 */
export class SubmitError extends Error {
  details: SubmitErrorDetails;
  constructor(details: SubmitErrorDetails) {
    super(details.message);
    this.name = "SubmitError";
    this.details = details;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function signAndSendWithWallet(tx: any, sign: SignFn): Promise<{ status: string; hash: string }> {
  // If simulation failed, the binding leaves `simulation.error` set and
  // `built` reverts to the pre-assembly tx without a Soroban footprint —
  // submitting it would just earn us a `txMalformed` rejection. Extract
  // the contract error from the sim message instead so the toast can show
  // the real reason (cooldown, utilization cap, etc.).
  const simError = tx?.simulation?.error;
  if (simError) {
    throw new SubmitError(parseSimError(String(simError)));
  }

  const built = tx.built;
  if (!built) throw new Error("transaction has not been simulated");

  const unsignedXdr = built.toXDR();
  const signedXdr = await sign(unsignedXdr, NETWORK_PASSPHRASE);

  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResp = await server.sendTransaction(signedTx);
  if (sendResp.status !== "PENDING") {
    throw new SubmitError(parseSendError(sendResp));
  }

  const hash = sendResp.hash;
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = await server.getTransaction(hash);
    if (got.status === "SUCCESS") return { status: "SUCCESS", hash };
    if (got.status === "FAILED") {
      throw new SubmitError(parseGetError(got, hash));
    }
  }
  throw new SubmitError({ message: `Transaction still pending after 30s: ${hash}`, kind: "timeout" });
}

/**
 * Build a clean message from a non-PENDING `sendTransaction` response. The
 * RPC's TX_BAD_RESULT path attaches an `errorResult` (xdr.TransactionResult)
 * whose `result.switch()` gives a named code like `txMalformed`.
 */
function parseSendError(resp: rpc.Api.SendTransactionResponse): SubmitErrorDetails {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorResult = (resp as any).errorResult as xdr.TransactionResult | undefined;

  if (errorResult) {
    try {
      const result = errorResult.result();
      const codeName = result.switch().name;
      const friendly = txResultCodeToMessage(codeName);
      return {
        message: friendly ?? `Transaction rejected (${codeName}).`,
        kind: "tx-level",
        code: codeName,
      };
    } catch {
      // fall through to generic
    }
  }
  return {
    message: `Submission failed (${resp.status}).`,
    kind: "tx-level",
    code: resp.status,
  };
}

/**
 * Pull a useful failure reason out of a FAILED `getTransaction` response.
 * Soroban surfaces contract-level errors in two places:
 *  - the result XDR's invokeHostFunctionResult code (e.g. trapped vs malformed)
 *  - the diagnostic events embedded in the result meta (the actual
 *    `Error(Contract, #N)` from the contract).
 */
function parseGetError(got: rpc.Api.GetFailedTransactionResponse, hash: string): SubmitErrorDetails {
  const contractError = extractContractErrorFromTxMeta(got);
  if (contractError) {
    return {
      message: contractError.message,
      kind: "contract",
      contract: contractError.contract,
      code: contractError.name ?? `#${contractError.code}`,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opCode = inferInvokeHostFunctionCode(got as any);
  if (opCode) {
    return {
      message: `Contract execution failed (${opCode}).`,
      kind: "host-function",
      code: opCode,
    };
  }
  return { message: `Transaction failed on-chain: ${hash}`, kind: "tx-level" };
}

function parseSimError(simErrorText: string): SubmitErrorDetails {
  const parsed = parseContractError(simErrorText);
  if (parsed) {
    return {
      message: parsed.message,
      kind: "contract",
      contract: parsed.contract,
      code: parsed.name ?? (parsed.code != null ? `#${parsed.code}` : undefined),
    };
  }
  return {
    message: `Simulation failed: ${simErrorText.slice(0, 240)}`,
    kind: "host-function",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inferInvokeHostFunctionCode(got: any): string | null {
  try {
    const result = got.resultXdr?.result?.() ?? got.result;
    const op = result?.results?.()?.[0];
    const tr = op?.tr?.();
    const ihf = tr?.invokeHostFunctionResult?.();
    return ihf?.switch?.()?.name ?? null;
  } catch {
    return null;
  }
}

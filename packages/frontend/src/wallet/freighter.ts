import {
  isConnected,
  isAllowed,
  setAllowed,
  getAddress,
  getNetwork,
  signTransaction,
  signAuthEntry,
} from "@stellar/freighter-api";

/**
 * Thin wrapper around the Freighter API. Each call returns a structured
 * result so callers can branch on availability/auth state without try/catch
 * around expected "not installed" / "not allowed" flows.
 */

export type FreighterStatus =
  | { kind: "missing" }
  | { kind: "locked" }
  | { kind: "ok"; address: string; network: string; passphrase: string };

export async function getFreighterStatus(): Promise<FreighterStatus> {
  const installed = await isConnected();
  if (!installed.isConnected) return { kind: "missing" };

  const allowed = await isAllowed();
  if (!allowed.isAllowed) return { kind: "locked" };

  const [addr, net] = await Promise.all([getAddress(), getNetwork()]);
  if (addr.error || net.error) return { kind: "locked" };
  return {
    kind: "ok",
    address: addr.address,
    network: net.network,
    passphrase: net.networkPassphrase,
  };
}

export async function requestFreighterPermission(): Promise<void> {
  const result = await setAllowed();
  if (!result.isAllowed) {
    throw new Error("Freighter permission denied");
  }
}

/**
 * Sign a transaction XDR string using Freighter. The user-side Stellar SDK
 * builds the unsigned tx, we hand off to the wallet, and the wallet returns
 * a signed XDR that we submit via @stellar/stellar-sdk's `Server.sendTransaction`.
 */
export async function signTx(xdr: string, networkPassphrase: string): Promise<string> {
  const result = await signTransaction(xdr, { networkPassphrase });
  if (result.error) throw new Error(result.error.message ?? "sign failed");
  return result.signedTxXdr;
}

export async function signAuth(
  entryXdr: string,
  networkPassphrase: string,
  address: string,
): Promise<string> {
  const result = await signAuthEntry(entryXdr, { networkPassphrase, address });
  if (result.error) throw new Error(result.error.message ?? "sign auth failed");
  if (!result.signedAuthEntry) throw new Error("freighter returned empty signed auth entry");
  return Buffer.from(result.signedAuthEntry).toString("base64");
}

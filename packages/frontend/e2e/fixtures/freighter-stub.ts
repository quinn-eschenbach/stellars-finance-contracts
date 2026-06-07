/**
 * E2E stub for `@/wallet/freighter`. Wired in by the Vite alias in
 * `vite.config.ts` when `VITE_E2E=1`, so the app imports the same module
 * shape it would in production — same four exports, same `FreighterStatus`
 * union — but backed by canned state instead of the Freighter extension.
 *
 * Tests seed initial state via `addInitScript`, which writes
 * `window.__walletStubPreset` before any page script runs. This module
 * reads that preset on first import, then exposes setters on
 * `window.__walletStub` so tests can flip state mid-flow (e.g. simulate
 * the user unlocking the wallet) without reloading.
 */

export type FreighterStatus =
  | { kind: "missing" }
  | { kind: "locked" }
  | { kind: "ok"; address: string; network: string; passphrase: string };

interface PendingConnection {
  address: string;
  network: string;
  passphrase: string;
}

interface StubState {
  status: FreighterStatus;
  /**
   * When `status.kind === "locked"`, this is what permission grant resolves
   * to. Mirrors real Freighter, where the account is selected before the
   * user grants site permission.
   */
  pendingConnection: PendingConnection | null;
  /** When set, signTx/signAuth reject with this message. */
  signError: string | null;
  signedTxLog: Array<{ xdr: string; networkPassphrase: string }>;
  signedAuthLog: Array<{ entry: string; networkPassphrase: string; address: string }>;
}

declare global {
  interface Window {
    __walletStubPreset?: {
      status?: FreighterStatus;
      pendingConnection?: PendingConnection | null;
    };
    __walletStub?: {
      setStatus: (s: FreighterStatus) => void;
      setPendingConnection: (c: PendingConnection | null) => void;
      setSignError: (msg: string | null) => void;
      getSignedTxLog: () => StubState["signedTxLog"];
      getSignedAuthLog: () => StubState["signedAuthLog"];
    };
  }
}

const state: StubState = {
  status: { kind: "missing" },
  pendingConnection: null,
  signError: null,
  signedTxLog: [],
  signedAuthLog: [],
};

if (typeof window !== "undefined") {
  const preset = window.__walletStubPreset;
  if (preset?.status) state.status = preset.status;
  if (preset?.pendingConnection !== undefined) state.pendingConnection = preset.pendingConnection;
  window.__walletStub = {
    setStatus: (s) => {
      state.status = s;
    },
    setPendingConnection: (c) => {
      state.pendingConnection = c;
    },
    setSignError: (msg) => {
      state.signError = msg;
    },
    getSignedTxLog: () => state.signedTxLog,
    getSignedAuthLog: () => state.signedAuthLog,
  };
}

export async function getFreighterStatus(): Promise<FreighterStatus> {
  return state.status;
}

export async function requestFreighterPermission(): Promise<void> {
  if (state.status.kind === "missing") {
    throw new Error("Freighter permission denied");
  }
  if (state.status.kind === "locked") {
    const c = state.pendingConnection;
    if (!c) throw new Error("Freighter permission denied");
    state.status = { kind: "ok", address: c.address, network: c.network, passphrase: c.passphrase };
  }
}

export async function signTx(xdr: string, networkPassphrase: string): Promise<string> {
  state.signedTxLog.push({ xdr, networkPassphrase });
  if (state.signError) throw new Error(state.signError);
  return xdr;
}

export async function signAuth(
  entryXdr: string,
  networkPassphrase: string,
  address: string,
): Promise<string> {
  state.signedAuthLog.push({ entry: entryXdr, networkPassphrase, address });
  if (state.signError) throw new Error(state.signError);
  return Buffer.from(entryXdr, "utf8").toString("base64");
}

export async function disconnect(): Promise<void> {
  state.status = { kind: "locked" };
}

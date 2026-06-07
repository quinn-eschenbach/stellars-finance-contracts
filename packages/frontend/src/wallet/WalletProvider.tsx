import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  disconnect as walletDisconnect,
  getFreighterStatus,
  requestFreighterPermission,
  signTx,
  signAuth,
  type FreighterStatus,
} from "@/wallet/freighter";

interface WalletContextValue {
  status: FreighterStatus;
  /** False until the first wallet-status probe resolves — gate logon UI on this. */
  ready: boolean;
  refreshing: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
  signAuthEntry: (entry: string, networkPassphrase: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const POLL_INTERVAL_MS = 3000;

function sameStatus(a: FreighterStatus, b: FreighterStatus): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "ok" && b.kind === "ok") {
    return a.address === b.address && a.passphrase === b.passphrase;
  }
  return true;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FreighterStatus>({ kind: "missing" });
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await getFreighterStatus();
      // Skip the state update when nothing changed — keeps react-query from
      // re-running address-keyed queries on every poll tick.
      setStatus((prev) => (sameStatus(prev, next) ? prev : next));
    } finally {
      setRefreshing(false);
      setReady(true);
    }
  }, []);

  const connect = useCallback(async () => {
    await requestFreighterPermission();
    await refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    await walletDisconnect();
    await refresh();
  }, [refresh]);

  // Poll the wallet adapter while the tab is visible so an in-extension
  // account or network switch reflects in the app within ~3s. Freighter
  // doesn't fire DOM events on account change, and the Wallets Kit doesn't
  // expose a subscription, so polling is the only generic path. Pause when
  // the tab is hidden to avoid background churn.
  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer != null) return;
      timer = setInterval(refresh, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer == null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const value = useMemo<WalletContextValue>(
    () => ({
      status,
      ready,
      refreshing,
      connect,
      disconnect,
      refresh,
      signTransaction: (xdr, np) => {
        if (status.kind !== "ok") throw new Error("wallet not connected");
        return signTx(xdr, np);
      },
      signAuthEntry: (entry, np) => {
        if (status.kind !== "ok") throw new Error("wallet not connected");
        return signAuth(entry, np, status.address);
      },
    }),
    [status, ready, refreshing, connect, disconnect, refresh],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

/** Convenience: returns the connected address or null. */
export function useAddress(): string | null {
  const { status } = useWallet();
  return status.kind === "ok" ? status.address : null;
}

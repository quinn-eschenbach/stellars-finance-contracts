import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getFreighterStatus,
  requestFreighterPermission,
  signTx,
  signAuth,
  type FreighterStatus,
} from "@/wallet/freighter";

interface WalletContextValue {
  status: FreighterStatus;
  refreshing: boolean;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
  signAuthEntry: (entry: string, networkPassphrase: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FreighterStatus>({ kind: "missing" });
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setStatus(await getFreighterStatus());
    } finally {
      setRefreshing(false);
    }
  }, []);

  const connect = useCallback(async () => {
    await requestFreighterPermission();
    await refresh();
  }, [refresh]);

  // On mount, check status. Re-poll when window regains focus (covers the
  // "user installed/unlocked extension in another tab" case).
  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const value = useMemo<WalletContextValue>(
    () => ({
      status,
      refreshing,
      connect,
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
    [status, refreshing, connect, refresh],
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

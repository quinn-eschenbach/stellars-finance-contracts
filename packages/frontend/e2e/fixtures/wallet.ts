import type { Page } from "@playwright/test";

/**
 * Seed the wallet stub before any page script runs. The aliased
 * `@/wallet/freighter` module (see `vite.config.ts` + `freighter-stub.ts`)
 * reads `window.__walletStubPreset` on import, so whatever we set here is
 * what `WalletProvider`'s mount-time `getFreighterStatus()` returns.
 *
 * Post-mount control is available via `window.__walletStub` setters; helpers
 * below wrap the common ones so tests don't have to reach in by hand.
 */

export type WalletState = "missing" | "locked" | "connected";

export interface ConnectedWallet {
  address: string;
  network: string;
  networkPassphrase: string;
}

const DEFAULT_WALLET: ConnectedWallet = {
  address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  network: "STANDALONE",
  networkPassphrase: "Standalone Network ; February 2017",
};

export async function setWalletState(
  page: Page,
  state: WalletState,
  wallet: Partial<ConnectedWallet> = {},
) {
  const w = { ...DEFAULT_WALLET, ...wallet };
  await page.addInitScript(
    ({ state, w }) => {
      const status =
        state === "missing"
          ? { kind: "missing" as const }
          : state === "locked"
            ? { kind: "locked" as const }
            : { kind: "ok" as const, address: w.address, network: w.network, passphrase: w.networkPassphrase };
      const pending =
        state === "locked"
          ? { address: w.address, network: w.network, passphrase: w.networkPassphrase }
          : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__walletStubPreset = { status, pendingConnection: pending };
    },
    { state, w },
  );
}

/** Pull the in-page log of signed tx attempts. Useful after triggering a flow. */
export async function readSignedTxLog(page: Page) {
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__walletStub?.getSignedTxLog?.() ?? [],
  );
}

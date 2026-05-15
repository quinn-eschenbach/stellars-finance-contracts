/**
 * Wallet wrapper — initially Freighter-only, now backed by Stellar Wallets
 * Kit so the app supports Freighter, xBull, Albedo, LOBSTR, Hana,
 * WalletConnect, and Rabet through a single modal.
 *
 * The exported names (`getFreighterStatus`, `requestFreighterPermission`,
 * `signTx`, `signAuth`) are preserved for compatibility with the existing
 * `WalletProvider` and the `VITE_E2E` Vite alias that swaps this module
 * for `e2e/fixtures/freighter-stub.ts`. Treat "Freighter" in those names
 * as a historical reference to "the wallet adapter," not the specific
 * extension.
 */

import {
  StellarWalletsKit,
  type ModuleInterface,
} from "@creit.tech/stellar-wallets-kit";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { NETWORK_PASSPHRASE } from "@/lib/constants";

export type FreighterStatus =
  | { kind: "missing" }
  | { kind: "locked" }
  | { kind: "ok"; address: string; network: string; passphrase: string };

const NETWORK_LABEL_BY_PASSPHRASE: Record<string, string> = {
  [Networks.PUBLIC]: "PUBLIC",
  [Networks.TESTNET]: "TESTNET",
  [Networks.FUTURENET]: "FUTURENET",
  [Networks.SANDBOX]: "SANDBOX",
  [Networks.STANDALONE]: "STANDALONE",
};

const STORED_WALLET_KEY = "stellars.wallet.selectedId";

let initialized = false;

function networkFromPassphrase(passphrase: string): Networks {
  // The Kit's Networks enum values *are* the passphrases, so the project
  // passphrase round-trips cleanly. Fall through to STANDALONE for the
  // local sandbox / unknown nets we develop against.
  const known = Object.values(Networks) as string[];
  return (known.includes(passphrase) ? passphrase : Networks.STANDALONE) as Networks;
}

function buildModules(): ModuleInterface[] {
  // Keep the module list focused on extension/web wallets that the average
  // user can install in 30 seconds. Hardware (Trezor, Ledger) and Wallet
  // Connect modules ship in the kit but pull heavy transitive deps, so
  // we leave them out until there's user demand.
  return [
    new FreighterModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
    new HanaModule(),
    new RabetModule(),
  ];
}

function ensureInit(): void {
  if (initialized || typeof window === "undefined") return;
  StellarWalletsKit.init({
    modules: buildModules(),
    network: networkFromPassphrase(NETWORK_PASSPHRASE),
    selectedWalletId: window.localStorage.getItem(STORED_WALLET_KEY) ?? undefined,
  });
  initialized = true;
}

/**
 * Resolve the current wallet state. "missing" now means "no wallet
 * connected" — the multi-wallet kit no longer distinguishes "extension
 * not installed" from "user hasn't picked one yet". The auth modal
 * surfaces install links for unavailable wallets when the user opens it.
 */
export async function getFreighterStatus(): Promise<FreighterStatus> {
  if (typeof window === "undefined") return { kind: "missing" };
  ensureInit();

  const stored = window.localStorage.getItem(STORED_WALLET_KEY);
  if (!stored) return { kind: "missing" };

  try {
    StellarWalletsKit.setWallet(stored);
    const { address } = await StellarWalletsKit.getAddress();
    if (!address) return { kind: "missing" };
    const { networkPassphrase } = await StellarWalletsKit.getNetwork();
    return {
      kind: "ok",
      address,
      network: NETWORK_LABEL_BY_PASSPHRASE[networkPassphrase] ?? "UNKNOWN",
      passphrase: networkPassphrase,
    };
  } catch {
    // Stored wallet became unavailable (extension uninstalled, locked,
    // etc.). Treat as disconnected so the UI prompts a reconnect.
    return { kind: "missing" };
  }
}

/**
 * Open the kit's auth modal. The user picks a wallet; on success we cache
 * the selection so subsequent `getFreighterStatus` calls return "ok"
 * without re-prompting. The kit resolves with the chosen address — we
 * round-trip through `selectedModule.productId` to know which wallet won
 * so we can store it for next session.
 */
export async function requestFreighterPermission(): Promise<void> {
  ensureInit();
  const { address } = await StellarWalletsKit.authModal();
  if (!address) throw new Error("wallet connection cancelled");
  const walletId = StellarWalletsKit.selectedModule?.productId;
  if (walletId) {
    window.localStorage.setItem(STORED_WALLET_KEY, walletId);
  }
}

export async function signTx(xdr: string, networkPassphrase: string): Promise<string> {
  ensureInit();
  const result = await StellarWalletsKit.signTransaction(xdr, { networkPassphrase });
  return result.signedTxXdr;
}

export async function signAuth(
  entryXdr: string,
  networkPassphrase: string,
  address: string,
): Promise<string> {
  ensureInit();
  const result = await StellarWalletsKit.signAuthEntry(entryXdr, {
    networkPassphrase,
    address,
  });
  // Some modules return a base64 string already, others return raw bytes.
  // Normalise to base64 so the contract submission path doesn't have to
  // branch on wallet provider.
  const signed = result.signedAuthEntry as string | Uint8Array;
  if (typeof signed === "string") return signed;
  return Buffer.from(signed).toString("base64");
}

/** Clear the stored wallet selection — used by an explicit disconnect action. */
export async function disconnect(): Promise<void> {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORED_WALLET_KEY);
  ensureInit();
  await StellarWalletsKit.disconnect().catch(() => {});
}

import type { ComponentType } from "react";
import { FaucetApp } from "@/apps/FaucetApp";
import { LeaderboardApp } from "@/apps/LeaderboardApp";
import { ProfileApp } from "@/apps/ProfileApp";
import { TradeApp } from "@/apps/TradeApp";
import { VaultApp } from "@/apps/VaultApp";
import { useMarkets } from "@/api/hooks";
import { useWallet } from "@/wallet/WalletProvider";
import { shortAddress } from "@/lib/utils";
import { ICONS } from "./icons";
import { windowId, type AppKind } from "./wm";

export interface AppDefinition {
  /** Window title; `param` is the market symbol / trader address. */
  title: (param?: string) => string;
  /** Static launcher label (Start menu, desktop icon). */
  label: string;
  icon: string;
  component: ComponentType<{ param?: string }>;
  /** When the app shows on launcher surfaces. Trade is dynamic — see useLauncherItems. */
  launcher: "always" | "connected" | "none";
}

export const APPS: Record<AppKind, AppDefinition> = {
  trade: {
    title: (param) => `${param ?? "?"} — Trade`,
    label: "Trade",
    icon: ICONS.chart,
    component: TradeApp,
    launcher: "none",
  },
  vault: {
    title: () => "Vault",
    label: "Vault",
    icon: ICONS.vault,
    component: VaultApp,
    launcher: "always",
  },
  leaderboard: {
    title: () => "Leaderboard",
    label: "Leaderboard",
    icon: ICONS.star,
    component: LeaderboardApp,
    launcher: "always",
  },
  profile: {
    title: (param) => (param ? `Positions — ${shortAddress(param)}` : "My Positions"),
    label: "My Positions",
    icon: ICONS.user,
    component: ProfileApp,
    launcher: "connected",
  },
  faucet: {
    title: () => "Faucet",
    label: "Faucet",
    icon: ICONS.faucet,
    component: FaucetApp,
    launcher: "always",
  },
};

/** Launcher ordering — markets render first on every surface, then these. */
const LAUNCHER_ORDER: ReadonlyArray<AppKind> = ["vault", "leaderboard", "profile", "faucet"];

export interface LauncherItem {
  id: string;
  kind: AppKind;
  param?: string;
  label: string;
  icon: string;
}

/**
 * The one source for everything that can launch a window: a dynamic trade
 * item per market plus the static apps, gated by wallet state. Start menu
 * and desktop icons both derive from this, so they can't drift.
 */
export function useLauncherItems(): {
  markets: LauncherItem[];
  apps: LauncherItem[];
  marketsLoading: boolean;
} {
  const markets = useMarkets();
  const { status } = useWallet();
  const connected = status.kind === "ok";

  return {
    markets: (markets.data ?? []).map((m) => ({
      id: windowId("trade", m.symbol),
      kind: "trade" as const,
      param: m.symbol,
      label: m.symbol,
      icon: APPS.trade.icon,
    })),
    apps: LAUNCHER_ORDER.filter(
      (kind) => APPS[kind].launcher === "always" || (APPS[kind].launcher === "connected" && connected),
    ).map((kind) => ({
      id: windowId(kind),
      kind,
      label: APPS[kind].label,
      icon: APPS[kind].icon,
    })),
    marketsLoading: markets.isLoading,
  };
}

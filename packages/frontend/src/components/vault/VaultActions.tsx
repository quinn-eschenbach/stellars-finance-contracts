import { useEffect, useState } from "react";
import { Frame } from "react95";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { LogOnPrompt } from "@/desktop/Logon";
import { Label } from "@/components/ui/label";
import { NumberFlowUsd, NumberFlowPlain } from "@/components/ui/number-flow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAddress } from "@/wallet/WalletProvider";
import { vault } from "@/contracts/clients";
import { useTxMutation } from "@/contracts/useTxMutation";
import { formatUsdc, numberToAmount, parseUsdc, cn } from "@/lib/utils";
import {
  queryKeys,
  useLockup,
  useVault,
  useVaultShareBalance,
  useWalletBalance,
} from "@/api/hooks";

/**
 * Deposit + withdraw forms for the vault. Both use the OZ FungibleVault
 * methods; deposit pulls USDC from the user's wallet via Soroban auth
 * propagation (no separate approve step needed — the connected wallet
 * signs the outer tx and the inner token.transfer auth comes along).
 */
export function VaultActions() {
  const address = useAddress();
  const usdcBalance = useWalletBalance(address);
  const lockup = useLockup(address);
  const vaultState = useVault();
  const shareBalance = useVaultShareBalance(address);

  // Amounts as plain numbers — 0 means empty. NumberInput is number-valued.
  const [depositAmt, setDepositAmt] = useState(0);
  const [withdrawAmt, setWithdrawAmt] = useState(0);

  // Share-of-pool computed against the LP-fair basis (`free + reserved`) — NOT
  // raw `total_assets`. The contract's `total_assets` carries non-LP claims
  // (unclaimed dev/staker fees + open-trader-PnL liability), so OZ's
  // `convert_to_assets` over-prices shares relative to what LPs actually own
  // collectively. Using `lpTotal` here keeps the sum across all LPs equal to
  // the LP-claimable pool. The vault page is the realized-basis view; MTM
  // signals live on the leaderboard and positions routes.
  const userShares = shareBalance.data ?? 0n;
  const totalShares = vaultState.data ? BigInt(vaultState.data.total_shares) : 0n;
  const freeLiquidity = vaultState.data ? BigInt(vaultState.data.free_liquidity) : 0n;
  const reservedUsdc = vaultState.data ? BigInt(vaultState.data.reserved_usdc) : 0n;
  const lpTotal = freeLiquidity + reservedUsdc;
  const userValueUsdc =
    totalShares > 0n ? (userShares * lpTotal) / totalShares : 0n;
  const maxWithdrawUsdc =
    userValueUsdc < freeLiquidity ? userValueUsdc : freeLiquidity;
  const canPickPercent = userShares > 0n && maxWithdrawUsdc > 0n;

  // Count down once per second while there's an active lockup. The hook idles
  // (no interval running) outside that window, so the page is quiet for users
  // who can already withdraw.
  const lockupExpiry = lockup.data ?? 0;
  const secondsLeft = useCountdownSeconds(lockupExpiry);
  const isLocked = secondsLeft > 0;

  const vaultInvalidations = [
    queryKeys.walletBalance(address),
    queryKeys.lockup(address),
    queryKeys.vault,
    queryKeys.vaultShareBalance(address),
  ];

  // Translate a scaled USDC bigint back into the number the input uses.
  // formatUsdc returns "1,234.56" — strip commas before Number().
  const inputFromScaled = (scaled: bigint): number => {
    if (scaled <= 0n) return 0;
    return Number(formatUsdc(scaled, { decimals: 6 }).replace(/,/g, ""));
  };

  // Percent buttons fill the input with the LP-fair USDC value of `pct` of the
  // user's stake, clamped by free_liquidity. The submit path is uniformly
  // `withdraw(assets)` — no share-denominated branch — because the input value
  // is bounded above by the LP-fair total, which is strictly less than raw
  // `total_assets`, so OZ's ceil-rounded shares-to-burn is always ≤ userShares
  // (the prior dust-gap workaround was only needed against the inflated basis).
  const pickWithdrawPercent = (pct: number) => {
    if (!canPickPercent) return;
    const amount =
      pct >= 100 ? maxWithdrawUsdc : (maxWithdrawUsdc * BigInt(pct)) / 100n;
    setWithdrawAmt(inputFromScaled(amount));
  };

  const deposit = useTxMutation({
    action: "Deposit",
    successDetail: `${depositAmt} USDC added to the vault.`,
    invalidate: vaultInvalidations,
    build: async () => {
      if (!address) throw new Error("connect wallet first");
      const assets = parseUsdc(numberToAmount(depositAmt));
      if (assets <= 0n) throw new Error("enter a positive amount");
      return vault(address).deposit({
        assets,
        receiver: address,
        from: address,
        operator: address,
      });
    },
    onSuccess: () => setDepositAmt(0),
  });

  const withdraw = useTxMutation({
    action: "Withdraw",
    successDetail: `${withdrawAmt} USDC returned to your wallet.`,
    invalidate: vaultInvalidations,
    build: async () => {
      if (!address) throw new Error("connect wallet first");
      const assets = parseUsdc(numberToAmount(withdrawAmt));
      if (assets <= 0n) throw new Error("enter a positive amount");
      return vault(address).withdraw({
        assets,
        receiver: address,
        owner: address,
        operator: address,
      });
    },
    onSuccess: () => setWithdrawAmt(0),
  });

  if (!address) {
    return <LogOnPrompt message="Log on with a Stellar wallet to deposit." />;
  }

  return (
    <div className="space-y-4">
      <Frame variant="status" className="!flex w-full items-center justify-between !px-2 !py-1">
        <span className="text-xs">Wallet USDC</span>
        <span className="font-mono text-sm tabular-nums">
          {usdcBalance.data != null ? <NumberFlowUsd value={usdcBalance.data} /> : "—"}
        </span>
      </Frame>

      <Tabs defaultValue="deposit">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>

        <TabsContent value="deposit" className="space-y-3">
          <Label>Amount (USDC)</Label>
          <NumberInput value={depositAmt} onChange={setDepositAmt} min={0} step={100} width="100%" />
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={deposit.isPending || !depositAmt}
            onClick={() => deposit.mutate()}
          >
            {deposit.isPending ? "Submitting…" : "Deposit"}
          </Button>
        </TabsContent>

        <TabsContent value="withdraw" className="space-y-3">
          <CooldownNotice
            isLocked={isLocked}
            secondsLeft={secondsLeft}
            expiry={lockupExpiry}
            hasDeposit={lockupExpiry > 0}
          />
          <div className="flex items-center justify-between">
            <Label>Amount (USDC)</Label>
            {canPickPercent && (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                max <NumberFlowUsd value={maxWithdrawUsdc.toString()} />
              </span>
            )}
          </div>
          <NumberInput
            value={withdrawAmt}
            onChange={setWithdrawAmt}
            min={0}
            step={100}
            width="100%"
            disabled={isLocked}
          />
          {canPickPercent && (
            <div className="grid grid-cols-4 gap-1.5">
              {[25, 50, 75, 100].map((pct) => (
                <Button
                  key={pct}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isLocked}
                  onClick={() => pickWithdrawPercent(pct)}
                  className="h-8 font-mono text-[11px]"
                >
                  {pct === 100 ? "MAX" : `${pct}%`}
                </Button>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            disabled={withdraw.isPending || !withdrawAmt || isLocked}
            onClick={() => withdraw.mutate()}
          >
            {isLocked ? (
              <span className="inline-flex items-center gap-2">
                <span>Locked</span>
                <span className="text-muted-foreground/60">·</span>
                <Countdown seconds={secondsLeft} />
              </span>
            ) : withdraw.isPending ? (
              "Submitting…"
            ) : (
              "Withdraw"
            )}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Slim banner above the withdraw input. Three states:
 *  - no deposit yet → no banner (returns null)
 *  - locked → ember chip with countdown
 *  - unlocked → quiet bull confirmation that funds are free to move
 */
function CooldownNotice({
  isLocked,
  secondsLeft,
  expiry,
  hasDeposit,
}: {
  isLocked: boolean;
  secondsLeft: number;
  expiry: number;
  hasDeposit: boolean;
}) {
  if (!hasDeposit) return null;
  if (isLocked) {
    return (
      <Frame variant="well" className="!block w-full space-y-1 !px-2 !py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">LP cooldown</span>
          <Countdown seconds={secondsLeft} className="font-mono text-xs" />
        </div>
        <p className="text-xs leading-snug">
          Unlocks <span className="font-mono">{formatExpiry(expiry)}</span>. Cooldown protects
          the protocol from flash-loan-style LP exits.
        </p>
      </Frame>
    );
  }
  return (
    <Frame variant="well" className="!block w-full !px-2 !py-1.5">
      <span className="text-xs font-bold text-bull">Cooldown elapsed — free to withdraw</span>
    </Frame>
  );
}

/** Updates once per second while there's an active expiry; idle otherwise. */
function useCountdownSeconds(expiry: number): number {
  const compute = () => Math.max(0, expiry - Math.floor(Date.now() / 1000));
  const [secondsLeft, setSecondsLeft] = useState(compute);
  useEffect(() => {
    setSecondsLeft(compute());
    if (expiry === 0) return;
    if (compute() === 0) return; // already elapsed; no need to tick
    const id = window.setInterval(() => {
      const next = Math.max(0, expiry - Math.floor(Date.now() / 1000));
      setSecondsLeft(next);
      if (next === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
    // compute is intentionally redefined per render — fine, the effect resets too
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiry]);
  return secondsLeft;
}

/**
 * Animated countdown built from `NumberFlow` digits so each tick eases in
 * smoothly. Auto-picks units: `Ns` under a minute, `Mm Ss` under an hour,
 * `Hh Mm` under a day, `Dd Hh` beyond.
 */
function Countdown({ seconds, className }: { seconds: number; className?: string }) {
  const safe = Math.max(0, seconds);
  const cls = cn("tabular-nums", className);
  if (safe < 60) {
    return (
      <span className={cls}>
        <NumberFlowPlain value={safe} />s
      </span>
    );
  }
  if (safe < 3600) {
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return (
      <span className={cls}>
        <NumberFlowPlain value={m} />m <NumberFlowPlain value={s} />s
      </span>
    );
  }
  if (safe < 86400) {
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    return (
      <span className={cls}>
        <NumberFlowPlain value={h} />h <NumberFlowPlain value={m} />m
      </span>
    );
  }
  const d = Math.floor(safe / 86400);
  const h = Math.floor((safe % 86400) / 3600);
  return (
    <span className={cls}>
      <NumberFlowPlain value={d} />d <NumberFlowPlain value={h} />h
    </span>
  );
}

/**
 * Render an unlock time relative to "now":
 *   - same day (< 24h diff) → just `HH:MM` (24-hour)
 *   - else → `Mon DD · HH:MM`
 * 24-hour format because mixed AM/PM with bracketed dates reads awkwardly.
 */
function formatExpiry(unixSec: number): string {
  if (!unixSec) return "—";
  const expiry = new Date(unixSec * 1000);
  const now = new Date();
  const sameDay =
    expiry.getFullYear() === now.getFullYear() &&
    expiry.getMonth() === now.getMonth() &&
    expiry.getDate() === now.getDate();
  const time = expiry.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (sameDay) return `at ${time}`;
  const date = expiry.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date} · ${time}`;
}

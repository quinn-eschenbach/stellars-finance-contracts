import { useEffect, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberFlowUsd, NumberFlowPlain } from "@/components/ui/number-flow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAddress } from "@/wallet/WalletProvider";
import { vault } from "@/contracts/clients";
import { useTxMutation } from "@/contracts/useTxMutation";
import { formatUsdc, parseUsdc, cn } from "@/lib/utils";
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

  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  // When the user picks a %/MAX button, we record the exact share-count to
  // burn and route the tx through `redeem(shares)` instead of
  // `withdraw(assets)`. `redeem` uses OZ's `convert_to_assets` (rounds DOWN),
  // so a percentage-based exit never asks the chain for 1 more atom than the
  // user holds — the ERC-4626 dust pitfall that makes a typed "5000" fail
  // when shares actually map to `49,999,999,999` raw USDC. A manual edit to
  // the amount field clears the pinned shares, falling back to the
  // assets-based withdraw path.
  const [pinnedRedeemShares, setPinnedRedeemShares] = useState<bigint | null>(null);

  // Max the user could withdraw right now: their share-of-pool USDC equivalent,
  // clamped by the vault's free liquidity (the same min the contract enforces
  // in `max_withdraw`). Computed client-side from already-loaded state so we
  // don't need a per-tick contract simulation.
  const userShares = shareBalance.data ?? 0n;
  const totalShares = vaultState.data ? BigInt(vaultState.data.total_shares) : 0n;
  const totalAssets = vaultState.data ? BigInt(vaultState.data.total_assets) : 0n;
  const freeLiquidity = vaultState.data ? BigInt(vaultState.data.free_liquidity) : 0n;
  const userValueUsdc =
    totalShares > 0n ? (userShares * totalAssets) / totalShares : 0n;
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

  // Translate a scaled USDC bigint back into the human string the input uses.
  // formatUsdc returns "1,234.56" — strip commas (parseUsdc rejects them) and
  // any trailing zeros so the field reads "1234.5" rather than "1234.50".
  const inputFromScaled = (scaled: bigint): string => {
    if (scaled <= 0n) return "0";
    return formatUsdc(scaled, { decimals: 6 })
      .replace(/,/g, "")
      .replace(/\.?0+$/, "");
  };

  const pickWithdrawPercent = (pct: number) => {
    if (!canPickPercent) return;
    // Share-denominated split mirrors the redeem path the tx will take.
    // Floors per BigInt division — fine, since 100% returns userShares
    // exactly (no rounding) and intermediate percentages can absorb the
    // 1-atom haircut without surprising the user.
    const shares =
      pct >= 100 ? userShares : (userShares * BigInt(pct)) / 100n;
    // Display the USDC value those shares unwind to (rounding-down, same
    // direction as the chain) so the input field shows what the user gets.
    const previewAssets =
      totalShares > 0n ? (shares * totalAssets) / totalShares : 0n;
    const cappedShares =
      previewAssets <= freeLiquidity
        ? shares
        : // Free-liquidity-bound exit: scale shares down to fit. Fractional
          // share atoms get dropped here too — fine, the user can always run
          // a second withdraw later.
          totalAssets > 0n
          ? (freeLiquidity * totalShares) / totalAssets
          : 0n;
    const displayAssets =
      totalShares > 0n ? (cappedShares * totalAssets) / totalShares : 0n;
    setWithdrawAmt(inputFromScaled(displayAssets));
    setPinnedRedeemShares(cappedShares);
  };

  // Manual input clears the pinned-shares marker; the user is now asking for
  // a specific USDC amount, which is the assets-side `withdraw` path.
  const onWithdrawAmtChange = (next: string) => {
    setWithdrawAmt(next);
    setPinnedRedeemShares(null);
  };

  const deposit = useTxMutation({
    action: "Deposit",
    successDetail: `${depositAmt} USDC added to the vault.`,
    invalidate: vaultInvalidations,
    build: async () => {
      if (!address) throw new Error("connect wallet first");
      const assets = parseUsdc(depositAmt);
      if (assets <= 0n) throw new Error("enter a positive amount");
      return vault(address).deposit({
        assets,
        receiver: address,
        from: address,
        operator: address,
      });
    },
    onSuccess: () => setDepositAmt(""),
  });

  const withdraw = useTxMutation({
    action: "Withdraw",
    successDetail: `${withdrawAmt} USDC returned to your wallet.`,
    invalidate: vaultInvalidations,
    build: async () => {
      if (!address) throw new Error("connect wallet first");
      // Two paths: redeem(shares) for %/MAX picks (no dust gap because OZ's
      // `convert_to_assets` rounds down to what the shares actually unwind
      // to), withdraw(assets) for a user-typed exact amount.
      if (pinnedRedeemShares !== null && pinnedRedeemShares > 0n) {
        return vault(address).redeem({
          shares: pinnedRedeemShares,
          receiver: address,
          owner: address,
          operator: address,
        });
      }
      const assets = parseUsdc(withdrawAmt);
      if (assets <= 0n) throw new Error("enter a positive amount");
      return vault(address).withdraw({
        assets,
        receiver: address,
        owner: address,
        operator: address,
      });
    },
    onSuccess: () => {
      setWithdrawAmt("");
      setPinnedRedeemShares(null);
    },
  });

  if (!address) {
    return (
      <p className="rounded-xl border border-dashed border-border/50 bg-background/30 px-4 py-6 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Connect a wallet to deposit
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/30 px-4 py-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Wallet USDC
        </span>
        <span className="font-mono text-sm tabular-nums text-foreground">
          {usdcBalance.data != null ? <NumberFlowUsd value={usdcBalance.data} /> : "—"}
        </span>
      </div>

      <Tabs defaultValue="deposit">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>

        <TabsContent value="deposit" className="space-y-3">
          <Label>Amount (USDC)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={depositAmt}
            onChange={(e) => setDepositAmt(e.target.value)}
            placeholder="0.00"
            className="h-12 text-lg"
          />
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
          <Input
            type="text"
            inputMode="decimal"
            value={withdrawAmt}
            onChange={(e) => onWithdrawAmtChange(e.target.value)}
            placeholder="0.00"
            className="h-12 text-lg"
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
      <div className="flex items-start gap-3 rounded-xl border border-ember/30 bg-ember/[0.06] px-4 py-3">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ember" aria-hidden />
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember">
              LP cooldown
            </span>
            <Countdown
              seconds={secondsLeft}
              className="font-mono text-[11px] text-foreground"
            />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Unlocks{" "}
            <span className="font-mono text-foreground/85">{formatExpiry(expiry)}</span>.
            Cooldown protects the protocol from flash-loan-style LP exits.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-bull/30 bg-bull/[0.06] px-4 py-2.5">
      <ShieldCheck className="h-3.5 w-3.5 text-bull" aria-hidden />
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-bull">
        cooldown elapsed · free to withdraw
      </span>
    </div>
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

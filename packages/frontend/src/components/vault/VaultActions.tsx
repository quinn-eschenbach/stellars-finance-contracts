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
import { parseUsdc, cn } from "@/lib/utils";
import { queryKeys, useLockup, useWalletBalance } from "@/api/hooks";

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

  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");

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
  ];

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
      const assets = parseUsdc(withdrawAmt);
      if (assets <= 0n) throw new Error("enter a positive amount");
      return vault(address).withdraw({
        assets,
        receiver: address,
        owner: address,
        operator: address,
      });
    },
    onSuccess: () => setWithdrawAmt(""),
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
          <Label>Amount (USDC)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={withdrawAmt}
            onChange={(e) => setWithdrawAmt(e.target.value)}
            placeholder="0.00"
            className="h-12 text-lg"
            disabled={isLocked}
          />
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

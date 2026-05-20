import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  useLockup,
  useVault,
  useVaultProfitability,
  useVaultShareBalance,
} from "@/api/hooks";
import { useStreamVault } from "@/api/sse";
import { useAddress } from "@/wallet/WalletProvider";
import { Card, CardContent } from "@/components/ui/card";
import { NumberFlowUsd, NumberFlowPlain } from "@/components/ui/number-flow";
import { VaultActions } from "@/components/vault/VaultActions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vault")({
  component: VaultPage,
});

function VaultPage() {
  const address = useAddress();
  const vault = useVault();
  const profitability = useVaultProfitability(30);
  const shareBalance = useVaultShareBalance(address);
  const lockup = useLockup(address);
  useStreamVault();

  // Derived LP totals — see VaultActions for the matching withdraw math.
  const userShares = shareBalance.data ?? 0n;
  const totalShares = vault.data ? BigInt(vault.data.total_shares) : 0n;
  const totalAssets = vault.data ? BigInt(vault.data.total_assets) : 0n;
  const userValueUsdc =
    totalShares > 0n ? (userShares * totalAssets) / totalShares : 0n;
  // Percent-of-pool with 4-decimal precision. `* 1_000_000 / 10_000` keeps
  // a tiny LP from rounding to 0.00 — a 0.0001% share still shows.
  const poolPct =
    totalShares > 0n ? Number((userShares * 1_000_000n) / totalShares) / 10_000 : 0;

  // LP-claimable total mirrors `free_liquidity + reserved_usdc`. Distinct from
  // `total_assets`, which also carries unclaimed dev/staker fees + the chain's
  // open-trader-PnL liability term.
  const lpTotal = vault.data
    ? (BigInt(vault.data.free_liquidity) + BigInt(vault.data.reserved_usdc)).toString()
    : null;
  const freeLiquidity = vault.data ? BigInt(vault.data.free_liquidity) : 0n;
  const reservedUsdc = vault.data ? BigInt(vault.data.reserved_usdc) : 0n;
  const utilBps =
    vault.data && lpTotal !== null && BigInt(lpTotal) > 0n
      ? Number((reservedUsdc * 10_000n) / BigInt(lpTotal)) / 100
      : 0;

  // Mark-to-market 30d net: matches the existing Vault state semantics —
  // realized trade flow + unrealized winning-trader liability + LP fee slice.
  const tradingNet =
    vault.data && profitability.data
      ? (() => {
          const pnl = BigInt(vault.data.net_global_trader_pnl);
          const unrealizedToLp = pnl > 0n ? -pnl : 0n;
          return (BigInt(profitability.data.lp_net_from_trades) + unrealizedToLp).toString();
        })()
      : null;

  const profitTotal =
    profitability.data && tradingNet !== null
      ? (BigInt(tradingNet) + BigInt(profitability.data.lp_net_from_fees)).toString()
      : null;

  const apyPercent =
    profitTotal !== null && lpTotal !== null && BigInt(lpTotal) > 0n
      ? (() => {
          const ratioScaled = (BigInt(profitTotal) * 1_000_000n) / BigInt(lpTotal);
          const ratio = Number(ratioScaled) / 1_000_000;
          if (1 + ratio <= 0) return -100;
          return (Math.pow(1 + ratio, 365 / 30) - 1) * 100;
        })()
      : null;

  const lockupExpiry = lockup.data ?? 0;
  const secondsLeft = useCountdownSeconds(lockupExpiry);

  // Max the user could withdraw right now — mirrors the contract's clamp.
  const maxWithdrawUsdc =
    userValueUsdc < freeLiquidity ? userValueUsdc : freeLiquidity;

  return (
    <div className="space-y-10 pb-16">
      {/* ───────── Header ───────── */}
      <motion.header
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-wrap items-end justify-between gap-4 border-b border-border/30 pb-6"
      >
        <div className="space-y-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Liquidity
          </span>
          <h1 className="font-display text-5xl tracking-tightest text-foreground md:text-6xl">
            Vault
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            ERC-4626 LP pool that underwrites every trade. Earns the spread of trader losses,
            borrow fees, and funding.
          </p>
        </div>
        {vault.data?.is_paused ? (
          <div className="pill border-bear/40 bg-bear/10 font-mono text-[10px] uppercase tracking-[0.22em] text-bear">
            <span className="h-1.5 w-1.5 rounded-full bg-bear" />
            Paused
          </div>
        ) : (
          <div className="pill font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ember-pulse rounded-full bg-bull/70" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-bull" />
            </span>
            Live
          </div>
        )}
      </motion.header>

      {/* ───────── Top: 3 summary tiles ───────── */}
      {vault.data && lpTotal !== null && (
        <div className="grid gap-3 md:grid-cols-3">
          <TileTotalAssets value={lpTotal} delay={0.05} />
          <TileUtilization
            free={vault.data.free_liquidity}
            reserved={vault.data.reserved_usdc}
            utilPct={utilBps}
            delay={0.12}
          />
          <TileYield apy={apyPercent} profit={profitTotal} delay={0.19} />
        </div>
      )}

      {/* ───────── Below: actions ⟷ user position ───────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
        {/* LEFT — deposit / withdraw form */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="h-full">
            <CardContent className="space-y-5 px-6 pb-6 pt-6">
              <div className="space-y-1">
                <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
                  Provide liquidity
                </span>
                <p className="text-[11px] text-muted-foreground/70">
                  Deposit USDC · receive vault shares
                </p>
              </div>
              <div className="hairline" />
              <VaultActions />
            </CardContent>
          </Card>
        </motion.div>

        {/* RIGHT — user position as editorial line-list */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <UserPositionPanel
            connected={!!address}
            hasStake={userShares > 0n}
            value={userValueUsdc}
            poolPct={poolPct}
            maxWithdraw={maxWithdrawUsdc}
            secondsLeft={secondsLeft}
          />
        </motion.div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Top-tile components
// ───────────────────────────────────────────────────────────────────────────

function TileTotalAssets({ value, delay }: { value: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="relative h-full overflow-hidden ring-1 ring-ember/15">
        {/* Ember corner glow — subtle, anchors this tile as the headline */}
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, hsl(var(--ember) / 0.45), transparent 70%)" }}
          aria-hidden
        />
        <CardContent className="relative z-10 space-y-4 px-6 pb-6 pt-6">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/85">
              Total assets
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ember/85">
              LP claimable
            </span>
          </div>
          <div className="font-display text-[2.85rem] leading-none tracking-tightest text-foreground md:text-[3.4rem]">
            <NumberFlowUsd value={value} decimals={0} />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <div className="h-px flex-1 bg-gradient-to-r from-ember/60 via-ember/30 to-transparent" />
            <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground/60">
              free + reserved
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function TileUtilization({
  free,
  reserved,
  utilPct,
  delay,
}: {
  free: string;
  reserved: string;
  utilPct: number;
  delay: number;
}) {
  const pctLabel = Number.isFinite(utilPct) ? utilPct.toFixed(1) : "0.0";
  const widthPct = Math.max(2, Math.min(100, utilPct));
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="h-full">
        <CardContent className="space-y-4 px-6 pb-6 pt-6">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/85">
            Utilization
          </span>

          <div className="flex items-baseline gap-1">
            <span className="font-display text-[2.85rem] leading-none tracking-tightest text-foreground md:text-[3.4rem]">
              <NumberFlowPlain value={Number(pctLabel)} decimals={1} />
            </span>
            <span className="pb-1 font-mono text-base text-muted-foreground/70">%</span>
          </div>

          {/* Capsule bar — moss → ember gradient. Width animates from 0 on mount. */}
          <div className="space-y-2">
            <div className="relative h-1.5 overflow-hidden rounded-full bg-card/70 ring-1 ring-border/30">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${widthPct}%` }}
                transition={{ duration: 0.9, delay: delay + 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg, hsl(var(--moss) / 0.85) 0%, hsl(var(--ember) / 0.9) 100%)",
                }}
              />
            </div>
            {/* Labels mirror the bar: filled (left) = ACTIVE, empty (right) = IDLE */}
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em]">
              <span className="text-muted-foreground/65">
                Active
                <span className="ml-1.5 normal-case tracking-normal text-foreground/85">
                  <NumberFlowUsd value={reserved} decimals={0} />
                </span>
              </span>
              <span className="text-muted-foreground/65">
                Idle
                <span className="ml-1.5 normal-case tracking-normal text-foreground/85">
                  <NumberFlowUsd value={free} decimals={0} />
                </span>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function TileYield({
  apy,
  profit,
  delay,
}: {
  apy: number | null;
  profit: string | null;
  delay: number;
}) {
  const tone: "bull" | "bear" | "muted" =
    apy === null
      ? "muted"
      : apy > 0
        ? "bull"
        : apy < 0
          ? "bear"
          : "muted";
  const toneClass =
    tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-foreground/85";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="h-full">
        <CardContent className="space-y-4 px-6 pb-6 pt-6">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/85">
              30-day yield
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground/55">
              annualized
            </span>
          </div>

          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "font-display text-[2.85rem] leading-none tracking-tightest md:text-[3.4rem]",
                toneClass,
              )}
            >
              {apy === null ? "—" : <ApyDigits value={apy} />}
            </span>
            {apy !== null && (
              <span className={cn("pb-1 font-mono text-base", toneClass, "opacity-80")}>%</span>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground/60">
              30-day net
            </span>
            <div className="h-px flex-1 bg-border/40" />
            <span className={cn("font-mono text-xs tabular-nums", toneClass)}>
              {profit !== null ? (
                <NumberFlowUsd value={profit} decimals={0} signDisplay="exceptZero" />
              ) : (
                "—"
              )}
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/**
 * APY's magnitude varies wildly — show `+1,234%` for moonshots, `+12.3%`
 * for normal yields, `+0.05%` for boring days. Keeps the precision where
 * it's meaningful without overflowing the tile.
 */
function ApyDigits({ value }: { value: number }) {
  const abs = Math.abs(value);
  const dp = abs >= 1000 ? 0 : abs >= 10 ? 1 : 2;
  return <NumberFlowPlain value={value} decimals={dp} signDisplay="exceptZero" />;
}

// ───────────────────────────────────────────────────────────────────────────
// Right-side: user position panel (rows, not a grid)
// ───────────────────────────────────────────────────────────────────────────

function UserPositionPanel({
  connected,
  hasStake,
  value,
  poolPct,
  maxWithdraw,
  secondsLeft,
}: {
  connected: boolean;
  hasStake: boolean;
  value: bigint;
  poolPct: number;
  maxWithdraw: bigint;
  secondsLeft: number;
}) {
  const isLocked = secondsLeft > 0;

  if (!connected) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full flex-col items-start justify-center gap-3 px-6 pb-6 pt-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
            Your position
          </span>
          <p className="font-display text-2xl leading-snug text-foreground/85">
            Connect a wallet to track your LP slice.
          </p>
          <p className="text-sm text-muted-foreground/70">
            Once you deposit, this side shows your stake, share of the pool, lockup status, and
            30-day yield broken out alongside the protocol totals.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!hasStake) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full flex-col items-start justify-center gap-3 px-6 pb-6 pt-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
            Your position
          </span>
          <p className="font-display text-2xl leading-snug text-foreground/85">No deposits yet.</p>
          <p className="text-sm text-muted-foreground/70">
            Open the deposit tab and post USDC to start collecting the LP share of trader losses,
            borrow fees, and funding.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardContent className="space-y-5 px-6 pb-6 pt-6">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
            Your position
          </span>
          {isLocked ? (
            <span className="rounded-full border border-ember/40 bg-ember/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ember">
              locked
            </span>
          ) : hasStake ? (
            <span className="rounded-full border border-bull/30 bg-bull/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-bull">
              unlocked
            </span>
          ) : null}
        </div>

        {/* Headline value — live sLP→USDC conversion. Any accumulated yield
            is reflected in this number via share-price appreciation; we don't
            attempt to attribute the rolling-window protocol yield to this LP,
            since that requires knowing their deposit time. */}
        <div className="space-y-1.5">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/65">
            Your stake
          </span>
          <div className="font-display text-[2.2rem] leading-none tracking-tightest text-foreground md:text-[2.6rem]">
            <NumberFlowUsd value={value.toString()} decimals={2} />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/55">
            sLP redeemable
          </p>
        </div>

        <div className="hairline" />

        {/* Editorial line-list. Hairline between each row, label⟷value. */}
        <dl className="divide-y divide-border/25">
          <PositionRow
            label="Share of pool"
            value={
              <span>
                <NumberFlowPlain
                  value={poolPct}
                  decimals={poolPct >= 1 ? 2 : 4}
                />
                <span className="ml-1 text-muted-foreground/60">%</span>
              </span>
            }
          />

          <PositionRow
            label="Withdrawable now"
            value={<NumberFlowUsd value={maxWithdraw.toString()} decimals={2} />}
            sub={
              maxWithdraw < value
                ? "capped by free liquidity"
                : value > 0n
                  ? "full stake available"
                  : undefined
            }
          />

          <PositionRow
            label="Lockup"
            value={
              isLocked ? (
                <span className="text-ember/95">{formatCountdown(secondsLeft)}</span>
              ) : (
                <span className="text-bull/85">elapsed</span>
              )
            }
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function PositionRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
        {label}
      </span>
      <div className="text-right">
        <div className="font-display text-lg tabular-nums tracking-tight text-foreground md:text-xl">
          {value}
        </div>
        {sub && (
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/55">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tick once per second while there's an active lockup. Idles when expired
 * so the page is quiet for users who can already withdraw.
 */
function useCountdownSeconds(expiry: number): number {
  const compute = () => Math.max(0, expiry - Math.floor(Date.now() / 1000));
  const [secondsLeft, setSecondsLeft] = useState(compute);
  useEffect(() => {
    setSecondsLeft(compute());
    if (expiry === 0) return;
    if (compute() === 0) return;
    const id = window.setInterval(() => {
      const next = Math.max(0, expiry - Math.floor(Date.now() / 1000));
      setSecondsLeft(next);
      if (next === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiry]);
  return secondsLeft;
}

function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

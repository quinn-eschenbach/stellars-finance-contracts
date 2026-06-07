import { useEffect, useState, type ReactNode } from "react";
import { Frame, GroupBox, ProgressBar } from "react95";
import {
  useLockup,
  useVault,
  useVaultProfitability,
  useVaultShareBalance,
} from "@/api/hooks";
import { useStreamVault } from "@/api/sse";
import { useAddress } from "@/wallet/WalletProvider";
import { NumberFlowUsd, NumberFlowPlain } from "@/components/ui/number-flow";
import { WellNote } from "@/components/ui/well-note";
import { VaultActions } from "@/components/vault/VaultActions";
import { cn } from "@/lib/utils";

/** ERC-4626 LP pool window: pool stats, deposit/withdraw, your position. */
export function VaultApp() {
  const address = useAddress();
  const vault = useVault();
  const profitability = useVaultProfitability(30);
  const shareBalance = useVaultShareBalance(address);
  const lockup = useLockup(address);
  useStreamVault();

  // LP-claimable total mirrors the contract's `free_liquidity + reserved_usdc`
  // — the conservative LP NAV that excludes non-LP claims (unclaimed dev/staker
  // fees + the open-trader-PnL liability). Raw `total_assets` also carries
  // those non-LP claims, so it MUST NOT be used as the share-pricing basis on
  // the LP view — doing so over-states every LP's stake and lets the sum
  // exceed the pool. Window-wide rule: vault is the **realized-basis view**.
  const lpTotal = vault.data
    ? (BigInt(vault.data.free_liquidity) + BigInt(vault.data.reserved_usdc)).toString()
    : null;
  const lpTotalBig = lpTotal !== null ? BigInt(lpTotal) : 0n;
  const freeLiquidity = vault.data ? BigInt(vault.data.free_liquidity) : 0n;
  const reservedUsdc = vault.data ? BigInt(vault.data.reserved_usdc) : 0n;
  const utilBps =
    lpTotalBig > 0n ? Number((reservedUsdc * 10_000n) / lpTotalBig) / 100 : 0;

  // Derived LP totals — share-price-of-pool against the LP-fair basis so the
  // sum across all LPs equals `lpTotal` exactly.
  const userShares = shareBalance.data ?? 0n;
  const totalShares = vault.data ? BigInt(vault.data.total_shares) : 0n;
  const userValueUsdc =
    totalShares > 0n ? (userShares * lpTotalBig) / totalShares : 0n;
  // Percent-of-pool with 4-decimal precision. `* 1_000_000 / 10_000` keeps
  // a tiny LP from rounding to 0.00 — a 0.0001% share still shows.
  const poolPct =
    totalShares > 0n ? Number((userShares * 1_000_000n) / totalShares) / 10_000 : 0;

  // 30-day trading net: realized only. Open-trader-PnL drift would muddy the
  // realized-basis view, and individual MTM signals live on the leaderboard
  // and positions windows.
  const tradingNet = profitability.data
    ? profitability.data.lp_net_from_trades
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
  const isLocked = secondsLeft > 0;

  // Max the user could withdraw right now — mirrors the contract's clamp.
  const maxWithdrawUsdc =
    userValueUsdc < freeLiquidity ? userValueUsdc : freeLiquidity;

  return (
    <div className="flex flex-col gap-2">
      <Frame variant="status" className="!flex items-center justify-between !px-2 !py-1">
        <span className="text-xs">
          LP pool that underwrites every trade — earns trader losses, borrow fees and funding.
        </span>
        <span className={cn("text-xs font-bold", vault.data?.is_paused ? "text-bear" : "text-bull")}>
          {vault.data?.is_paused ? "Paused" : "Live"}
        </span>
      </Frame>

      <GroupBox label="Pool" className="!pt-3">
        <div className="space-y-3">
          <StatLine
            label="Total assets (LP claimable)"
            value={lpTotal !== null ? <NumberFlowUsd value={lpTotal} decimals={0} /> : "—"}
          />
          <div className="space-y-1">
            <StatLine
              label="Utilization"
              value={
                <span>
                  <NumberFlowPlain value={Number(utilBps.toFixed(1))} decimals={1} />%
                </span>
              }
            />
            <ProgressBar variant="tile" value={Math.round(Math.min(100, Math.max(0, utilBps)))} />
            <div className="flex items-center justify-between font-mono text-xs">
              <span>
                Active <NumberFlowUsd value={reservedUsdc.toString()} decimals={0} />
              </span>
              <span>
                Idle <NumberFlowUsd value={freeLiquidity.toString()} decimals={0} />
              </span>
            </div>
          </div>
          <StatLine
            label="30-day yield (annualized)"
            value={
              apyPercent === null ? (
                "—"
              ) : (
                <span className={cn(apyPercent > 0 ? "text-bull" : apyPercent < 0 ? "text-bear" : undefined)}>
                  <ApyDigits value={apyPercent} />%
                </span>
              )
            }
          />
          <StatLine
            label="30-day net"
            value={
              profitTotal !== null ? (
                <NumberFlowUsd value={profitTotal} decimals={0} signDisplay="exceptZero" />
              ) : (
                "—"
              )
            }
          />
        </div>
      </GroupBox>

      <div className="flex flex-wrap items-start gap-2">
        <GroupBox label="Provide liquidity" className="min-w-[280px] flex-1 !pt-3">
          <VaultActions />
        </GroupBox>

        <GroupBox label="Your position" className="min-w-[280px] flex-1 !pt-3">
          <UserPosition
            connected={!!address}
            hasStake={userShares > 0n}
            value={userValueUsdc}
            poolPct={poolPct}
            maxWithdraw={maxWithdrawUsdc}
            isLocked={isLocked}
            secondsLeft={secondsLeft}
          />
        </GroupBox>
      </div>
    </div>
  );
}

function UserPosition({
  connected,
  hasStake,
  value,
  poolPct,
  maxWithdraw,
  isLocked,
  secondsLeft,
}: {
  connected: boolean;
  hasStake: boolean;
  value: bigint;
  poolPct: number;
  maxWithdraw: bigint;
  isLocked: boolean;
  secondsLeft: number;
}) {
  if (!connected) {
    return <WellNote>Connect a wallet to track your LP stake</WellNote>;
  }
  if (!hasStake) {
    return (
      <WellNote>
        No deposits yet — post USDC to start collecting the LP share of trader losses, borrow
        fees, and funding.
      </WellNote>
    );
  }
  return (
    <div className="space-y-3">
      {/* Headline value — live sLP→USDC conversion. Accumulated yield shows up
          here via share-price appreciation. */}
      <StatLine
        label="Your stake (sLP redeemable)"
        value={<NumberFlowUsd value={value.toString()} decimals={2} />}
      />
      <StatLine
        label="Share of pool"
        value={
          <span>
            <NumberFlowPlain value={poolPct} decimals={poolPct >= 1 ? 2 : 4} />%
          </span>
        }
      />
      <StatLine
        label="Withdrawable now"
        value={<NumberFlowUsd value={maxWithdraw.toString()} decimals={2} />}
        sub={maxWithdraw < value ? "capped by free liquidity" : "full stake available"}
      />
      <StatLine
        label="Lockup"
        value={
          isLocked ? (
            <span className="text-bear">{formatCountdown(secondsLeft)}</span>
          ) : (
            <span className="text-bull">elapsed</span>
          )
        }
      />
    </div>
  );
}

function StatLine({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs">{label}</span>
      <span className="text-right">
        <span className="font-mono text-sm font-bold tabular-nums">{value}</span>
        {sub && <span className="block text-right text-xs">{sub}</span>}
      </span>
    </div>
  );
}

/**
 * APY's magnitude varies wildly — show `+1,234%` for moonshots, `+12.3%`
 * for normal yields, `+0.05%` for boring days. Keeps the precision where
 * it's meaningful without overflowing the row.
 */
function ApyDigits({ value }: { value: number }) {
  const abs = Math.abs(value);
  const dp = abs >= 1000 ? 0 : abs >= 10 ? 1 : 2;
  return <NumberFlowPlain value={value} decimals={dp} signDisplay="exceptZero" />;
}

/**
 * Tick once per second while there's an active lockup. Idles when expired
 * so the window is quiet for users who can already withdraw.
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

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAddress, useWallet } from "@/wallet/WalletProvider";
import { positionManager } from "@/contracts/clients";
import { signAndSendWithWallet } from "@/contracts/sender";
import { formatPrice, formatUsdc } from "@/lib/utils";
import { unrealizedPnl } from "@/lib/math";
import { queryKeys } from "@/api/hooks";
import type { PositionRow as PositionRowData } from "@/api/types";

interface PositionRowProps {
  position: PositionRowData;
  /** Current mark price for the symbol, scaled (10^7). */
  markPrice?: string;
}

export function PositionRow({ position, markPrice }: PositionRowProps) {
  const address = useAddress();
  const { signTransaction } = useWallet();
  const qc = useQueryClient();

  const close = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect wallet first");
      const tx = await positionManager(address).decrease_position({
        trader: address,
        symbol: position.symbol,
        size_delta: BigInt(position.size),
      });
      const result = await signAndSendWithWallet(tx, signTransaction);
      return result.hash;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.positions(address ?? "") });
    },
  });

  const pnl = markPrice
    ? unrealizedPnl(
        BigInt(position.size),
        BigInt(position.entry_price),
        BigInt(markPrice),
        position.is_long,
      )
    : 0n;
  const pnlClass = pnl > 0n ? "text-bull" : pnl < 0n ? "text-bear" : "text-muted-foreground";

  return (
    <div className="grid grid-cols-7 items-center gap-3 rounded-md border border-border p-3 font-mono text-sm">
      <span>{position.symbol}</span>
      <span className={position.is_long ? "text-bull" : "text-bear"}>
        {position.is_long ? "LONG" : "SHORT"}
      </span>
      <span>${formatUsdc(position.size)}</span>
      <span>${formatUsdc(position.collateral)} margin</span>
      <span>entry ${formatPrice(position.entry_price)}</span>
      <span className={pnlClass}>
        {markPrice ? `${pnl >= 0n ? "+" : "−"}$${formatUsdc(pnl, { abs: true })}` : "—"}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={close.isPending}
        onClick={() => close.mutate()}
      >
        {close.isPending ? "Closing…" : "Close"}
      </Button>
    </div>
  );
}

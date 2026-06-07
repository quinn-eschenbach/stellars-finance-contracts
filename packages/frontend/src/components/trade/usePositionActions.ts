import { useAddress } from "@/wallet/WalletProvider";
import { positionManager } from "@/contracts/clients";
import { useTxMutation } from "@/contracts/useTxMutation";
import { queryKeys } from "@/api/hooks";
import type { PositionRow } from "@/api/types";

/**
 * Close-side mutations for an open Position — the one place that encodes
 * "Close = full Decrease" and "partial Decrease = pct of size", plus the
 * cache invalidations both imply.
 *
 * `acceptable_price: 0` = no slippage cap for now. Once close-side slippage
 * UX lands, thread the user's chosen acceptable price through here — one
 * edit covers every close surface.
 */
export function usePositionActions(position: PositionRow) {
  const address = useAddress();
  const size = BigInt(position.size);
  const invalidate = [queryKeys.positions(address ?? ""), queryKeys.walletBalance(address)];

  const close = useTxMutation({
    action: `Close ${position.is_long ? "long" : "short"} ${position.symbol}`,
    successDetail: "Position settled and PnL credited.",
    invalidate,
    build: async () => {
      if (!address) throw new Error("connect wallet first");
      return positionManager(address).decrease_position({
        trader: address,
        symbol: position.symbol,
        size_delta: size,
        acceptable_price: 0n,
      });
    },
  });

  /** Partial close by percent of current size (e.g. `decrease.mutate(25)`). */
  const decrease = useTxMutation<number>({
    action: `Decrease ${position.symbol}`,
    successDetail: "Position size reduced, proportional margin returned.",
    invalidate,
    build: async (pct) => {
      if (!address) throw new Error("connect wallet first");
      return positionManager(address).decrease_position({
        trader: address,
        symbol: position.symbol,
        size_delta: (size * BigInt(pct)) / 100n,
        acceptable_price: 0n,
      });
    },
  });

  return { close, decrease };
}

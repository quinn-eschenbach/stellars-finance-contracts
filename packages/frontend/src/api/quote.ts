import { useMemo } from "react";
import {
  evaluateIncrease,
  toBigInt,
  toBorrowRateConfig,
  type IncreaseIntent,
  type IncreaseQuote,
} from "@stellars/protocol-math";
import { useMarketTick } from "./marketTick";
import { useProtocolConfig, useVault } from "./hooks";

/**
 * Off-chain IncreaseQuote — the staged-order twin of `useMarketTick`'s
 * PositionEvaluation. Gathers tick, fee config, vault, and protocol limits
 * from the existing query cache and runs `evaluateIncrease` once per intent
 * change. Returns `null` while any input is loading or the symbol has no
 * live price. Does NOT require a connected wallet — FeeConfig is global
 * protocol state, sourced from `/config` (indexer-mirrored).
 */
export function useIncreaseQuote(
  symbol: string | null | undefined,
  intent: IncreaseIntent | null,
  _address: string | null | undefined,
): IncreaseQuote | null {
  const tick = useMarketTick(symbol);
  const vault = useVault();
  const config = useProtocolConfig();

  return useMemo(() => {
    if (!intent || !tick || !vault.data || !config.data) return null;
    return evaluateIncrease({
      intent,
      tick,
      fee_config: { open_fee_bps: BigInt(config.data.open_fee_bps) },
      vault: {
        reserved_usdc: toBigInt(vault.data.reserved_usdc),
        total_assets: toBigInt(vault.data.total_assets),
        unclaimed_fees: toBigInt(vault.data.unclaimed_fees),
      },
      protocol_limits: {
        max_utilization_ratio_bps: toBigInt(config.data.max_utilization_ratio),
        liquidation_threshold_bps: BigInt(config.data.liquidation_threshold_bps),
      },
      rate_config: toBorrowRateConfig(config.data),
    });
  }, [intent, tick, vault.data, config.data]);
}

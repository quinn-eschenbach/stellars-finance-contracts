import { sql } from "drizzle-orm";
import { positions } from "@stellars/db";
import type { Fixture } from "../src/fixture.js";
import { assertEqual, log } from "../src/assert.js";
import { USDC_UNIT } from "../src/constants.js";

/**
 * Extreme volatility — the alignment check that earns the simulation suite
 * its keep. Tightly coupled assertions verify the docs, the contract, the
 * keeper, and the math model all agree on which positions a 16% crash
 * should liquidate.
 *
 * Pre-conditions:
 *   1. `make reset` (clean state)
 *   2. `make indexer` and `make keeper` running in separate terminals
 *
 * Inputs (predefined):
 *   - LP deposits 1M USDC
 *   - 24 long traders at $50k entry, each with 1k collateral, leverage tiers:
 *     · 6 × 5x  (size  5k)
 *     · 6 × 10x (size 10k)
 *     · 6 × 15x (size 15k)
 *     · 6 × 20x (size 20k)
 *
 * Trigger:
 *   - BTC $50k → $42k (-16%)
 *
 * Math model says (ignoring negligible borrow/funding over <2min window):
 *   pnl_long = size * (mark - entry) / entry = size * (-0.16)
 *   health  = collateral + pnl
 *
 *     5x: health = 1000 - (5000  * 0.16) =  200  → HEALTHY
 *    10x: health = 1000 - (10000 * 0.16) = -600  → LIQUIDATABLE
 *    15x: health = 1000 - (15000 * 0.16) = -1400 → LIQUIDATABLE
 *    20x: health = 1000 - (20000 * 0.16) = -2200 → LIQUIDATABLE
 *
 * Predicted outcomes (exact):
 *   - 18 liquidations on-chain and in DB (6 each at 10x/15x/20x)
 *   - 6 surviving positions on-chain and in DB (the 5x tier)
 *   - 0 order events, 0 ADL events
 *
 * If any of these counts disagree, one of {docs, contract, keeper math,
 * over-permissive filter} has drifted from the others. The failing
 * assertion points at which.
 */

const SYMBOL = "BTCUSD";
const ENTRY_PRICE = 50_000n;
const CRASH_PRICE = 42_000n;

const LP_DEPOSIT = 1_000_000n * USDC_UNIT;
const COLLATERAL = 1_000n * USDC_UNIT;
const TRADER_USDC = 2_000n * USDC_UNIT;
const TRADERS_PER_TIER = 6;
const LEVERAGE_TIERS = [5n, 10n, 15n, 20n] as const;

const NUM_TRADERS = TRADERS_PER_TIER * LEVERAGE_TIERS.length;

// Derived from the math above. Update only if the trigger or tiers change.
const EXPECTED = {
  liquidations: 18,    // 10x + 15x + 20x tiers (6 each)
  surviving: 6,         // 5x tier
  orders: 0,
  adls: 0,
};

export default async function extremeVolatility(f: Fixture) {
  log("PRECONDITION", "make reset && make indexer && make keeper running");

  // 1. Seed vault.
  const lp = await f.createFundedTrader(LP_DEPOSIT);
  await f.depositVault(lp, LP_DEPOSIT);
  log("LP deposited", `${LP_DEPOSIT / USDC_UNIT} USDC`);

  // 2. Initial price.
  await f.setPrice(SYMBOL, ENTRY_PRICE);

  // 3. Open NUM_TRADERS longs across the leverage tiers.
  const traders = await f.createFundedUsers(NUM_TRADERS, TRADER_USDC);
  for (let i = 0; i < NUM_TRADERS; i++) {
    const tierIdx = Math.floor(i / TRADERS_PER_TIER);
    const leverage = LEVERAGE_TIERS[tierIdx];
    const size = COLLATERAL * leverage;
    try {
      await f.openLong(traders[i], SYMBOL, size, COLLATERAL);
      log(`opened ${i + 1}/${NUM_TRADERS}`, `tier=${leverage}x trader=${traders[i].publicKey().slice(0, 8)}…`);
    } catch (err) {
      throw new Error(
        `extreme-volatility setup failed at iteration ${i + 1}/${NUM_TRADERS} (tier=${leverage}x): ${(err as Error).message}`,
      );
    }
  }
  log(
    "Positions opened",
    `${NUM_TRADERS} longs across ${LEVERAGE_TIERS.join("x/")}x tiers`,
  );

  // 4. Crash.
  log("CRASH", `BTC ${ENTRY_PRICE} → ${CRASH_PRICE} (${
    Number((((CRASH_PRICE - ENTRY_PRICE) * 10000n) / ENTRY_PRICE)) / 100
  }%)`);
  await f.setPrice(SYMBOL, CRASH_PRICE);

  // 5. Wait for the keeper to clear all liquidatable positions. At the
  //    Stellar ledger-close ceiling of ~12 actions/min, 18 liquidations
  //    take ~90s end-to-end. 3min timeout gives generous headroom.
  log("Settling", `waiting for keeper to liquidate ${EXPECTED.liquidations} positions`);
  await f.waitForKeeperToSettle({ timeoutMs: 180_000, stableMs: 10_000 });
  await f.waitForIndexer({ maxLagSec: 5, timeoutMs: 30_000 });

  // 6. On-chain — count surviving positions by trying to fetch each.
  let onChainSurviving = 0;
  for (let i = 0; i < NUM_TRADERS; i++) {
    try {
      const pos = await f.getPosition(traders[i].publicKey(), SYMBOL);
      if (pos && pos.size > 0n) onChainSurviving++;
    } catch {
      // PositionNotFound = liquidated
    }
  }
  log("On-chain surviving", onChainSurviving);
  assertEqual(
    onChainSurviving,
    EXPECTED.surviving,
    `expected exactly ${EXPECTED.surviving} surviving positions on-chain`,
  );

  // 7. DB — assert positions table reflects the same count, and that the
  //    keeper's emitted exactly the expected number of liquidation events.
  const dbPositions = await f
    .db()
    .select({ count: sql<number>`count(*)::int` })
    .from(positions);
  const dbPosCount = Number(dbPositions[0]?.count ?? 0);
  assertEqual(dbPosCount, EXPECTED.surviving, `DB positions count`);

  const liqs = await f.countTradesByType("liquidation");
  const orders = await f.countTradesByType("order");
  const adls = await f.countTradesByType("adl");
  log("DB events", `liquidation=${liqs} order=${orders} adl=${adls}`);

  assertEqual(liqs, EXPECTED.liquidations, `DB liquidation count`);
  assertEqual(orders, EXPECTED.orders, "DB order count");
  assertEqual(adls, EXPECTED.adls, "DB adl count");

  log(
    "OK",
    `extreme-volatility: ${EXPECTED.liquidations} liquidations matched across contract + DB`,
  );
}

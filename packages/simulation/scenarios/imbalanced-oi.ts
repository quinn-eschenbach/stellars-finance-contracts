import { eq, sql } from "drizzle-orm";
import { positions, markets, vaultState } from "@stellars/db";
import type { Fixture } from "../src/fixture.js";
import { assertEqual, assertGt, log } from "../src/assert.js";
import { USDC_UNIT } from "../src/constants.js";

/**
 * Imbalanced OI — verifies funding-rate machinery agrees across the
 * contract, the keeper's `update_indices` invocation cadence, and what
 * the indexer writes to `markets`.
 *
 * Pre-conditions:
 *   1. `make reset` (clean state)
 *   2. `make indexer` and `make keeper` running in separate terminals
 *
 * Inputs (predefined):
 *   - LP deposits 1M USDC
 *   - 18 long traders + 2 short traders, each at 5x leverage
 *     (1k collateral, 5k size). Total long OI 90k, short OI 10k.
 *   - BTC price held flat at $50k for the duration.
 *
 * Trigger:
 *   - Wait ~90s of wall time. Keeper's INDEX_UPDATE_THRESHOLD_SEC default
 *     is 60s, so at least one update_indices fires. Funding accrues in
 *     the long-skewed direction.
 *
 * Predicted outcomes (looser bounds — exact funding math is reserved for
 * a future tighter scenario):
 *   - 20 positions still open (no liquidations, no order triggers)
 *   - markets.BTCUSD.acc_funding_index > 0 (funding has accrued in long-pay direction)
 *   - markets.BTCUSD.last_index_update is recent (keeper actually ran update_indices)
 *   - vaultState.unclaimed_fees > 0 (funding cut accumulated)
 *   - 0 liquidation, order, or adl events
 */

const SYMBOL = "BTCUSD";
const PRICE = 50_000n;

const LP_DEPOSIT = 1_000_000n * USDC_UNIT;
const COLLATERAL = 1_000n * USDC_UNIT;
const SIZE = 5_000n * USDC_UNIT;
const TRADER_USDC = 2_000n * USDC_UNIT;
const NUM_LONGS = 18;
const NUM_SHORTS = 2;
const NUM_TRADERS = NUM_LONGS + NUM_SHORTS;

const WAIT_FOR_FUNDING_MS = 90_000;

const EXPECTED = {
  positionCount: NUM_TRADERS,
  liquidations: 0,
  orders: 0,
  adls: 0,
};

export default async function imbalancedOi(f: Fixture) {
  log("PRECONDITION", "make reset && make indexer && make keeper running");

  // 1. Seed vault.
  const lp = await f.createFundedTrader(LP_DEPOSIT);
  await f.depositVault(lp, LP_DEPOSIT);
  log("LP deposited", `${LP_DEPOSIT / USDC_UNIT} USDC`);

  // 2. Initial price (held flat).
  await f.setPrice(SYMBOL, PRICE);

  // 3. Open positions. 18 longs first, then 2 shorts.
  const traders = await f.createFundedUsers(NUM_TRADERS, TRADER_USDC);
  for (let i = 0; i < NUM_LONGS; i++) {
    await f.openLong(traders[i], SYMBOL, SIZE, COLLATERAL);
  }
  for (let i = NUM_LONGS; i < NUM_TRADERS; i++) {
    await f.openShort(traders[i], SYMBOL, SIZE, COLLATERAL);
  }
  log(
    "Positions opened",
    `${NUM_LONGS} longs + ${NUM_SHORTS} shorts (long OI=${(NUM_LONGS * 5000)}k, short OI=${(NUM_SHORTS * 5000)}k)`,
  );

  // 4. Snapshot the funding index before the wait.
  const marketBefore = await f
    .db()
    .select()
    .from(markets)
    .where(eq(markets.symbol, SYMBOL))
    .limit(1);
  await f.waitForIndexer({ maxLagSec: 5, timeoutMs: 30_000 });
  const accFundingBefore = BigInt(marketBefore[0]?.acc_funding_index ?? "0");
  log("acc_funding_index before", accFundingBefore.toString());

  // 5. Wait for the keeper to fire at least one update_indices and accrue
  //    funding in the long-skewed direction.
  log("Waiting for funding accrual", `${WAIT_FOR_FUNDING_MS / 1000}s`);
  await new Promise((r) => setTimeout(r, WAIT_FOR_FUNDING_MS));

  await f.waitForKeeperToSettle({ timeoutMs: 30_000, stableMs: 8_000 });
  await f.waitForIndexer({ maxLagSec: 5, timeoutMs: 30_000 });

  // 6. Market state assertions.
  const marketAfter = await f
    .db()
    .select()
    .from(markets)
    .where(eq(markets.symbol, SYMBOL))
    .limit(1);
  if (!marketAfter[0]) throw new Error("market row missing from DB");

  const accFundingAfter = BigInt(marketAfter[0].acc_funding_index);
  const lastIndexUpdate = Number(marketAfter[0].last_index_update);
  const nowUnix = Math.floor(Date.now() / 1000);
  log("acc_funding_index after", accFundingAfter.toString());
  log("last_index_update", `${lastIndexUpdate} (${nowUnix - lastIndexUpdate}s ago)`);

  assertGt(
    accFundingAfter,
    accFundingBefore,
    "acc_funding_index must advance under long-skewed OI",
  );
  if (nowUnix - lastIndexUpdate > 120) {
    throw new Error(
      `last_index_update is ${nowUnix - lastIndexUpdate}s old — keeper may not be calling update_indices`,
    );
  }

  // 7. Vault accrued funding cut.
  const vaultRow = await f.db().select().from(vaultState).where(eq(vaultState.id, 1)).limit(1);
  const unclaimedFees = BigInt(vaultRow[0]?.unclaimed_fees ?? "0");
  log("vault.unclaimed_fees", unclaimedFees.toString());
  assertGt(unclaimedFees, 0n, "vault must accrue funding cut over the window");

  // 8. No keeper trader-actions fired.
  const dbPositions = await f
    .db()
    .select({ count: sql<number>`count(*)::int` })
    .from(positions);
  const dbPosCount = Number(dbPositions[0]?.count ?? 0);
  assertEqual(dbPosCount, EXPECTED.positionCount, `DB positions count`);

  const liqs = await f.countTradesByType("liquidation");
  const orders = await f.countTradesByType("order");
  const adls = await f.countTradesByType("adl");
  log("DB events", `liquidation=${liqs} order=${orders} adl=${adls}`);
  assertEqual(liqs, EXPECTED.liquidations, "no liquidations expected");
  assertEqual(orders, EXPECTED.orders, "no orders expected");
  assertEqual(adls, EXPECTED.adls, "no adls expected");

  log("OK", "imbalanced-oi: funding accrued long→short, vault took cut, no keeper trader-actions");
}

import { sql } from "drizzle-orm";
import { positions } from "@stellars/db";
import type { Fixture } from "../src/fixture.js";
import { assertEqual, assertApprox, log } from "../src/assert.js";
import { USDC_UNIT } from "../src/constants.js";

/**
 * Normal usage — verifies the docs/contract/keeper/math model agreement
 * for the boring path: traders open positions, prices drift mildly, no
 * liquidations or order triggers fire, vault accrues only minor borrow
 * fees over time.
 *
 * Pre-conditions (run BEFORE this scenario):
 *   1. `make reset` (clean state)
 *   2. `make indexer` and `make keeper` running in separate terminals
 *
 * Inputs (predefined):
 *   - LP deposits 100k USDC
 *   - 3 longs + 2 shorts at 5x leverage, each with 1k collateral / 5k size
 *   - BTC at $50k, drifts ±1% over 30s
 *
 * Predicted outcomes (must match exactly unless noted):
 *   - 5 positions remain open on-chain and in DB
 *   - 0 keeper events (liquidation / order / adl) on-chain or in DB
 *   - Vault total_assets within 10bps (0.1%) of starting LP deposit
 *     (accounts for tiny borrow accrual over the 30s window)
 */

const SYMBOL = "BTCUSD";
const LP_DEPOSIT = 100_000n * USDC_UNIT;
const TRADER_USDC = 2_000n * USDC_UNIT;
const COLLATERAL = 1_000n * USDC_UNIT;
const SIZE = 5_000n * USDC_UNIT; // 5x leverage
const NUM_LONGS = 3;
const NUM_SHORTS = 2;
const NUM_TRADERS = NUM_LONGS + NUM_SHORTS;

const EXPECTED = {
  positionCount: NUM_TRADERS,
  liquidations: 0,
  orders: 0,
  adls: 0,
  vaultAssetsToleranceBps: 10, // ≤ 0.1% drift from LP deposit
};

export default async function normalUsage(f: Fixture) {
  log("PRECONDITION", "make reset && make indexer && make keeper running");

  // 1. LP seeds vault.
  const lp = await f.createFundedTrader(LP_DEPOSIT);
  await f.depositVault(lp, LP_DEPOSIT);
  log("LP deposited", `${LP_DEPOSIT / USDC_UNIT} USDC`);

  // 2. Set initial price.
  await f.setPrice(SYMBOL, 50_000n);

  // 3. Open positions: 3 longs + 2 shorts at 5x.
  const traders = await f.createFundedUsers(NUM_TRADERS, TRADER_USDC);
  for (let i = 0; i < traders.length; i++) {
    if (i < NUM_LONGS) {
      await f.openLong(traders[i], SYMBOL, SIZE, COLLATERAL);
    } else {
      await f.openShort(traders[i], SYMBOL, SIZE, COLLATERAL);
    }
  }
  log("Positions opened", `${NUM_LONGS} longs + ${NUM_SHORTS} shorts at 5x`);

  // 4. Mild price drift — none of these should trigger anything.
  await f.setPrice(SYMBOL, 50_500n); // +1%
  await new Promise((r) => setTimeout(r, 5_000));
  await f.setPrice(SYMBOL, 49_500n); // -1% from start
  await new Promise((r) => setTimeout(r, 5_000));
  await f.setPrice(SYMBOL, 50_200n); // ~+0.4% from start
  log("Price drift", "$50k → $50.5k → $49.5k → $50.2k");

  // 5. Let the keeper observe and the indexer catch up.
  log("Settling", "waiting for keeper inactivity (no liquidations expected)");
  await f.waitForKeeperToSettle({ timeoutMs: 30_000, stableMs: 8_000 });
  await f.waitForIndexer({ maxLagSec: 5, timeoutMs: 30_000 });

  // 6. On-chain assertions.
  const vaultAssets = await f.vaultTotalAssets();
  log("Vault total_assets", vaultAssets);
  assertApprox(
    vaultAssets,
    LP_DEPOSIT,
    EXPECTED.vaultAssetsToleranceBps,
    `vault assets within ${EXPECTED.vaultAssetsToleranceBps}bps of deposit`,
  );

  for (let i = 0; i < traders.length; i++) {
    const pos = await f.getPosition(traders[i].publicKey(), SYMBOL);
    if (!pos) throw new Error(`trader ${i} should still have an open position`);
  }
  log("On-chain positions", `${NUM_TRADERS} all present`);

  // 7. DB assertions.
  const dbPositions = await f
    .db()
    .select({ count: sql<number>`count(*)::int` })
    .from(positions);
  const dbPosCount = Number(dbPositions[0]?.count ?? 0);
  assertEqual(dbPosCount, EXPECTED.positionCount, `DB positions count`);
  log("DB positions", dbPosCount);

  const liqs = await f.countTradesByType("liquidation");
  const orders = await f.countTradesByType("order");
  const adls = await f.countTradesByType("adl");
  assertEqual(liqs, EXPECTED.liquidations, "DB liquidation events");
  assertEqual(orders, EXPECTED.orders, "DB order events");
  assertEqual(adls, EXPECTED.adls, "DB adl events");
  log("DB keeper events", `liquidation=${liqs} order=${orders} adl=${adls}`);

  log("OK", "normal-usage: docs ↔ contract ↔ keeper ↔ math all aligned for happy path");
}

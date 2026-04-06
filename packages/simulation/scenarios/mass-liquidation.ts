import type { Fixture } from "../src/fixture.js";
import { assertGt, log } from "../src/assert.js";
import { USDC_UNIT } from "../src/constants.js";

const NUM_TRADERS = 100;
const USDC_PER_TRADER = 10_000n * USDC_UNIT;
const COLLATERAL_PER_TRADE = 5_000n * USDC_UNIT;
const SYMBOL = "BTC";

/**
 * Mass liquidation scenario:
 * 1. LP deposits large vault liquidity
 * 2. 100 traders open long BTC with varying leverage (5x–24x)
 * 3. BTC crashes 40% ($50k → $30k)
 * 4. Verify high-leverage positions are underwater
 *
 * After this scenario completes, start the keeper (`make keeper`) to
 * watch it liquidate the unhealthy positions in real time.
 */
export default async function massLiquidation(f: Fixture) {
  // 1. Seed vault with enough liquidity to cover all positions
  const vaultDeposit = 10_000_000n * USDC_UNIT;
  const lp = await f.createFundedTrader(vaultDeposit);
  await f.depositVault(lp, vaultDeposit);

  const totalAssets = await f.vaultTotalAssets();
  log("Vault seeded", `${totalAssets / USDC_UNIT} USDC`);

  // 2. Set initial BTC price
  await f.setPrice(SYMBOL, 50_000n);
  const price = await f.getPrice(SYMBOL);
  log("BTC price set", price);

  // 3. Create 100 traders and open longs at varying leverage
  log("Creating traders", `${NUM_TRADERS} users, ${USDC_PER_TRADER / USDC_UNIT} USDC each`);
  const traders = await f.createFundedUsers(NUM_TRADERS, USDC_PER_TRADER);

  log("Opening positions", `${NUM_TRADERS} longs with 5x–24x leverage`);
  for (let i = 0; i < traders.length; i++) {
    const kp = traders[i];
    const leverage = 5n + BigInt(i % 20); // 5x to 24x
    const size = COLLATERAL_PER_TRADE * leverage;

    try {
      await f.openLong(kp, SYMBOL, size, COLLATERAL_PER_TRADE);
      if ((i + 1) % 10 === 0) {
        log(`Positions opened`, `${i + 1}/${NUM_TRADERS}`);
      }
    } catch (err) {
      log(`Trader ${i} FAILED (${leverage}x)`, err instanceof Error ? err.message : String(err));
    }
  }

  // 4. Check market state before crash
  const marketBefore = await f.getMarket(SYMBOL);
  log("OI (long) before crash", marketBefore.total_long_size);
  log("OI (short) before crash", marketBefore.total_short_size);

  const freeBefore = await f.freeLiquidity();
  log("Free liquidity before crash", `${freeBefore / USDC_UNIT} USDC`);

  // 5. Crash BTC 40%
  log("CRASH", "BTC $50,000 → $30,000 (-40%)");
  await f.setPrice(SYMBOL, 30_000n);

  // 6. Survey positions — count how many are underwater
  let liquidatable = 0;
  let healthy = 0;
  let errors = 0;

  for (let i = 0; i < traders.length; i++) {
    try {
      const pos = await f.getPosition(traders[i].publicKey(), SYMBOL);
      // A position with entry_price 50k and current price 30k has unrealized PnL:
      // For longs: (30k - 50k) / 50k * size = -40% of size
      // If -40% of size > collateral, it's liquidatable
      const pnlBps = ((30_000n - 50_000n) * 10_000n) / 50_000n; // -4000 bps
      const unrealizedLoss = (pos.size * (-pnlBps)) / 10_000n;
      if (unrealizedLoss > pos.collateral * 9n / 10n) {
        liquidatable++;
      } else {
        healthy++;
      }
    } catch {
      // Position may not exist if open failed
      errors++;
    }
  }

  log("Liquidatable", liquidatable);
  log("Healthy", healthy);
  log("Errors/missing", errors);

  assertGt(BigInt(liquidatable), 50n, "Most high-leverage positions should be liquidatable after 40% crash");

  const freeAfter = await f.freeLiquidity();
  log("Free liquidity after crash", `${freeAfter / USDC_UNIT} USDC`);

  log("READY", "Start the keeper to liquidate unhealthy positions: make keeper");
}

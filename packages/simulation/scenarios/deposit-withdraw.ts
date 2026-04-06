import type { Fixture } from "../src/fixture.js";
import { assertGt, assertApprox, log } from "../src/assert.js";
import { USDC_UNIT } from "../src/constants.js";

/**
 * Basic LP lifecycle: deposit USDC into vault, verify shares, withdraw.
 */
export default async function depositWithdraw(f: Fixture) {
  const depositAmount = 50_000n * USDC_UNIT;

  // 1. Create an LP with USDC
  const lp = await f.createFundedTrader(depositAmount);
  const balBefore = await f.usdcBalance(lp.publicKey());
  log("LP USDC balance", balBefore);
  assertGt(balBefore, 0n, "LP should have USDC");

  // 2. Deposit into vault
  const shares = await f.depositVault(lp, depositAmount);
  log("Shares received", shares);
  assertGt(shares, 0n, "LP must receive vault shares");

  // 3. Verify vault state
  const totalAssets = await f.vaultTotalAssets();
  log("Vault total_assets", totalAssets);
  assertGt(totalAssets, 0n, "Vault must have assets after deposit");

  const freeLiq = await f.freeLiquidity();
  log("Vault free_liquidity", freeLiq);
  assertGt(freeLiq, 0n, "Vault should have free liquidity");

  // 4. Redeem shares back
  const assetsBack = await f.redeemVault(lp, shares);
  log("Assets redeemed", assetsBack);
  assertApprox(assetsBack, depositAmount, 100, "Should get ~same USDC back (within 1%)");

  // 5. Verify LP balance restored
  const balAfter = await f.usdcBalance(lp.publicKey());
  log("LP USDC balance after", balAfter);
  assertApprox(balAfter, depositAmount, 100, "LP balance should be ~restored");

  log("OK", "Deposit-withdraw lifecycle complete");
}

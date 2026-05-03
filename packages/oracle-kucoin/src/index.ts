import "dotenv/config";
import { getNetworkConfig, type Network } from "@stellars/config";
import { runOracleLoop } from "@stellars/oracle-base";
import { kucoinSource } from "./source.js";

/**
 * Tickers this oracle instance publishes. Edit this list to add/remove
 * markets — the deploy script registers any ticker named here as a primary
 * source on the OracleRouter, and the corresponding source mapping must
 * exist in source.ts.
 */
const TICKERS = ["BTCUSD", "ETHUSD"];

async function main() {
  const network = (process.env.NETWORK ?? "local") as Network;
  const oracleContract = getNetworkConfig(network).contracts.kucoinOracle.address;

  await runOracleLoop({
    source: kucoinSource,
    tickers: TICKERS,
    oracleContract,
    secretEnv: "KUCOIN_ORACLE_SECRET",
  });
}

main().catch((err) => {
  console.error("[kucoin] Fatal:", err);
  process.exit(1);
});

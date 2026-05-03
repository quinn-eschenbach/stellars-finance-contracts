import "dotenv/config";
import { getNetworkConfig, type Network } from "@stellars/config";
import { runOracleLoop } from "@stellars/oracle-base";
import { binanceSource } from "./source.js";

/**
 * Tickers this oracle instance publishes. Edit this list to add/remove
 * markets — the deploy script registers any ticker named here as a primary
 * source on the OracleRouter, and the corresponding source mapping must
 * exist in source.ts.
 */
const TICKERS = ["BTCUSD", "ETHUSD"];

async function main() {
  const network = (process.env.NETWORK ?? "local") as Network;
  const oracleContract = getNetworkConfig(network).contracts.binanceOracle.address;

  await runOracleLoop({
    source: binanceSource,
    tickers: TICKERS,
    oracleContract,
    secretEnv: "BINANCE_ORACLE_SECRET",
  });
}

main().catch((err) => {
  console.error("[binance] Fatal:", err);
  process.exit(1);
});

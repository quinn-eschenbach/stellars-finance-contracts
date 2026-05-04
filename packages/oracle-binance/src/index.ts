import "dotenv/config";
import { getNetworkConfig, type Network } from "@stellars/config";
import { runOracleLoop } from "@stellars/oracle-base";
import { binanceSource } from "./source.js";

async function main() {
  const network = (process.env.NETWORK ?? "local") as Network;
  const networkConfig = getNetworkConfig(network);

  await runOracleLoop({
    source: binanceSource,
    tickers: [...networkConfig.tickers],
    oracleContract: networkConfig.contracts.binanceOracle.address,
    secretEnv: "BINANCE_ORACLE_SECRET",
  });
}

main().catch((err) => {
  console.error("[binance] Fatal:", err);
  process.exit(1);
});

import "dotenv/config";
import { getNetworkConfig, type Network } from "@stellars/config";
import { runOracleLoop } from "@stellars/oracle-base";
import { kucoinSource } from "./source.js";

async function main() {
  const network = (process.env.NETWORK ?? "local") as Network;
  const networkConfig = getNetworkConfig(network);

  await runOracleLoop({
    source: kucoinSource,
    tickers: [...networkConfig.tickers],
    oracleContract: networkConfig.contracts.kucoinOracle.address,
    secretEnv: "KUCOIN_ORACLE_SECRET",
  });
}

main().catch((err) => {
  console.error("[kucoin] Fatal:", err);
  process.exit(1);
});

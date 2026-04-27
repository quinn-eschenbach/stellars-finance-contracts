import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as PositionManagerClient } from "@stellars/bindings/position-manager";
import type { KeeperConfig } from "./config.js";

export interface Executor {
  publicKey: string;
  updateIndices(symbol: string): Promise<boolean>;
  liquidatePosition(trader: string, symbol: string): Promise<boolean>;
  executeOrder(trader: string, symbol: string): Promise<boolean>;
  deleveragePosition(trader: string, symbol: string): Promise<boolean>;
}

export function createExecutor(config: KeeperConfig): Executor {
  const kp = Keypair.fromSecret(config.keeperSecret);
  const publicKey = kp.publicKey();
  const { signTransaction, signAuthEntry } = basicNodeSigner(kp, config.networkPassphrase);

  const client = new PositionManagerClient({
    contractId: config.contracts.positionManager.address,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey,
    signTransaction,
    signAuthEntry,
    allowHttp: config.rpcUrl.startsWith("http://"),
  });

  async function submit(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      const tx = await fn();
      // signAndSend is called on the AssembledTransaction returned by the client method
      await (tx as any).signAndSend();
      console.log(`[keeper] ${label} — submitted`);
      return true;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isExpected =
        msg.includes("HealthFactorOk") ||
        msg.includes("OrderNotTriggered") ||
        msg.includes("AdlNotTriggered") ||
        msg.includes("PositionNotFound") ||
        msg.includes("PositionNotOldEnough");
      if (isExpected) {
        console.log(`[keeper] ${label} — skipped (${msg})`);
      } else {
        console.error(`[keeper] ${label} — error:`, msg);
      }
      return false;
    }
  }

  return {
    publicKey,

    updateIndices(symbol) {
      return submit(`update_indices(${symbol})`, () =>
        client.update_indices({ caller: publicKey, symbol }),
      );
    },

    liquidatePosition(trader, symbol) {
      return submit(`liquidate(${trader.slice(0, 8)}…, ${symbol})`, () =>
        client.liquidate_position({ caller: publicKey, trader, symbol }),
      );
    },

    executeOrder(trader, symbol) {
      return submit(`execute_order(${trader.slice(0, 8)}…, ${symbol})`, () =>
        client.execute_order({ caller: publicKey, trader, symbol }),
      );
    },

    deleveragePosition(trader, symbol) {
      return submit(`adl(${trader.slice(0, 8)}…, ${symbol})`, () =>
        client.deleverage_position({ caller: publicKey, trader, symbol }),
      );
    },
  };
}

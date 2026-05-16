import { Keypair, xdr, scValToNative } from "@stellar/stellar-sdk";
import { client } from "@stellars/protocol-clients";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  getDb,
  indexerCursor,
  trades,
  type Db,
} from "@stellars/db";

import { Client as VaultClient } from "../../bindings/vault/src/index.js";
import { Client as PositionManagerClient } from "../../bindings/position-manager/src/index.js";
import { Client as ConfigManagerClient } from "../../bindings/config-manager/src/index.js";
import { Client as OracleRouterClient } from "../../bindings/oracle-router/src/index.js";
import { Client as OracleClient } from "../../bindings/oracle/src/index.js";
import { Client as MockTokenClient } from "../../bindings/mock-token/src/index.js";

import {
  NETWORK_PASSPHRASE,
  DEFAULT_RPC_URL,
  DEFAULT_FEE,
  DEFAULT_TIMEOUT,
  PRECISION,
  USDC_UNIT,
} from "./constants.js";
import { createKeypair, createSigner, fundAccount, createFundedUsers } from "./signer.js";

interface EnvConfig {
  rpcUrl: string;
  vaultContract: string;
  pmContract: string;
  cmContract: string;
  orContract: string;
  oracleContract: string;
  mockTokenContract: string;
  adminAddress: string;
}

interface AddressesFile {
  [network: string]: {
    rpcUrl: string;
    networkPassphrase: string;
    contracts: {
      vault: { address: string };
      positionManager: { address: string };
      configManager: { address: string };
      oracleRouter: { address: string };
      oracle: { address: string };
    };
  };
}

function parseDotEnv(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return vars;
}

function loadEnvLocal(): EnvConfig {
  const root = resolve(import.meta.dirname, "..", "..", "..");
  const envVars = parseDotEnv(resolve(root, ".env.local"));
  const network = envVars["NETWORK"] ?? "local";

  const addressesPath = resolve(root, "packages", "config", "addresses.json");
  const addresses = JSON.parse(readFileSync(addressesPath, "utf-8")) as AddressesFile;
  const net = addresses[network];
  if (!net) {
    throw new Error(`addresses.json: network "${network}" not found`);
  }
  const c = net.contracts;

  const missing = (Object.entries({
    vault: c.vault.address,
    positionManager: c.positionManager.address,
    configManager: c.configManager.address,
    oracleRouter: c.oracleRouter.address,
    oracle: c.oracle.address,
  }) as [string, string][])
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `addresses.json[${network}] missing contract addresses: ${missing.join(", ")}. Run 'make deploy' first.`,
    );
  }

  const mockTokenContract = envVars["MOCK_TOKEN_CONTRACT"] ?? "";
  if (!mockTokenContract) {
    throw new Error(`.env.local missing MOCK_TOKEN_CONTRACT. Run 'make deploy' first.`);
  }

  return {
    rpcUrl: net.rpcUrl ?? envVars["RPC_URL"] ?? DEFAULT_RPC_URL,
    vaultContract: c.vault.address,
    pmContract: c.positionManager.address,
    cmContract: c.configManager.address,
    orContract: c.oracleRouter.address,
    oracleContract: c.oracle.address,
    mockTokenContract,
    adminAddress: envVars["ADMIN_ADDRESS"] ?? "",
  };
}

function getAdminKeypair(): Keypair {
  const secret = execSync("stellar keys show admin", { encoding: "utf-8" }).trim();
  return Keypair.fromSecret(secret);
}

/**
 * Submit an AssembledTransaction and ensure it actually succeeded on-chain.
 *
 * SDK gotcha: `await tx.signAndSend()` resolves successfully for transactions
 * that were INCLUDED in a ledger but FAILED (panicked) — the SentTransaction's
 * `result` getter throws only when explicitly accessed. Without this check,
 * fixture callers see no error from a panicked tx and the sim happily
 * proceeds with state that doesn't reflect on-chain reality.
 */
/**
 * Decode a TransactionResult XDR into a short human-readable summary of
 * why the tx failed. Soroban tx failures sit a few enum levels deep; this
 * walks them so we don't have to ask the user to run `stellar lab xdr decode`.
 */
function describeTxFailure(resultXdrB64: string | undefined): string {
  if (!resultXdrB64) return "<no resultXdr>";
  try {
    const tr = xdr.TransactionResult.fromXDR(resultXdrB64, "base64");
    const codeName = tr.result().switch().name;
    const ops = (tr.result().value() as { tr?: () => unknown }[] | undefined) ?? [];
    if (!ops.length || codeName !== "txFailed") return codeName;
    // Drill into the first op result.
    const op = ops[0];
    const innerTr = (op as { tr?: () => unknown }).tr?.() as
      | { switch: () => { name: string }; value: () => unknown }
      | undefined;
    if (!innerTr) return codeName;
    const opType = innerTr.switch().name;
    if (opType === "invokeHostFunction") {
      const ihf = innerTr.value() as { switch: () => { name: string } };
      return `${codeName} → ${opType} → ${ihf.switch().name}`;
    }
    return `${codeName} → ${opType}`;
  } catch (err) {
    return `<unparseable: ${(err as Error).message}>`;
  }
}

/**
 * Pull human-readable strings out of Soroban diagnostic events. Looks for
 * the budget-exceeded variant (which carries a body describing which
 * budget — cpu / mem / readBytes / writeBytes / etc) and contract error
 * symbols ("Error(Contract, #N)").
 */
function describeDiagnostics(b64Events: string[]): string[] {
  const out: string[] = [];
  for (const b64 of b64Events) {
    try {
      const ev = xdr.DiagnosticEvent.fromXDR(b64, "base64");
      const body = ev.event().body();
      // body() is a union; v0() gives the V0 case.
      const v0 = body.v0();
      const topics = v0
        .topics()
        .map((t) => {
          try {
            return JSON.stringify(scValToNative(t));
          } catch {
            return "?";
          }
        })
        .join(", ");
      let data = "";
      try {
        data = JSON.stringify(scValToNative(v0.data()));
      } catch {
        data = "<unrepr>";
      }
      out.push(`[${topics}] ${data}`);
    } catch {
      out.push(`<unparseable diagnostic>`);
    }
  }
  return out;
}

/**
 * Pad an AssembledTransaction's simulated CPU/memory budget. Compensates for
 * the drift between simulation and execution that occurs when other txs
 * (e.g., the keeper's update_indices) write to ledger entries between sim
 * and inclusion. Without padding, the user's tx fails with
 * scecExceededLimit even though sim said it would fit.
 *
 * Real-world wallets do this same thing at ~1.2-1.5×; we use 1.5× because
 * standalone local has tighter budgets than mainnet.
 */
function padResources(tx: any, factor = 1.5): void {
  const orig = tx.simulationTransactionData as InstanceType<typeof xdr.SorobanTransactionData>;
  if (!orig) return;
  const origRes = orig.resources();
  const padded = new xdr.SorobanTransactionData({
    ext: orig.ext(),
    resources: new xdr.SorobanResources({
      footprint: origRes.footprint(),
      instructions: Math.ceil(origRes.instructions() * factor),
      diskReadBytes: Math.ceil(origRes.diskReadBytes() * factor),
      writeBytes: Math.ceil(origRes.writeBytes() * factor),
    }),
    resourceFee: orig.resourceFee(),
  });
  tx.simulationTransactionData = padded;
}

/**
 * Build → simulate → pad → sign → send, with automatic retry on transient
 * resource-budget failures caused by sim/execute drift.
 *
 * @param build  Async builder that returns a fresh AssembledTransaction.
 *               Called once per attempt so each retry re-simulates against
 *               the current chain state (otherwise we'd just retry with
 *               the same stale resource budget).
 */
async function sendWithRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => Promise<any>,
  label: string,
  maxAttempts = 3,
): Promise<unknown> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tx = await build();
    padResources(tx);
    try {
      return await sendAndCheckOnce(tx, label);
    } catch (err) {
      lastErr = err as Error;
      const msg = lastErr.message ?? "";
      const isResourceDrift =
        msg.includes("scecExceededLimit") ||
        msg.includes("ResourceLimitExceeded") ||
        msg.includes("invokeHostFunctionResourceLimitExceeded");
      if (!isResourceDrift || attempt === maxAttempts) throw lastErr;
      console.warn(
        `  [retry] ${label} attempt ${attempt}/${maxAttempts} hit resource drift, retrying with fresh sim…`,
      );
    }
  }
  throw lastErr ?? new Error(`${label}: unknown failure after ${maxAttempts} attempts`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendAndCheckOnce(tx: any, label: string): Promise<unknown> {
  const sent = await tx.signAndSend();
  const status: string | undefined = sent.getTransactionResponse?.status;
  if (status === "SUCCESS") {
    try {
      return sent.result;
    } catch (err) {
      throw new Error(
        `${label} succeeded on-chain but result parse failed: ${(err as Error).message}`,
      );
    }
  }

  const txHash: string = sent.sendTransactionResponse?.hash ?? "unknown";
  const diagsRaw: { toXDR: (fmt?: string) => string | Buffer }[] =
    sent.getTransactionResponse?.diagnosticEventsXdr ?? [];
  const diagsB64 = diagsRaw.map((d) => String(d.toXDR("base64")));
  const resultXdr: string | undefined = sent.getTransactionResponse?.resultXdr?.toXDR(
    "base64",
  );

  const failure = describeTxFailure(resultXdr);
  const diagDescs = describeDiagnostics(diagsB64);
  // Surface only the diagnostics that look like errors / budget breaches —
  // most are noise (fn_call/fn_return). Keep up to 5 most relevant.
  const interesting = diagDescs
    .filter((d) => /error|budget|exceeded|panic|trap/i.test(d))
    .slice(0, 5);

  throw new Error(
    `${label} failed on-chain (status=${status ?? "unknown"}, tx=${txHash})\n` +
      `  reason: ${failure}\n` +
      `  diagnostics (${diagDescs.length} total, ${interesting.length} interesting):\n` +
      interesting.map((d) => `    ${d}`).join("\n") +
      `\n  full resultXdr: ${resultXdr ?? "<none>"}`,
  );
}

/**
 * The SDK returns a Rust-style `Err` object for contract panics on read
 * methods that have errorTypes generated. The object is truthy, so naive
 * truthiness checks miss it. Detect Err and translate to null.
 */
function unwrapOrNull<T>(result: T | { isErr?: () => boolean }): T | null {
  if (
    result &&
    typeof result === "object" &&
    "isErr" in result &&
    typeof (result as { isErr: () => boolean }).isErr === "function" &&
    (result as { isErr: () => boolean }).isErr()
  ) {
    return null;
  }
  return result as T;
}

export class Fixture {
  readonly env: EnvConfig;
  readonly adminKp: Keypair;

  readonly vault: VaultClient;
  readonly positionManager: PositionManagerClient;
  readonly configManager: ConfigManagerClient;
  readonly oracleRouter: OracleRouterClient;
  readonly oracle: OracleClient;
  readonly mockToken: MockTokenClient;

  private constructor(env: EnvConfig, adminKp: Keypair) {
    this.env = env;
    this.adminKp = adminKp;

    this.vault = this.clientFor(VaultClient, adminKp, env.vaultContract);
    this.positionManager = this.clientFor(PositionManagerClient, adminKp, env.pmContract);
    this.configManager = this.clientFor(ConfigManagerClient, adminKp, env.cmContract);
    this.oracleRouter = this.clientFor(OracleRouterClient, adminKp, env.orContract);
    this.oracle = this.clientFor(OracleClient, adminKp, env.oracleContract);
    this.mockToken = this.clientFor(MockTokenClient, adminKp, env.mockTokenContract);
  }

  static load(): Fixture {
    const env = loadEnvLocal();
    const adminKp = getAdminKeypair();

    console.log(`[fixture] RPC: ${env.rpcUrl}`);
    console.log(`[fixture] Admin: ${env.adminAddress}`);
    console.log(`[fixture] Vault: ${env.vaultContract}`);
    console.log(`[fixture] PM:    ${env.pmContract}`);

    return new Fixture(env, adminKp);
  }

  // ---------------------------------------------------------------------------
  // Client helpers
  // ---------------------------------------------------------------------------

  private clientFor<C>(
    ClientClass: new (opts: any) => C,
    kp: Keypair,
    contractId: string,
  ): C {
    return client(
      ClientClass,
      { rpcUrl: this.env?.rpcUrl ?? DEFAULT_RPC_URL, networkPassphrase: NETWORK_PASSPHRASE },
      contractId,
      createSigner(kp),
    );
  }

  /** Create a PositionManager client signed by the given keypair. */
  pmFor(kp: Keypair): PositionManagerClient {
    return this.clientFor(PositionManagerClient, kp, this.env.pmContract);
  }

  /** Create a Vault client signed by the given keypair. */
  vaultFor(kp: Keypair): VaultClient {
    return this.clientFor(VaultClient, kp, this.env.vaultContract);
  }

  /** Create a MockToken client signed by the given keypair. */
  tokenFor(kp: Keypair): MockTokenClient {
    return this.clientFor(MockTokenClient, kp, this.env.mockTokenContract);
  }

  // ---------------------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------------------

  async mintUsdc(to: string, amount: bigint): Promise<void> {
    await sendWithRetry(
      () => this.mockToken.mint({ to, amount }),
      `mintUsdc(${to.slice(0, 8)}…, ${amount})`,
    );
  }

  async usdcBalance(address: string): Promise<bigint> {
    const tx = await this.mockToken.balance({ account: address });
    return tx.result;
  }

  // ---------------------------------------------------------------------------
  // Vault helpers
  // ---------------------------------------------------------------------------

  async depositVault(kp: Keypair, amount: bigint): Promise<bigint> {
    const client = this.vaultFor(kp);
    const pub = kp.publicKey();
    const tx = await client.deposit({ assets: amount, receiver: pub, from: pub, operator: pub });
    const result = await tx.signAndSend();
    return result.result;
  }

  async withdrawVault(kp: Keypair, assets: bigint): Promise<bigint> {
    const client = this.vaultFor(kp);
    const pub = kp.publicKey();
    const tx = await client.withdraw({ assets, receiver: pub, owner: pub, operator: pub });
    const result = await tx.signAndSend();
    return result.result;
  }

  async redeemVault(kp: Keypair, shares: bigint): Promise<bigint> {
    const client = this.vaultFor(kp);
    const pub = kp.publicKey();
    const tx = await client.redeem({ shares, receiver: pub, owner: pub, operator: pub });
    const result = await tx.signAndSend();
    return result.result;
  }

  async vaultTotalAssets(): Promise<bigint> {
    const tx = await this.vault.total_assets();
    return tx.result;
  }

  async freeLiquidity(): Promise<bigint> {
    const tx = await this.vault.free_liquidity();
    return tx.result;
  }

  // ---------------------------------------------------------------------------
  // Position helpers
  // ---------------------------------------------------------------------------

  async openLong(
    kp: Keypair,
    symbol: string,
    size: bigint,
    collateral: bigint,
    takeProfit = 0n,
    stopLoss = 0n,
  ): Promise<void> {
    const client = this.pmFor(kp);
    await sendWithRetry(
      () =>
        client.increase_position({
          trader: kp.publicKey(),
          symbol,
          size,
          collateral,
          is_long: true,
          take_profit: takeProfit,
          stop_loss: stopLoss,
        }),
      `openLong(${kp.publicKey().slice(0, 8)}…, ${symbol})`,
    );
  }

  async openShort(
    kp: Keypair,
    symbol: string,
    size: bigint,
    collateral: bigint,
    takeProfit = 0n,
    stopLoss = 0n,
  ): Promise<void> {
    const client = this.pmFor(kp);
    await sendWithRetry(
      () =>
        client.increase_position({
          trader: kp.publicKey(),
          symbol,
          size,
          collateral,
          is_long: false,
          take_profit: takeProfit,
          stop_loss: stopLoss,
        }),
      `openShort(${kp.publicKey().slice(0, 8)}…, ${symbol})`,
    );
  }

  async closePosition(kp: Keypair, symbol: string, sizeDelta: bigint): Promise<void> {
    const client = this.pmFor(kp);
    await sendWithRetry(
      () => client.decrease_position({ trader: kp.publicKey(), symbol, size_delta: sizeDelta, acceptable_price: 0n }),
      `closePosition(${kp.publicKey().slice(0, 8)}…, ${symbol})`,
    );
  }

  async liquidate(callerKp: Keypair, traderAddress: string, symbol: string): Promise<void> {
    const client = this.pmFor(callerKp);
    await sendWithRetry(
      () =>
        client.liquidate_position({
          caller: callerKp.publicKey(),
          trader: traderAddress,
          symbol,
        }),
      `liquidate(${traderAddress.slice(0, 8)}…, ${symbol})`,
    );
  }

  async getPosition(trader: string, symbol: string) {
    const tx = await this.positionManager.get_position({ trader, symbol });
    // tx.result returns the Position on success, but for contract panics
    // (e.g. PositionNotFound) the SDK wraps the error in a Rust-style Err
    // object that is *truthy* — naive `if (!pos)` checks miss it. Surface
    // explicit nulls so callers can do `if (!pos) ...`.
    return unwrapOrNull(tx.result);
  }

  async getMarket(symbol: string) {
    const tx = await this.positionManager.get_market({ symbol });
    return tx.result;
  }

  // ---------------------------------------------------------------------------
  // Oracle helpers
  // ---------------------------------------------------------------------------

  /** Set mock oracle price. `priceUsd` is in whole dollars (e.g. 50_000). */
  async setPrice(symbol: string, priceUsd: bigint): Promise<void> {
    const scaled = priceUsd * PRECISION;
    await sendWithRetry(
      () => this.oracle.set_price({ caller: this.adminKp.publicKey(), symbol, price: scaled }),
      `setPrice(${symbol}, ${priceUsd})`,
    );
  }

  async getPrice(symbol: string): Promise<bigint> {
    const tx = await this.oracleRouter.get_price({ symbol });
    return tx.result;
  }

  // ---------------------------------------------------------------------------
  // User lifecycle helpers
  // ---------------------------------------------------------------------------

  /** Create a single funded trader — new keypair, friendbot XLM, minted USDC. */
  async createFundedTrader(usdcAmount: bigint): Promise<Keypair> {
    const kp = createKeypair();
    await fundAccount(kp.publicKey());
    await this.mintUsdc(kp.publicKey(), usdcAmount);
    return kp;
  }

  /** Create `count` funded traders in sequence. Saves keypairs to state/ for cleanup. */
  async createFundedUsers(count: number, usdcPerUser: bigint): Promise<Keypair[]> {
    return createFundedUsers(
      (to, amount) => this.mintUsdc(to, amount),
      count,
      usdcPerUser,
    );
  }

  // ---------------------------------------------------------------------------
  // Indexer DB helpers (sim assertions)
  // ---------------------------------------------------------------------------

  private _db: Db | null = null;

  /** Lazy-init drizzle Db. Used by scenarios for on-disk state assertions. */
  db(): Db {
    if (!this._db) this._db = getDb();
    return this._db;
  }

  /**
   * Wait for the indexer to catch up. Polls indexer_cursor.last_ledger_close_time
   * and returns once lag (now - close_time) is below maxLagSec. Throws on timeout.
   */
  async waitForIndexer({ maxLagSec = 5, timeoutMs = 30_000 } = {}): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await this.db()
        .select()
        .from(indexerCursor)
        .where(eq(indexerCursor.id, 1))
        .limit(1);
      const cursor = rows[0];
      if (cursor) {
        const closeTime = Number(cursor.last_ledger_close_time);
        const lagSec = Math.floor(Date.now() / 1000) - closeTime;
        if (closeTime > 0 && lagSec <= maxLagSec) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`waitForIndexer: indexer did not catch up within ${timeoutMs}ms`);
  }

  /**
   * Wait until the keeper has done at least `expectAtLeast` actions
   * (liquidations / orders / ADLs) AND the count has been stable for
   * `stableMs`. Throws on timeout.
   *
   * Why both conditions: a naive "stable for N seconds" returns prematurely
   * when the keeper hasn't started yet — a count of 0 that stays at 0 for
   * 10s isn't "settled", it's "hasn't woken up". Requiring a minimum count
   * ensures we wait through the indexer-lag → keeper-detect → submit
   * pipeline before considering the wait complete.
   *
   * For scenarios that expect ZERO keeper events (e.g. normal-usage) leave
   * expectAtLeast=0; the function then degrades to the old behavior and
   * returns once stableMs of inactivity has been observed from the start.
   */
  async waitForKeeperToSettle({
    expectAtLeast = 0,
    timeoutMs = 180_000,
    stableMs = 8_000,
  } = {}): Promise<void> {
    const start = Date.now();
    let lastCount = -1;
    let lastChange = Date.now();

    while (Date.now() - start < timeoutMs) {
      const now = await this.countKeeperEvents();
      if (now !== lastCount) {
        lastCount = now;
        lastChange = Date.now();
      }
      if (now >= expectAtLeast && Date.now() - lastChange >= stableMs) return;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(
      `waitForKeeperToSettle: did not reach expectAtLeast=${expectAtLeast} within ${timeoutMs}ms ` +
        `(last count=${lastCount})`,
    );
  }

  /** Count of keeper-driven trade rows in the indexer DB. */
  async countKeeperEvents(): Promise<number> {
    const result = await this.db()
      .select({ count: sql<number>`count(*)::int` })
      .from(trades)
      .where(sql`${trades.event_type} IN ('liquidation', 'order', 'adl')`);
    return Number(result[0]?.count ?? 0);
  }

  async countTradesByType(eventType: string): Promise<number> {
    const result = await this.db()
      .select({ count: sql<number>`count(*)::int` })
      .from(trades)
      .where(eq(trades.event_type, eventType));
    return Number(result[0]?.count ?? 0);
  }
}

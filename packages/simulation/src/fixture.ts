import { Keypair } from "@stellar/stellar-sdk";
import type { ContractClientOptions } from "@stellar/stellar-sdk/contract";
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendAndCheck(tx: any, label: string): Promise<unknown> {
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

  // Surface as much detail as we can about the on-chain failure. Soroban
  // contract panics live in diagnosticEventsXdr — extract the error code
  // string from there if present.
  const txHash: string = sent.sendTransactionResponse?.hash ?? "unknown";
  const diags: { toXDR: (fmt?: string) => string | Buffer }[] =
    sent.getTransactionResponse?.diagnosticEventsXdr ?? [];
  const diagsB64 = diags.map((d) => String(d.toXDR("base64")));
  const resultXdr: string | undefined = sent.getTransactionResponse?.resultXdr?.toXDR(
    "base64",
  );

  const contractErrMatch = diagsB64
    .map((b) => Buffer.from(b, "base64").toString("binary"))
    .join(" ")
    .match(/contract.{0,5}#?(\d+)/i);

  throw new Error(
    `${label} failed on-chain (status=${status ?? "unknown"} tx=${txHash})\n` +
      `  resultXdr: ${resultXdr ?? "<none>"}\n` +
      `  diagnostics: ${diagsB64.length} event(s)\n` +
      (contractErrMatch ? `  parsed contract error code: ${contractErrMatch[1]}\n` : "") +
      `  Decode resultXdr: stellar lab xdr decode --type TransactionResult --xdr ${resultXdr ?? ""}`,
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

    const adminOpts = this.clientOpts(adminKp, env.vaultContract);
    this.vault = new VaultClient({ ...adminOpts, contractId: env.vaultContract });
    this.positionManager = new PositionManagerClient({ ...adminOpts, contractId: env.pmContract });
    this.configManager = new ConfigManagerClient({ ...adminOpts, contractId: env.cmContract });
    this.oracleRouter = new OracleRouterClient({ ...adminOpts, contractId: env.orContract });
    this.oracle = new OracleClient({ ...adminOpts, contractId: env.oracleContract });
    this.mockToken = new MockTokenClient({ ...adminOpts, contractId: env.mockTokenContract });
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

  private clientOpts(kp: Keypair, contractId: string): ContractClientOptions {
    const signer = createSigner(kp);
    return {
      contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: this.env?.rpcUrl ?? DEFAULT_RPC_URL,
      publicKey: signer.publicKey,
      signTransaction: signer.signTransaction,
      signAuthEntry: signer.signAuthEntry,
      allowHttp: true,
    };
  }

  /** Create a PositionManager client signed by the given keypair. */
  pmFor(kp: Keypair): PositionManagerClient {
    return new PositionManagerClient(this.clientOpts(kp, this.env.pmContract));
  }

  /** Create a Vault client signed by the given keypair. */
  vaultFor(kp: Keypair): VaultClient {
    return new VaultClient(this.clientOpts(kp, this.env.vaultContract));
  }

  /** Create a MockToken client signed by the given keypair. */
  tokenFor(kp: Keypair): MockTokenClient {
    return new MockTokenClient(this.clientOpts(kp, this.env.mockTokenContract));
  }

  // ---------------------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------------------

  async mintUsdc(to: string, amount: bigint): Promise<void> {
    const tx = await this.mockToken.mint({ to, amount });
    await sendAndCheck(tx, `mintUsdc(${to.slice(0, 8)}…, ${amount})`);
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
    const tx = await client.increase_position({
      trader: kp.publicKey(),
      symbol,
      size,
      collateral,
      is_long: true,
      take_profit: takeProfit,
      stop_loss: stopLoss,
    });
    await sendAndCheck(tx, `openLong(${kp.publicKey().slice(0, 8)}…, ${symbol})`);
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
    const tx = await client.increase_position({
      trader: kp.publicKey(),
      symbol,
      size,
      collateral,
      is_long: false,
      take_profit: takeProfit,
      stop_loss: stopLoss,
    });
    await sendAndCheck(tx, `openShort(${kp.publicKey().slice(0, 8)}…, ${symbol})`);
  }

  async closePosition(kp: Keypair, symbol: string, sizeDelta: bigint): Promise<void> {
    const client = this.pmFor(kp);
    const tx = await client.decrease_position({
      trader: kp.publicKey(),
      symbol,
      size_delta: sizeDelta,
    });
    await sendAndCheck(tx, `closePosition(${kp.publicKey().slice(0, 8)}…, ${symbol})`);
  }

  async liquidate(callerKp: Keypair, traderAddress: string, symbol: string): Promise<void> {
    const client = this.pmFor(callerKp);
    const tx = await client.liquidate_position({
      caller: callerKp.publicKey(),
      trader: traderAddress,
      symbol,
    });
    await sendAndCheck(tx, `liquidate(${traderAddress.slice(0, 8)}…, ${symbol})`);
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
    const tx = await this.oracle.set_price({
      caller: this.adminKp.publicKey(),
      symbol,
      price: scaled,
    });
    await sendAndCheck(tx, `setPrice(${symbol}, ${priceUsd})`);
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
   * Wait until no new keeper-emitted trades have appeared for `stableMs`.
   * Counts rows in `trades` where event_type ∈ {liquidation, order, adl} —
   * any keeper-driven action. Returns when the count plateaus.
   *
   * Tuned for the ledger-close ceiling of ~12 keeper actions/min — set
   * timeoutMs generously when expecting many liquidations.
   */
  async waitForKeeperToSettle({
    timeoutMs = 180_000,
    stableMs = 8_000,
  } = {}): Promise<void> {
    const start = Date.now();
    let lastCount = await this.countKeeperEvents();
    let lastChange = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const now = await this.countKeeperEvents();
      if (now > lastCount) {
        lastCount = now;
        lastChange = Date.now();
      }
      if (Date.now() - lastChange >= stableMs) return;
    }
    throw new Error(`waitForKeeperToSettle: still seeing activity after ${timeoutMs}ms`);
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

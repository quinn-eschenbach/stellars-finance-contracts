import { Keypair } from "@stellar/stellar-sdk";
import type { ContractClientOptions } from "@stellar/stellar-sdk/contract";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client as VaultClient } from "../../bindings/vault/src/index.js";
import { Client as PositionManagerClient } from "../../bindings/position-manager/src/index.js";
import { Client as ConfigManagerClient } from "../../bindings/config-manager/src/index.js";
import { Client as OracleRouterClient } from "../../bindings/oracle-router/src/index.js";
import { Client as MockOracleClient } from "../../bindings/mock-oracle/src/index.js";
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

function loadEnvLocal(): EnvConfig {
  const envPath = resolve(import.meta.dirname, "..", "..", "..", ".env.local");
  const content = readFileSync(envPath, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }

  return {
    rpcUrl: vars["RPC_URL"] ?? DEFAULT_RPC_URL,
    vaultContract: vars["VAULT_CONTRACT"] ?? "",
    pmContract: vars["PM_CONTRACT"] ?? "",
    cmContract: vars["CM_CONTRACT"] ?? "",
    orContract: vars["OR_CONTRACT"] ?? "",
    oracleContract: vars["ORACLE_CONTRACT"] ?? "",
    mockTokenContract: vars["MOCK_TOKEN_CONTRACT"] ?? "",
    adminAddress: vars["ADMIN_ADDRESS"] ?? "",
  };
}

function getAdminKeypair(): Keypair {
  const secret = execSync("stellar keys show admin", { encoding: "utf-8" }).trim();
  return Keypair.fromSecret(secret);
}

export class Fixture {
  readonly env: EnvConfig;
  readonly adminKp: Keypair;

  readonly vault: VaultClient;
  readonly positionManager: PositionManagerClient;
  readonly configManager: ConfigManagerClient;
  readonly oracleRouter: OracleRouterClient;
  readonly mockOracle: MockOracleClient;
  readonly mockToken: MockTokenClient;

  private constructor(env: EnvConfig, adminKp: Keypair) {
    this.env = env;
    this.adminKp = adminKp;

    const adminOpts = this.clientOpts(adminKp, env.vaultContract);
    this.vault = new VaultClient({ ...adminOpts, contractId: env.vaultContract });
    this.positionManager = new PositionManagerClient({ ...adminOpts, contractId: env.pmContract });
    this.configManager = new ConfigManagerClient({ ...adminOpts, contractId: env.cmContract });
    this.oracleRouter = new OracleRouterClient({ ...adminOpts, contractId: env.orContract });
    this.mockOracle = new MockOracleClient({ ...adminOpts, contractId: env.oracleContract });
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
    await tx.signAndSend();
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
    await tx.signAndSend();
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
    await tx.signAndSend();
  }

  async closePosition(kp: Keypair, symbol: string, sizeDelta: bigint): Promise<void> {
    const client = this.pmFor(kp);
    const tx = await client.decrease_position({
      trader: kp.publicKey(),
      symbol,
      size_delta: sizeDelta,
    });
    await tx.signAndSend();
  }

  async liquidate(callerKp: Keypair, traderAddress: string, symbol: string): Promise<void> {
    const client = this.pmFor(callerKp);
    const tx = await client.liquidate_position({
      caller: callerKp.publicKey(),
      trader: traderAddress,
      symbol,
    });
    await tx.signAndSend();
  }

  async getPosition(trader: string, symbol: string) {
    const tx = await this.positionManager.get_position({ trader, symbol });
    return tx.result;
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
    const tx = await this.mockOracle.set_price({
      caller: this.adminKp.publicKey(),
      symbol,
      price: scaled,
    });
    await tx.signAndSend();
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
}

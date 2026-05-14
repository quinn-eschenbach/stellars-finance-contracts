import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const ConfigManagerError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"Unauthorized"},
  /**
   * FeeSplits values do not sum to 10_000 bps.
   */
  4: {message:"InvalidFeeSplits"},
  /**
   * One or more ProtocolLimits values are out of acceptable range.
   */
  5: {message:"InvalidLimits"},
  /**
   * `set_upgrade_timelock` called with seconds below `MIN_UPGRADE_TIMELOCK`.
   */
  6: {message:"UpgradeTimelockTooShort"},
  /**
   * `propose_admin(caller, new_admin)` rejected because `caller == new_admin`.
   */
  7: {message:"InvalidAdminProposal"},
  /**
   * `accept_admin` rejected — caller is not the currently pending admin.
   */
  8: {message:"NotPendingAdmin"},
  /**
   * `accept_admin` rejected — there is no pending admin proposal.
   */
  9: {message:"NoPendingAdmin"},
  /**
   * OZ-generated `upgrade()` rejected — no `propose_upgrade` was made
   * before commit. The two-step upgrade flow requires a prior proposal.
   */
  10: {message:"NoPendingUpgrade"},
  /**
   * OZ-generated `upgrade()` rejected — timelock has not elapsed yet.
   */
  11: {message:"UpgradeTimelockNotElapsed"}
}






export type StorageKey = {tag: "Initialized", values: void} | {tag: "Admin", values: void} | {tag: "RoleMember", values: readonly [RoleMemberKey]} | {tag: "FeeSplits", values: void} | {tag: "ProtocolLimits", values: void} | {tag: "BorrowRateConfig", values: void} | {tag: "UpgradeTimelock", values: void} | {tag: "PendingAdmin", values: void} | {tag: "PendingUpgrade", values: void} | {tag: "Version", values: void};


/**
 * Composite key for role membership entries.
 */
export interface RoleMemberKey {
  account: string;
  role: string;
}

export const UpgradeableError = {
  /**
   * When migration is attempted but not allowed due to upgrade state.
   */
  1100: {message:"MigrationNotAllowed"}
}



export const MerkleDistributorError = {
  /**
   * The merkle root is not set.
   */
  1300: {message:"RootNotSet"},
  /**
   * The provided index was already claimed.
   */
  1301: {message:"IndexAlreadyClaimed"},
  /**
   * The proof is invalid.
   */
  1302: {message:"InvalidProof"}
}

/**
 * Storage keys for the data associated with `MerkleDistributor`
 */
export type MerkleDistributorStorageKey = {tag: "Root", values: void} | {tag: "Claimed", values: readonly [u32]};

/**
 * Rounding direction for division operations
 */
export type Rounding = {tag: "Floor", values: void} | {tag: "Ceil", values: void} | {tag: "Truncate", values: void};

export const SorobanFixedPointError = {
  /**
   * Arithmetic overflow occurred
   */
  1500: {message:"Overflow"},
  /**
   * Division by zero
   */
  1501: {message:"DivisionByZero"}
}

export const CryptoError = {
  /**
   * The merkle proof length is out of bounds.
   */
  1400: {message:"MerkleProofOutOfBounds"},
  /**
   * The index of the leaf is out of bounds.
   */
  1401: {message:"MerkleIndexOutOfBounds"},
  /**
   * No data in hasher state.
   */
  1402: {message:"HasherEmptyState"}
}



export const PausableError = {
  /**
   * The operation failed because the contract is paused.
   */
  1000: {message:"EnforcedPause"},
  /**
   * The operation failed because the contract is not paused.
   */
  1001: {message:"ExpectedPause"}
}

/**
 * Storage key for the pausable state
 */
export type PausableStorageKey = {tag: "Paused", values: void};


/**
 * Represents a single trader's open leveraged position.
 */
export interface Position {
  /**
 * USDC collateral deposited by the trader.
 */
collateral: i128;
  /**
 * Global borrow accumulator index at position open (for lazy fee calc).
 */
entry_borrow_index: i128;
  /**
 * Global funding accumulator index at position open (for lazy fee calc).
 */
entry_funding_index: i128;
  /**
 * Oracle price at the time the position was opened (scaled by 1e7).
 */
entry_price: i128;
  /**
 * True for a long position, false for a short.
 */
is_long: boolean;
  /**
 * Block timestamp when the position was last increased (anti-front-running lock).
 */
last_increased_time: u64;
  /**
 * Notional size of the position in USDC.
 */
size: i128;
  /**
 * Stop-loss price (scaled by 1e7). 0 = not set.
 */
stop_loss: i128;
  /**
 * Take-profit price (scaled by 1e7). 0 = not set.
 */
take_profit: i128;
}


/**
 * Global market state for a single tradeable asset symbol.
 */
export interface MarketInfo {
  /**
 * Cumulative borrow fee index (grows monotonically with time).
 */
acc_borrow_index: i128;
  /**
 * Cumulative funding rate index (signed; positive = longs pay shorts).
 */
acc_funding_index: i128;
  /**
 * Volume-weighted average entry price of all active long positions.
 */
global_long_avg_price: i128;
  /**
 * Volume-weighted average entry price of all active short positions.
 */
global_short_avg_price: i128;
  /**
 * Timestamp of the last keeper index update.
 */
last_index_update: u64;
  /**
 * Total notional size of all open long positions.
 */
long_open_interest: i128;
  /**
 * Total notional size of all open short positions.
 */
short_open_interest: i128;
}


/**
 * Global safety thresholds for price validation.
 * 
 * OracleRouter has no cache — every `get_price` call queries sources fresh,
 * so there is no separate cache-freshness knob.
 */
export interface OracleConfig {
  /**
 * Maximum allowed spread between oracle sources in basis points
 * (e.g., 100 = 1%). Bounded at `shared::constants::MAX_DEVIATION_BPS_CEILING`.
 */
max_deviation_bps: i128;
  /**
 * Minimum number of source responses that must agree within
 * `max_deviation_bps` for OracleRouter to return a price. Floored at
 * `shared::constants::MIN_REQUIRED_SOURCES_FLOOR`, ceilinged at
 * `shared::constants::MAX_ORACLE_SOURCES`.
 */
min_required_sources: u32;
  /**
 * Maximum age of an external SEP-40 price feed before it is rejected
 * as stale (in seconds).
 */
staleness_threshold: u64;
}


/**
 * Data required during a WASM migration. Single definition for all contracts.
 */
export interface MigrationData {
  version: u32;
}


/**
 * Pending WASM upgrade — set by `propose_upgrade`, cleared by
 * `cancel_upgrade`. Single shape across every protocol contract; each
 * contract stores it under its own `StorageKey::PendingUpgrade` slot.
 * Enforcement is advisory — off-chain monitor cross-checks `upgrade()` calls
 * against the most recent `UpgradeProposed` event for the same contract.
 */
export interface PendingUpgrade {
  eta: u64;
  wasm_hash: Buffer;
}




/**
 * Defines how protocol revenue is split between parties.
 * All values are in basis points (bps). Must sum to 10_000.
 */
export interface FeeSplits {
  dev_bps: u32;
  keeper_bps: u32;
  lp_bps: u32;
}

export const SharedError = {
  /**
   * Caller does not hold the required role. Discriminant matches every
   * protocol contract's `Unauthorized = 3` so error codes are consistent.
   */
  3: {message:"Unauthorized"}
}


/**
 * Global protocol risk and timing parameters.
 */
export interface ProtocolLimits {
  adl_pnl_bps: u32;
  adl_utilization_bps: u32;
  cooldown_duration: u64;
  funding_cut_bps: u32;
  liquidation_threshold_bps: u32;
  max_utilization_ratio: i128;
  min_collateral: i128;
  min_position_lifetime: u64;
}


/**
 * Borrow rate kink curve and funding rate parameters (all in basis points).
 */
export interface BorrowRateConfig {
  base_borrow_rate_bps: i128;
  base_funding_rate_bps: i128;
  optimal_utilization_bps: i128;
  slope1_bps: i128;
  slope2_bps: i128;
}

export interface Client {
  /**
   * Construct and simulate a migrate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  migrate: ({migration_data, operator}: {migration_data: MigrationData, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash, operator}: {new_wasm_hash: Buffer, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a has_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_role: ({role, account}: {role: string, account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a grant_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  grant_role: ({caller, role, account}: {caller: string, role: string, account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin_address}: {admin_address: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a revoke_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_role: ({caller, role, account}: {caller: string, role: string, account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_admin: ({caller, new_admin}: {caller: string, new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a cancel_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_upgrade: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_fee_splits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_splits: (options?: MethodOptions) => Promise<AssembledTransaction<FeeSplits>>

  /**
   * Construct and simulate a propose_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_upgrade: ({caller, wasm_hash}: {caller: string, wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a bump_config_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  bump_config_state: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_pending_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_pending_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a update_fee_splits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_fee_splits: ({caller, fee_splits}: {caller: string, fee_splits: FeeSplits}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_protocol_limits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_protocol_limits: (options?: MethodOptions) => Promise<AssembledTransaction<ProtocolLimits>>

  /**
   * Construct and simulate a get_upgrade_timelock transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_upgrade_timelock: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a set_upgrade_timelock transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_upgrade_timelock: ({caller, seconds}: {caller: string, seconds: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a cancel_admin_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_admin_proposal: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_borrow_rate_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_borrow_rate_config: (options?: MethodOptions) => Promise<AssembledTransaction<BorrowRateConfig>>

  /**
   * Construct and simulate a update_protocol_limits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_protocol_limits: ({caller, limits}: {caller: string, limits: ProtocolLimits}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_borrow_rate_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_borrow_rate_config: ({caller, config}: {caller: string, config: BorrowRateConfig}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAAEkNvbmZpZ01hbmFnZXJFcnJvcgAAAAAACwAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAACpGZWVTcGxpdHMgdmFsdWVzIGRvIG5vdCBzdW0gdG8gMTBfMDAwIGJwcy4AAAAAABBJbnZhbGlkRmVlU3BsaXRzAAAABAAAAD5PbmUgb3IgbW9yZSBQcm90b2NvbExpbWl0cyB2YWx1ZXMgYXJlIG91dCBvZiBhY2NlcHRhYmxlIHJhbmdlLgAAAAAADUludmFsaWRMaW1pdHMAAAAAAAAFAAAASGBzZXRfdXBncmFkZV90aW1lbG9ja2AgY2FsbGVkIHdpdGggc2Vjb25kcyBiZWxvdyBgTUlOX1VQR1JBREVfVElNRUxPQ0tgLgAAABdVcGdyYWRlVGltZWxvY2tUb29TaG9ydAAAAAAGAAAASmBwcm9wb3NlX2FkbWluKGNhbGxlciwgbmV3X2FkbWluKWAgcmVqZWN0ZWQgYmVjYXVzZSBgY2FsbGVyID09IG5ld19hZG1pbmAuAAAAAAAUSW52YWxpZEFkbWluUHJvcG9zYWwAAAAHAAAARmBhY2NlcHRfYWRtaW5gIHJlamVjdGVkIOKAlCBjYWxsZXIgaXMgbm90IHRoZSBjdXJyZW50bHkgcGVuZGluZyBhZG1pbi4AAAAAAA9Ob3RQZW5kaW5nQWRtaW4AAAAACAAAAD9gYWNjZXB0X2FkbWluYCByZWplY3RlZCDigJQgdGhlcmUgaXMgbm8gcGVuZGluZyBhZG1pbiBwcm9wb3NhbC4AAAAADk5vUGVuZGluZ0FkbWluAAAAAAAJAAAAh09aLWdlbmVyYXRlZCBgdXBncmFkZSgpYCByZWplY3RlZCDigJQgbm8gYHByb3Bvc2VfdXBncmFkZWAgd2FzIG1hZGUKYmVmb3JlIGNvbW1pdC4gVGhlIHR3by1zdGVwIHVwZ3JhZGUgZmxvdyByZXF1aXJlcyBhIHByaW9yIHByb3Bvc2FsLgAAAAAQTm9QZW5kaW5nVXBncmFkZQAAAAoAAABDT1otZ2VuZXJhdGVkIGB1cGdyYWRlKClgIHJlamVjdGVkIOKAlCB0aW1lbG9jayBoYXMgbm90IGVsYXBzZWQgeWV0LgAAAAAZVXBncmFkZVRpbWVsb2NrTm90RWxhcHNlZAAAAAAAAAs=",
        "AAAABQAAAAAAAAAAAAAAClJvbGVDaGFuZ2UAAAAAAAEAAAAEcm9sZQAAAAMAAAAAAAAABHJvbGUAAAARAAAAAAAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAAAAAAIaXNfZ3JhbnQAAAABAAAAAAAAAAE=",
        "AAAABQAAAAAAAAAAAAAADExpbWl0c1VwZGF0ZQAAAAEAAAAGbGltaXRzAAAAAAAIAAAAAAAAAA5taW5fY29sbGF0ZXJhbAAAAAAACwAAAAAAAAAAAAAAEWNvb2xkb3duX2R1cmF0aW9uAAAAAAAABgAAAAAAAAAAAAAAFW1pbl9wb3NpdGlvbl9saWZldGltZQAAAAAAAAYAAAAAAAAAAAAAABVtYXhfdXRpbGl6YXRpb25fcmF0aW8AAAAAAAALAAAAAAAAAAAAAAAPZnVuZGluZ19jdXRfYnBzAAAAAAQAAAAAAAAAAAAAAAthZGxfcG5sX2JwcwAAAAAEAAAAAAAAAAAAAAATYWRsX3V0aWxpemF0aW9uX2JwcwAAAAAEAAAAAAAAAAAAAAAZbGlxdWlkYXRpb25fdGhyZXNob2xkX2JwcwAAAAAAAAQAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAAD0ZlZVNwbGl0c1VwZGF0ZQAAAAABAAAABmZlZWNmZwAAAAAAAwAAAAAAAAAKa2VlcGVyX2JwcwAAAAAABAAAAAAAAAAAAAAAB2Rldl9icHMAAAAABAAAAAAAAAAAAAAABmxwX2JwcwAAAAAABAAAAAAAAAAB",
        "AAAABQAAAAAAAAAAAAAAEEJvcnJvd1JhdGVVcGRhdGUAAAABAAAABXJhdGVzAAAAAAAABQAAAAAAAAAUYmFzZV9ib3Jyb3dfcmF0ZV9icHMAAAALAAAAAAAAAAAAAAAKc2xvcGUxX2JwcwAAAAAACwAAAAAAAAAAAAAACnNsb3BlMl9icHMAAAAAAAsAAAAAAAAAAAAAABdvcHRpbWFsX3V0aWxpemF0aW9uX2JwcwAAAAALAAAAAAAAAAAAAAAVYmFzZV9mdW5kaW5nX3JhdGVfYnBzAAAAAAAACwAAAAAAAAAB",
        "AAAABQAAAAAAAAAAAAAAFVVwZ3JhZGVUaW1lbG9ja1VwZGF0ZQAAAAAAAAEAAAAFdXBndGwAAAAAAAABAAAAAAAAABB0aW1lbG9ja19zZWNvbmRzAAAABgAAAAAAAAAB",
        "AAAAAgAAAAAAAAAAAAAAClN0b3JhZ2VLZXkAAAAAAAoAAAAAAAAAQkluaXRpYWxpemF0aW9uIGZsYWcg4oCUIHNldCB0byBgdHJ1ZWAgYWZ0ZXIgYGluaXRpYWxpemVgIHN1Y2NlZWRzLgAAAAAAC0luaXRpYWxpemVkAAAAAAAAAAAtVGhlIGFkbWluIGFkZHJlc3Mgc3RvcmVkIGluIGluc3RhbmNlIHN0b3JhZ2UuAAAAAAAABUFkbWluAAAAAAAAAQAAADtSb2xlIG1lbWJlcnNoaXA6IGBSb2xlTWVtYmVyS2V5IHsgcm9sZSwgYWNjb3VudCB9IC0+IGJvb2xgLgAAAAAKUm9sZU1lbWJlcgAAAAAAAQAAB9AAAAANUm9sZU1lbWJlcktleQAAAAAAAAAAAAAYRmVlIHNwbGl0IGNvbmZpZ3VyYXRpb24uAAAACUZlZVNwbGl0cwAAAAAAAAAAAABMUHJvdG9jb2wgcmlzayBhbmQgdGltaW5nIGxpbWl0cyAoc2luZ2xlIHN0cnVjdCByZXBsYWNlcyBmb3VyIHNlcGFyYXRlIGtleXMpLgAAAA5Qcm90b2NvbExpbWl0cwAAAAAAAAAAADNCb3Jyb3cgcmF0ZSBraW5rIGN1cnZlIGFuZCBmdW5kaW5nIHJhdGUgcGFyYW1ldGVycy4AAAAAEEJvcnJvd1JhdGVDb25maWcAAAAAAAAAZkNvbmZpZ3VyYWJsZSB1cGdyYWRlIHRpbWVsb2NrIGluIHNlY29uZHMuIEZsb29yIGVuZm9yY2VkIGF0CmBzaGFyZWQ6OmNvbnN0YW50czo6TUlOX1VQR1JBREVfVElNRUxPQ0tgLgAAAAAAD1VwZ3JhZGVUaW1lbG9jawAAAAAAAAAAQVBlbmRpbmcgYWRtaW4gYXdhaXRpbmcgYGFjY2VwdF9hZG1pbmAg4oCUIHNldCBieSBgcHJvcG9zZV9hZG1pbmAuAAAAAAAADFBlbmRpbmdBZG1pbgAAAAAAAACMUGVuZGluZyBXQVNNIHVwZ3JhZGUg4oCUIHNldCBieSBgcHJvcG9zZV91cGdyYWRlYCwgY2xlYXJlZCB3aGVuIHRoZQpPWi1nZW5lcmF0ZWQgYHVwZ3JhZGUoKWAgcnVucyBhbmQgYF9yZXF1aXJlX2F1dGhgIGVuZm9yY2VzIHRoZQp0aW1lbG9jay4AAAAOUGVuZGluZ1VwZ3JhZGUAAAAAAAAAAAAwQ3VycmVudCBjb250cmFjdCB2ZXJzaW9uICh3cml0dGVuIGJ5IG1pZ3JhdGlvbikuAAAAB1ZlcnNpb24A",
        "AAAAAQAAACpDb21wb3NpdGUga2V5IGZvciByb2xlIG1lbWJlcnNoaXAgZW50cmllcy4AAAAAAAAAAAANUm9sZU1lbWJlcktleQAAAAAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAEcm9sZQAAABE=",
        "AAAAAAAAAAAAAAAHbWlncmF0ZQAAAAACAAAAAAAAAA5taWdyYXRpb25fZGF0YQAAAAAH0AAAAA1NaWdyYXRpb25EYXRhAAAAAAAAAAAAAAhvcGVyYXRvcgAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAACAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAIaGFzX3JvbGUAAAACAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAKZ3JhbnRfcm9sZQAAAAAAAwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAANYWRtaW5fYWRkcmVzcwAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAALcmV2b2tlX3JvbGUAAAAAAwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAMYWNjZXB0X2FkbWluAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAANcHJvcG9zZV9hZG1pbgAAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAOZ2V0X2ZlZV9zcGxpdHMAAAAAAAAAAAABAAAH0AAAAAlGZWVTcGxpdHMAAAA=",
        "AAAAAAAAAAAAAAAPcHJvcG9zZV91cGdyYWRlAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAARYnVtcF9jb25maWdfc3RhdGUAAAAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAARZ2V0X3BlbmRpbmdfYWRtaW4AAAAAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAAAAAAARdXBkYXRlX2ZlZV9zcGxpdHMAAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACmZlZV9zcGxpdHMAAAAAB9AAAAAJRmVlU3BsaXRzAAAAAAAAAA==",
        "AAAAAAAAAAAAAAATZ2V0X3Byb3RvY29sX2xpbWl0cwAAAAAAAAAAAQAAB9AAAAAOUHJvdG9jb2xMaW1pdHMAAA==",
        "AAAAAAAAAAAAAAAUZ2V0X3VwZ3JhZGVfdGltZWxvY2sAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAAAAAAAUc2V0X3VwZ3JhZGVfdGltZWxvY2sAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAB3NlY29uZHMAAAAABgAAAAA=",
        "AAAAAAAAAAAAAAAVY2FuY2VsX2FkbWluX3Byb3Bvc2FsAAAAAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAWZ2V0X2JvcnJvd19yYXRlX2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAAEEJvcnJvd1JhdGVDb25maWc=",
        "AAAAAAAAAAAAAAAWdXBkYXRlX3Byb3RvY29sX2xpbWl0cwAAAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAZsaW1pdHMAAAAAB9AAAAAOUHJvdG9jb2xMaW1pdHMAAAAAAAA=",
        "AAAAAAAAAAAAAAAZdXBkYXRlX2JvcnJvd19yYXRlX2NvbmZpZwAAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAGY29uZmlnAAAAAAfQAAAAEEJvcnJvd1JhdGVDb25maWcAAAAA",
        "AAAABAAAAAAAAAAAAAAAEFVwZ3JhZGVhYmxlRXJyb3IAAAABAAAAQVdoZW4gbWlncmF0aW9uIGlzIGF0dGVtcHRlZCBidXQgbm90IGFsbG93ZWQgZHVlIHRvIHVwZ3JhZGUgc3RhdGUuAAAAAAAAE01pZ3JhdGlvbk5vdEFsbG93ZWQAAAAETA==",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gdGhlIG1lcmtsZSByb290IGlzIHNldC4AAAAAAAAAAAAHU2V0Um9vdAAAAAABAAAACHNldF9yb290AAAAAQAAAAAAAAAEcm9vdAAAAA4AAAAAAAAAAg==",
        "AAAABQAAACdFdmVudCBlbWl0dGVkIHdoZW4gYW4gaW5kZXggaXMgY2xhaW1lZC4AAAAAAAAAAApTZXRDbGFpbWVkAAAAAAABAAAAC3NldF9jbGFpbWVkAAAAAAEAAAAAAAAABWluZGV4AAAAAAAAAAAAAAAAAAAC",
        "AAAABAAAAAAAAAAAAAAAFk1lcmtsZURpc3RyaWJ1dG9yRXJyb3IAAAAAAAMAAAAbVGhlIG1lcmtsZSByb290IGlzIG5vdCBzZXQuAAAAAApSb290Tm90U2V0AAAAAAUUAAAAJ1RoZSBwcm92aWRlZCBpbmRleCB3YXMgYWxyZWFkeSBjbGFpbWVkLgAAAAATSW5kZXhBbHJlYWR5Q2xhaW1lZAAAAAUVAAAAFVRoZSBwcm9vZiBpcyBpbnZhbGlkLgAAAAAAAAxJbnZhbGlkUHJvb2YAAAUW",
        "AAAAAgAAAD1TdG9yYWdlIGtleXMgZm9yIHRoZSBkYXRhIGFzc29jaWF0ZWQgd2l0aCBgTWVya2xlRGlzdHJpYnV0b3JgAAAAAAAAAAAAABtNZXJrbGVEaXN0cmlidXRvclN0b3JhZ2VLZXkAAAAAAgAAAAAAAAAoVGhlIE1lcmtsZSByb290IG9mIHRoZSBkaXN0cmlidXRpb24gdHJlZQAAAARSb290AAAAAQAAACNNYXBzIGFuIGluZGV4IHRvIGl0cyBjbGFpbWVkIHN0YXR1cwAAAAAHQ2xhaW1lZAAAAAABAAAABA==",
        "AAAAAgAAACpSb3VuZGluZyBkaXJlY3Rpb24gZm9yIGRpdmlzaW9uIG9wZXJhdGlvbnMAAAAAAAAAAAAIUm91bmRpbmcAAAADAAAAAAAAACVSb3VuZCB0b3dhcmQgbmVnYXRpdmUgaW5maW5pdHkgKGRvd24pAAAAAAAABUZsb29yAAAAAAAAAAAAACNSb3VuZCB0b3dhcmQgcG9zaXRpdmUgaW5maW5pdHkgKHVwKQAAAAAEQ2VpbAAAAAAAAAAeUm91bmQgdG93YXJkIHplcm8gKHRydW5jYXRpb24pAAAAAAAIVHJ1bmNhdGU=",
        "AAAABAAAAAAAAAAAAAAAFlNvcm9iYW5GaXhlZFBvaW50RXJyb3IAAAAAAAIAAAAcQXJpdGhtZXRpYyBvdmVyZmxvdyBvY2N1cnJlZAAAAAhPdmVyZmxvdwAABdwAAAAQRGl2aXNpb24gYnkgemVybwAAAA5EaXZpc2lvbkJ5WmVybwAAAAAF3Q==",
        "AAAABAAAAAAAAAAAAAAAC0NyeXB0b0Vycm9yAAAAAAMAAAApVGhlIG1lcmtsZSBwcm9vZiBsZW5ndGggaXMgb3V0IG9mIGJvdW5kcy4AAAAAAAAWTWVya2xlUHJvb2ZPdXRPZkJvdW5kcwAAAAAFeAAAACdUaGUgaW5kZXggb2YgdGhlIGxlYWYgaXMgb3V0IG9mIGJvdW5kcy4AAAAAFk1lcmtsZUluZGV4T3V0T2ZCb3VuZHMAAAAABXkAAAAYTm8gZGF0YSBpbiBoYXNoZXIgc3RhdGUuAAAAEEhhc2hlckVtcHR5U3RhdGUAAAV6",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gdGhlIGNvbnRyYWN0IGlzIHBhdXNlZC4AAAAAAAAAAAAGUGF1c2VkAAAAAAABAAAABnBhdXNlZAAAAAAAAAAAAAI=",
        "AAAABQAAACxFdmVudCBlbWl0dGVkIHdoZW4gdGhlIGNvbnRyYWN0IGlzIHVucGF1c2VkLgAAAAAAAAAIVW5wYXVzZWQAAAABAAAACHVucGF1c2VkAAAAAAAAAAI=",
        "AAAABAAAAAAAAAAAAAAADVBhdXNhYmxlRXJyb3IAAAAAAAACAAAANFRoZSBvcGVyYXRpb24gZmFpbGVkIGJlY2F1c2UgdGhlIGNvbnRyYWN0IGlzIHBhdXNlZC4AAAANRW5mb3JjZWRQYXVzZQAAAAAAA+gAAAA4VGhlIG9wZXJhdGlvbiBmYWlsZWQgYmVjYXVzZSB0aGUgY29udHJhY3QgaXMgbm90IHBhdXNlZC4AAAANRXhwZWN0ZWRQYXVzZQAAAAAAA+k=",
        "AAAAAgAAACJTdG9yYWdlIGtleSBmb3IgdGhlIHBhdXNhYmxlIHN0YXRlAAAAAAAAAAAAElBhdXNhYmxlU3RvcmFnZUtleQAAAAAAAQAAAAAAAAAySW5kaWNhdGVzIHdoZXRoZXIgdGhlIGNvbnRyYWN0IGlzIGluIHBhdXNlZCBzdGF0ZS4AAAAAAAZQYXVzZWQAAA==",
        "AAAAAQAAADVSZXByZXNlbnRzIGEgc2luZ2xlIHRyYWRlcidzIG9wZW4gbGV2ZXJhZ2VkIHBvc2l0aW9uLgAAAAAAAAAAAAAIUG9zaXRpb24AAAAJAAAAKFVTREMgY29sbGF0ZXJhbCBkZXBvc2l0ZWQgYnkgdGhlIHRyYWRlci4AAAAKY29sbGF0ZXJhbAAAAAAACwAAAEVHbG9iYWwgYm9ycm93IGFjY3VtdWxhdG9yIGluZGV4IGF0IHBvc2l0aW9uIG9wZW4gKGZvciBsYXp5IGZlZSBjYWxjKS4AAAAAAAASZW50cnlfYm9ycm93X2luZGV4AAAAAAALAAAARkdsb2JhbCBmdW5kaW5nIGFjY3VtdWxhdG9yIGluZGV4IGF0IHBvc2l0aW9uIG9wZW4gKGZvciBsYXp5IGZlZSBjYWxjKS4AAAAAABNlbnRyeV9mdW5kaW5nX2luZGV4AAAAAAsAAABBT3JhY2xlIHByaWNlIGF0IHRoZSB0aW1lIHRoZSBwb3NpdGlvbiB3YXMgb3BlbmVkIChzY2FsZWQgYnkgMWU3KS4AAAAAAAALZW50cnlfcHJpY2UAAAAACwAAACxUcnVlIGZvciBhIGxvbmcgcG9zaXRpb24sIGZhbHNlIGZvciBhIHNob3J0LgAAAAdpc19sb25nAAAAAAEAAABPQmxvY2sgdGltZXN0YW1wIHdoZW4gdGhlIHBvc2l0aW9uIHdhcyBsYXN0IGluY3JlYXNlZCAoYW50aS1mcm9udC1ydW5uaW5nIGxvY2spLgAAAAATbGFzdF9pbmNyZWFzZWRfdGltZQAAAAAGAAAAJk5vdGlvbmFsIHNpemUgb2YgdGhlIHBvc2l0aW9uIGluIFVTREMuAAAAAAAEc2l6ZQAAAAsAAAAtU3RvcC1sb3NzIHByaWNlIChzY2FsZWQgYnkgMWU3KS4gMCA9IG5vdCBzZXQuAAAAAAAACXN0b3BfbG9zcwAAAAAAAAsAAAAvVGFrZS1wcm9maXQgcHJpY2UgKHNjYWxlZCBieSAxZTcpLiAwID0gbm90IHNldC4AAAAAC3Rha2VfcHJvZml0AAAAAAs=",
        "AAAAAQAAADhHbG9iYWwgbWFya2V0IHN0YXRlIGZvciBhIHNpbmdsZSB0cmFkZWFibGUgYXNzZXQgc3ltYm9sLgAAAAAAAAAKTWFya2V0SW5mbwAAAAAABwAAADxDdW11bGF0aXZlIGJvcnJvdyBmZWUgaW5kZXggKGdyb3dzIG1vbm90b25pY2FsbHkgd2l0aCB0aW1lKS4AAAAQYWNjX2JvcnJvd19pbmRleAAAAAsAAABEQ3VtdWxhdGl2ZSBmdW5kaW5nIHJhdGUgaW5kZXggKHNpZ25lZDsgcG9zaXRpdmUgPSBsb25ncyBwYXkgc2hvcnRzKS4AAAARYWNjX2Z1bmRpbmdfaW5kZXgAAAAAAAALAAAAQVZvbHVtZS13ZWlnaHRlZCBhdmVyYWdlIGVudHJ5IHByaWNlIG9mIGFsbCBhY3RpdmUgbG9uZyBwb3NpdGlvbnMuAAAAAAAAFWdsb2JhbF9sb25nX2F2Z19wcmljZQAAAAAAAAsAAABCVm9sdW1lLXdlaWdodGVkIGF2ZXJhZ2UgZW50cnkgcHJpY2Ugb2YgYWxsIGFjdGl2ZSBzaG9ydCBwb3NpdGlvbnMuAAAAAAAWZ2xvYmFsX3Nob3J0X2F2Z19wcmljZQAAAAAACwAAACpUaW1lc3RhbXAgb2YgdGhlIGxhc3Qga2VlcGVyIGluZGV4IHVwZGF0ZS4AAAAAABFsYXN0X2luZGV4X3VwZGF0ZQAAAAAAAAYAAAAvVG90YWwgbm90aW9uYWwgc2l6ZSBvZiBhbGwgb3BlbiBsb25nIHBvc2l0aW9ucy4AAAAAEmxvbmdfb3Blbl9pbnRlcmVzdAAAAAAACwAAADBUb3RhbCBub3Rpb25hbCBzaXplIG9mIGFsbCBvcGVuIHNob3J0IHBvc2l0aW9ucy4AAAATc2hvcnRfb3Blbl9pbnRlcmVzdAAAAAAL",
        "AAAAAQAAAKlHbG9iYWwgc2FmZXR5IHRocmVzaG9sZHMgZm9yIHByaWNlIHZhbGlkYXRpb24uCgpPcmFjbGVSb3V0ZXIgaGFzIG5vIGNhY2hlIOKAlCBldmVyeSBgZ2V0X3ByaWNlYCBjYWxsIHF1ZXJpZXMgc291cmNlcyBmcmVzaCwKc28gdGhlcmUgaXMgbm8gc2VwYXJhdGUgY2FjaGUtZnJlc2huZXNzIGtub2IuAAAAAAAAAAAAAAxPcmFjbGVDb25maWcAAAADAAAAik1heGltdW0gYWxsb3dlZCBzcHJlYWQgYmV0d2VlbiBvcmFjbGUgc291cmNlcyBpbiBiYXNpcyBwb2ludHMKKGUuZy4sIDEwMCA9IDElKS4gQm91bmRlZCBhdCBgc2hhcmVkOjpjb25zdGFudHM6Ok1BWF9ERVZJQVRJT05fQlBTX0NFSUxJTkdgLgAAAAAAEW1heF9kZXZpYXRpb25fYnBzAAAAAAAACwAAAONNaW5pbXVtIG51bWJlciBvZiBzb3VyY2UgcmVzcG9uc2VzIHRoYXQgbXVzdCBhZ3JlZSB3aXRoaW4KYG1heF9kZXZpYXRpb25fYnBzYCBmb3IgT3JhY2xlUm91dGVyIHRvIHJldHVybiBhIHByaWNlLiBGbG9vcmVkIGF0CmBzaGFyZWQ6OmNvbnN0YW50czo6TUlOX1JFUVVJUkVEX1NPVVJDRVNfRkxPT1JgLCBjZWlsaW5nZWQgYXQKYHNoYXJlZDo6Y29uc3RhbnRzOjpNQVhfT1JBQ0xFX1NPVVJDRVNgLgAAAAAUbWluX3JlcXVpcmVkX3NvdXJjZXMAAAAEAAAAWU1heGltdW0gYWdlIG9mIGFuIGV4dGVybmFsIFNFUC00MCBwcmljZSBmZWVkIGJlZm9yZSBpdCBpcyByZWplY3RlZAphcyBzdGFsZSAoaW4gc2Vjb25kcykuAAAAAAAAE3N0YWxlbmVzc190aHJlc2hvbGQAAAAABg==",
        "AAAAAQAAAEtEYXRhIHJlcXVpcmVkIGR1cmluZyBhIFdBU00gbWlncmF0aW9uLiBTaW5nbGUgZGVmaW5pdGlvbiBmb3IgYWxsIGNvbnRyYWN0cy4AAAAAAAAAAA1NaWdyYXRpb25EYXRhAAAAAAAAAQAAAAAAAAAHdmVyc2lvbgAAAAAE",
        "AAAAAQAAAVlQZW5kaW5nIFdBU00gdXBncmFkZSDigJQgc2V0IGJ5IGBwcm9wb3NlX3VwZ3JhZGVgLCBjbGVhcmVkIGJ5CmBjYW5jZWxfdXBncmFkZWAuIFNpbmdsZSBzaGFwZSBhY3Jvc3MgZXZlcnkgcHJvdG9jb2wgY29udHJhY3Q7IGVhY2gKY29udHJhY3Qgc3RvcmVzIGl0IHVuZGVyIGl0cyBvd24gYFN0b3JhZ2VLZXk6OlBlbmRpbmdVcGdyYWRlYCBzbG90LgpFbmZvcmNlbWVudCBpcyBhZHZpc29yeSDigJQgb2ZmLWNoYWluIG1vbml0b3IgY3Jvc3MtY2hlY2tzIGB1cGdyYWRlKClgIGNhbGxzCmFnYWluc3QgdGhlIG1vc3QgcmVjZW50IGBVcGdyYWRlUHJvcG9zZWRgIGV2ZW50IGZvciB0aGUgc2FtZSBjb250cmFjdC4AAAAAAAAAAAAADlBlbmRpbmdVcGdyYWRlAAAAAAACAAAAAAAAAANldGEAAAAABgAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACA=",
        "AAAABQAAALVFbWl0dGVkIGJ5IGBwcm9wb3NlX3VwZ3JhZGVgLiBPZmYtY2hhaW4gbW9uaXRvcmluZyByZWNvcmRzIHRoZSBwcm9wb3NlZApgd2FzbV9oYXNoYCArIGBldGFgIGFuZCBmbGFncyBhbnkgc3Vic2VxdWVudCBgdXBncmFkZSgpYCBjYWxsIHdob3NlIGhhc2gKZGl2ZXJnZXMgb3IgdGhhdCBmaXJlcyBiZWZvcmUgYGV0YWAuAAAAAAAAAAAAAA9VcGdyYWRlUHJvcG9zZWQAAAAAAQAAAAZ1cGdwcnAAAAAAAAIAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAAAAAADZXRhAAAAAAYAAAAAAAAAAQ==",
        "AAAABQAAAC9FbWl0dGVkIGJ5IGBjYW5jZWxfdXBncmFkZWAgKFBBVVNFUiB2ZXRvIHBhdGgpLgAAAAAAAAAAEFVwZ3JhZGVDYW5jZWxsZWQAAAABAAAABnVwZ2NhbgAAAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAE=",
        "AAAAAQAAAHBEZWZpbmVzIGhvdyBwcm90b2NvbCByZXZlbnVlIGlzIHNwbGl0IGJldHdlZW4gcGFydGllcy4KQWxsIHZhbHVlcyBhcmUgaW4gYmFzaXMgcG9pbnRzIChicHMpLiBNdXN0IHN1bSB0byAxMF8wMDAuAAAAAAAAAAlGZWVTcGxpdHMAAAAAAAADAAAAAAAAAAdkZXZfYnBzAAAAAAQAAAAAAAAACmtlZXBlcl9icHMAAAAAAAQAAAAAAAAABmxwX2JwcwAAAAAABA==",
        "AAAABAAAAAAAAAAAAAAAC1NoYXJlZEVycm9yAAAAAAEAAACIQ2FsbGVyIGRvZXMgbm90IGhvbGQgdGhlIHJlcXVpcmVkIHJvbGUuIERpc2NyaW1pbmFudCBtYXRjaGVzIGV2ZXJ5CnByb3RvY29sIGNvbnRyYWN0J3MgYFVuYXV0aG9yaXplZCA9IDNgIHNvIGVycm9yIGNvZGVzIGFyZSBjb25zaXN0ZW50LgAAAAxVbmF1dGhvcml6ZWQAAAAD",
        "AAAAAQAAACtHbG9iYWwgcHJvdG9jb2wgcmlzayBhbmQgdGltaW5nIHBhcmFtZXRlcnMuAAAAAAAAAAAOUHJvdG9jb2xMaW1pdHMAAAAAAAgAAAAAAAAAC2FkbF9wbmxfYnBzAAAAAAQAAAAAAAAAE2FkbF91dGlsaXphdGlvbl9icHMAAAAABAAAAAAAAAARY29vbGRvd25fZHVyYXRpb24AAAAAAAAGAAAAAAAAAA9mdW5kaW5nX2N1dF9icHMAAAAABAAAAAAAAAAZbGlxdWlkYXRpb25fdGhyZXNob2xkX2JwcwAAAAAAAAQAAAAAAAAAFW1heF91dGlsaXphdGlvbl9yYXRpbwAAAAAAAAsAAAAAAAAADm1pbl9jb2xsYXRlcmFsAAAAAAALAAAAAAAAABVtaW5fcG9zaXRpb25fbGlmZXRpbWUAAAAAAAAG",
        "AAAAAQAAAElCb3Jyb3cgcmF0ZSBraW5rIGN1cnZlIGFuZCBmdW5kaW5nIHJhdGUgcGFyYW1ldGVycyAoYWxsIGluIGJhc2lzIHBvaW50cykuAAAAAAAAAAAAABBCb3Jyb3dSYXRlQ29uZmlnAAAABQAAAAAAAAAUYmFzZV9ib3Jyb3dfcmF0ZV9icHMAAAALAAAAAAAAABViYXNlX2Z1bmRpbmdfcmF0ZV9icHMAAAAAAAALAAAAAAAAABdvcHRpbWFsX3V0aWxpemF0aW9uX2JwcwAAAAALAAAAAAAAAApzbG9wZTFfYnBzAAAAAAALAAAAAAAAAApzbG9wZTJfYnBzAAAAAAAL" ]),
      options
    )
  }
  public readonly fromJSON = {
    migrate: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        has_role: this.txFromJSON<boolean>,
        grant_role: this.txFromJSON<null>,
        initialize: this.txFromJSON<null>,
        revoke_role: this.txFromJSON<null>,
        accept_admin: this.txFromJSON<null>,
        propose_admin: this.txFromJSON<null>,
        cancel_upgrade: this.txFromJSON<null>,
        get_fee_splits: this.txFromJSON<FeeSplits>,
        propose_upgrade: this.txFromJSON<null>,
        bump_config_state: this.txFromJSON<null>,
        get_pending_admin: this.txFromJSON<Option<string>>,
        update_fee_splits: this.txFromJSON<null>,
        get_protocol_limits: this.txFromJSON<ProtocolLimits>,
        get_upgrade_timelock: this.txFromJSON<u64>,
        set_upgrade_timelock: this.txFromJSON<null>,
        cancel_admin_proposal: this.txFromJSON<null>,
        get_borrow_rate_config: this.txFromJSON<BorrowRateConfig>,
        update_protocol_limits: this.txFromJSON<null>,
        update_borrow_rate_config: this.txFromJSON<null>
  }
}
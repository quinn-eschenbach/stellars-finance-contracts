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





/**
 * A cached price entry for a single asset symbol.
 */
export interface CachedPrice {
  /**
 * Ledger timestamp when this cache entry was written.
 */
last_update: u64;
  /**
 * Price scaled by 1e7 (7 decimal places).
 */
price: i128;
}

export const OracleRouterError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"Unauthorized"},
  /**
   * All price sources returned data older than StalenessThreshold,
   * or returned invalid (zero/negative) prices.
   */
  4: {message:"StalePrice"},
  /**
   * Spread between primary oracle sources exceeds MaxDeviation.
   */
  5: {message:"PriceDeviationTooHigh"},
  /**
   * No SEP-40 oracle sources are configured for the requested symbol.
   */
  6: {message:"NoPriceSources"},
  /**
   * Cross-contract call to an oracle source failed.
   */
  7: {message:"PriceFetchFailed"},
  /**
   * Oracle configuration field is invalid (e.g., zero cache_duration).
   */
  8: {message:"InvalidConfig"}
}



export type StorageKey = {tag: "Initialized", values: void} | {tag: "ConfigManager", values: void} | {tag: "OracleConfig", values: void} | {tag: "PrimarySources", values: readonly [string]} | {tag: "SecondarySources", values: readonly [string]} | {tag: "CachedPrice", values: readonly [string]} | {tag: "Version", values: void};

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
 * Global safety thresholds for price validation and caching.
 */
export interface OracleConfig {
  /**
 * Duration the internal price cache is valid before a fresh cross-contract
 * call to external oracles is required (in seconds, e.g., 10).
 */
cache_duration: u64;
  /**
 * Maximum allowed spread between primary oracle sources in basis points
 * (e.g., 100 = 1%). If exceeded, trading for that asset is paused.
 */
max_deviation_bps: i128;
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
   * Construct and simulate a get_price transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_price: ({symbol}: {symbol: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({config_manager_address}: {config_manager_address: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a bump_oracle_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  bump_oracle_state: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_oracle_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_oracle_config: (options?: MethodOptions) => Promise<AssembledTransaction<OracleConfig>>

  /**
   * Construct and simulate a set_oracle_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_oracle_config: ({caller, config}: {caller: string, config: OracleConfig}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_oracle_sources transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_oracle_sources: ({caller, symbol, primary, secondary}: {caller: string, symbol: string, primary: Array<string>, secondary: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAAAQAAAC9BIGNhY2hlZCBwcmljZSBlbnRyeSBmb3IgYSBzaW5nbGUgYXNzZXQgc3ltYm9sLgAAAAAAAAAAC0NhY2hlZFByaWNlAAAAAAIAAAAzTGVkZ2VyIHRpbWVzdGFtcCB3aGVuIHRoaXMgY2FjaGUgZW50cnkgd2FzIHdyaXR0ZW4uAAAAAAtsYXN0X3VwZGF0ZQAAAAAGAAAAJ1ByaWNlIHNjYWxlZCBieSAxZTcgKDcgZGVjaW1hbCBwbGFjZXMpLgAAAAAFcHJpY2UAAAAAAAAL",
        "AAAABAAAAAAAAAAAAAAAEU9yYWNsZVJvdXRlckVycm9yAAAAAAAACAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAAGpBbGwgcHJpY2Ugc291cmNlcyByZXR1cm5lZCBkYXRhIG9sZGVyIHRoYW4gU3RhbGVuZXNzVGhyZXNob2xkLApvciByZXR1cm5lZCBpbnZhbGlkICh6ZXJvL25lZ2F0aXZlKSBwcmljZXMuAAAAAAAKU3RhbGVQcmljZQAAAAAABAAAADtTcHJlYWQgYmV0d2VlbiBwcmltYXJ5IG9yYWNsZSBzb3VyY2VzIGV4Y2VlZHMgTWF4RGV2aWF0aW9uLgAAAAAVUHJpY2VEZXZpYXRpb25Ub29IaWdoAAAAAAAABQAAAEFObyBTRVAtNDAgb3JhY2xlIHNvdXJjZXMgYXJlIGNvbmZpZ3VyZWQgZm9yIHRoZSByZXF1ZXN0ZWQgc3ltYm9sLgAAAAAAAA5Ob1ByaWNlU291cmNlcwAAAAAABgAAAC9Dcm9zcy1jb250cmFjdCBjYWxsIHRvIGFuIG9yYWNsZSBzb3VyY2UgZmFpbGVkLgAAAAAQUHJpY2VGZXRjaEZhaWxlZAAAAAcAAABCT3JhY2xlIGNvbmZpZ3VyYXRpb24gZmllbGQgaXMgaW52YWxpZCAoZS5nLiwgemVybyBjYWNoZV9kdXJhdGlvbikuAAAAAAANSW52YWxpZENvbmZpZwAAAAAAAAg=",
        "AAAABQAAAAAAAAAAAAAAClByaWNlRmV0Y2gAAAAAAAEAAAAFcHJpY2UAAAAAAAADAAAAAAAAAAZzeW1ib2wAAAAAABEAAAABAAAAAAAAAAVwcmljZQAAAAAAAAsAAAAAAAAAAAAAAAl0aW1lc3RhbXAAAAAAAAAGAAAAAAAAAAE=",
        "AAAABQAAAAAAAAAAAAAAEk9yYWNsZUNvbmZpZ1VwZGF0ZQAAAAAAAQAAAAZvcmNjZmcAAAAAAAMAAAAAAAAACXN0YWxlbmVzcwAAAAAAAAYAAAAAAAAAAAAAAAlkZXZpYXRpb24AAAAAAAALAAAAAAAAAAAAAAAOY2FjaGVfZHVyYXRpb24AAAAAAAYAAAAAAAAAAQ==",
        "AAAAAgAAAAAAAAAAAAAAClN0b3JhZ2VLZXkAAAAAAAcAAAAAAAAAAAAAAAtJbml0aWFsaXplZAAAAAAAAAAAAAAAAA1Db25maWdNYW5hZ2VyAAAAAAAAAAAAAAAAAAAMT3JhY2xlQ29uZmlnAAAAAQAAAAAAAAAOUHJpbWFyeVNvdXJjZXMAAAAAAAEAAAARAAAAAQAAAAAAAAAQU2Vjb25kYXJ5U291cmNlcwAAAAEAAAARAAAAAQAAAAAAAAALQ2FjaGVkUHJpY2UAAAAAAQAAABEAAAAAAAAAAAAAAAdWZXJzaW9uAA==",
        "AAAAAAAAAAAAAAAHbWlncmF0ZQAAAAACAAAAAAAAAA5taWdyYXRpb25fZGF0YQAAAAAH0AAAAA1NaWdyYXRpb25EYXRhAAAAAAAAAAAAAAhvcGVyYXRvcgAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAACAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAJZ2V0X3ByaWNlAAAAAAAAAQAAAAAAAAAGc3ltYm9sAAAAAAARAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAWY29uZmlnX21hbmFnZXJfYWRkcmVzcwAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAARYnVtcF9vcmFjbGVfc3RhdGUAAAAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAARZ2V0X29yYWNsZV9jb25maWcAAAAAAAAAAAAAAQAAB9AAAAAMT3JhY2xlQ29uZmln",
        "AAAAAAAAAAAAAAARc2V0X29yYWNsZV9jb25maWcAAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAxPcmFjbGVDb25maWcAAAAA",
        "AAAAAAAAAAAAAAASc2V0X29yYWNsZV9zb3VyY2VzAAAAAAAEAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABnN5bWJvbAAAAAAAEQAAAAAAAAAHcHJpbWFyeQAAAAPqAAAAEwAAAAAAAAAJc2Vjb25kYXJ5AAAAAAAD6gAAABMAAAAA",
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
        "AAAAAQAAADpHbG9iYWwgc2FmZXR5IHRocmVzaG9sZHMgZm9yIHByaWNlIHZhbGlkYXRpb24gYW5kIGNhY2hpbmcuAAAAAAAAAAAADE9yYWNsZUNvbmZpZwAAAAMAAACFRHVyYXRpb24gdGhlIGludGVybmFsIHByaWNlIGNhY2hlIGlzIHZhbGlkIGJlZm9yZSBhIGZyZXNoIGNyb3NzLWNvbnRyYWN0CmNhbGwgdG8gZXh0ZXJuYWwgb3JhY2xlcyBpcyByZXF1aXJlZCAoaW4gc2Vjb25kcywgZS5nLiwgMTApLgAAAAAAAA5jYWNoZV9kdXJhdGlvbgAAAAAABgAAAIZNYXhpbXVtIGFsbG93ZWQgc3ByZWFkIGJldHdlZW4gcHJpbWFyeSBvcmFjbGUgc291cmNlcyBpbiBiYXNpcyBwb2ludHMKKGUuZy4sIDEwMCA9IDElKS4gSWYgZXhjZWVkZWQsIHRyYWRpbmcgZm9yIHRoYXQgYXNzZXQgaXMgcGF1c2VkLgAAAAAAEW1heF9kZXZpYXRpb25fYnBzAAAAAAAACwAAAFlNYXhpbXVtIGFnZSBvZiBhbiBleHRlcm5hbCBTRVAtNDAgcHJpY2UgZmVlZCBiZWZvcmUgaXQgaXMgcmVqZWN0ZWQKYXMgc3RhbGUgKGluIHNlY29uZHMpLgAAAAAAABNzdGFsZW5lc3NfdGhyZXNob2xkAAAAAAY=",
        "AAAAAQAAAEtEYXRhIHJlcXVpcmVkIGR1cmluZyBhIFdBU00gbWlncmF0aW9uLiBTaW5nbGUgZGVmaW5pdGlvbiBmb3IgYWxsIGNvbnRyYWN0cy4AAAAAAAAAAA1NaWdyYXRpb25EYXRhAAAAAAAAAQAAAAAAAAAHdmVyc2lvbgAAAAAE",
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
        get_price: this.txFromJSON<i128>,
        initialize: this.txFromJSON<null>,
        bump_oracle_state: this.txFromJSON<null>,
        get_oracle_config: this.txFromJSON<OracleConfig>,
        set_oracle_config: this.txFromJSON<null>,
        set_oracle_sources: this.txFromJSON<null>
  }
}
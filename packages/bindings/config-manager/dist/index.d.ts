import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u32, u64, i128 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const ConfigManagerError: {
    1: {
        message: string;
    };
    2: {
        message: string;
    };
    3: {
        message: string;
    };
    /**
     * FeeSplits values do not sum to 10_000 bps.
     */
    4: {
        message: string;
    };
    /**
     * One or more ProtocolLimits values are out of acceptable range.
     */
    5: {
        message: string;
    };
};
export type StorageKey = {
    tag: "Initialized";
    values: void;
} | {
    tag: "Admin";
    values: void;
} | {
    tag: "RoleMember";
    values: readonly [RoleMemberKey];
} | {
    tag: "FeeSplits";
    values: void;
} | {
    tag: "ProtocolLimits";
    values: void;
} | {
    tag: "BorrowRateConfig";
    values: void;
} | {
    tag: "Version";
    values: void;
};
/**
 * Composite key for role membership entries.
 */
export interface RoleMemberKey {
    account: string;
    role: string;
}
export declare const UpgradeableError: {
    /**
     * When migration is attempted but not allowed due to upgrade state.
     */
    1100: {
        message: string;
    };
};
export declare const MerkleDistributorError: {
    /**
     * The merkle root is not set.
     */
    1300: {
        message: string;
    };
    /**
     * The provided index was already claimed.
     */
    1301: {
        message: string;
    };
    /**
     * The proof is invalid.
     */
    1302: {
        message: string;
    };
};
/**
 * Storage keys for the data associated with `MerkleDistributor`
 */
export type MerkleDistributorStorageKey = {
    tag: "Root";
    values: void;
} | {
    tag: "Claimed";
    values: readonly [u32];
};
/**
 * Rounding direction for division operations
 */
export type Rounding = {
    tag: "Floor";
    values: void;
} | {
    tag: "Ceil";
    values: void;
} | {
    tag: "Truncate";
    values: void;
};
export declare const SorobanFixedPointError: {
    /**
     * Arithmetic overflow occurred
     */
    1500: {
        message: string;
    };
    /**
     * Division by zero
     */
    1501: {
        message: string;
    };
};
export declare const CryptoError: {
    /**
     * The merkle proof length is out of bounds.
     */
    1400: {
        message: string;
    };
    /**
     * The index of the leaf is out of bounds.
     */
    1401: {
        message: string;
    };
    /**
     * No data in hasher state.
     */
    1402: {
        message: string;
    };
};
export declare const PausableError: {
    /**
     * The operation failed because the contract is paused.
     */
    1000: {
        message: string;
    };
    /**
     * The operation failed because the contract is not paused.
     */
    1001: {
        message: string;
    };
};
/**
 * Storage key for the pausable state
 */
export type PausableStorageKey = {
    tag: "Paused";
    values: void;
};
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
export declare const SharedError: {
    /**
     * Caller does not hold the required role. Discriminant matches every
     * protocol contract's `Unauthorized = 3` so error codes are consistent.
     */
    3: {
        message: string;
    };
};
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
    migrate: ({ migration_data, operator }: {
        migration_data: MigrationData;
        operator: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    upgrade: ({ new_wasm_hash, operator }: {
        new_wasm_hash: Buffer;
        operator: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a has_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    has_role: ({ role, account }: {
        role: string;
        account: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>;
    /**
     * Construct and simulate a grant_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    grant_role: ({ caller, role, account }: {
        caller: string;
        role: string;
        account: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    initialize: ({ admin_address }: {
        admin_address: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a revoke_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    revoke_role: ({ caller, role, account }: {
        caller: string;
        role: string;
        account: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_fee_splits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_fee_splits: (options?: MethodOptions) => Promise<AssembledTransaction<FeeSplits>>;
    /**
     * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    transfer_admin: ({ caller, new_admin }: {
        caller: string;
        new_admin: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a bump_config_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    bump_config_state: (options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_fee_splits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_fee_splits: ({ caller, fee_splits }: {
        caller: string;
        fee_splits: FeeSplits;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_protocol_limits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_protocol_limits: (options?: MethodOptions) => Promise<AssembledTransaction<ProtocolLimits>>;
    /**
     * Construct and simulate a get_borrow_rate_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_borrow_rate_config: (options?: MethodOptions) => Promise<AssembledTransaction<BorrowRateConfig>>;
    /**
     * Construct and simulate a update_protocol_limits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_protocol_limits: ({ caller, limits }: {
        caller: string;
        limits: ProtocolLimits;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_borrow_rate_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_borrow_rate_config: ({ caller, config }: {
        caller: string;
        config: BorrowRateConfig;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions & Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
    }): Promise<AssembledTransaction<T>>;
    constructor(options: ContractClientOptions);
    readonly fromJSON: {
        migrate: (json: string) => AssembledTransaction<null>;
        upgrade: (json: string) => AssembledTransaction<null>;
        has_role: (json: string) => AssembledTransaction<boolean>;
        grant_role: (json: string) => AssembledTransaction<null>;
        initialize: (json: string) => AssembledTransaction<null>;
        revoke_role: (json: string) => AssembledTransaction<null>;
        get_fee_splits: (json: string) => AssembledTransaction<FeeSplits>;
        transfer_admin: (json: string) => AssembledTransaction<null>;
        bump_config_state: (json: string) => AssembledTransaction<null>;
        update_fee_splits: (json: string) => AssembledTransaction<null>;
        get_protocol_limits: (json: string) => AssembledTransaction<ProtocolLimits>;
        get_borrow_rate_config: (json: string) => AssembledTransaction<BorrowRateConfig>;
        update_protocol_limits: (json: string) => AssembledTransaction<null>;
        update_borrow_rate_config: (json: string) => AssembledTransaction<null>;
    };
}

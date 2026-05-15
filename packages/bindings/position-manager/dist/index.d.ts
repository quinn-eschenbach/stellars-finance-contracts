import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u32, u64, i128 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const PositionManagerError: {
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
     * New trade would push vault utilization past MaxUtilizationRatio (85%).
     */
    4: {
        message: string;
    };
    /**
     * decrease_position called before MinPositionLifetime has elapsed.
     */
    5: {
        message: string;
    };
    6: {
        message: string;
    };
    7: {
        message: string;
    };
    8: {
        message: string;
    };
    /**
     * liquidate_position called but the position is still healthy.
     */
    9: {
        message: string;
    };
    /**
     * deleverage_position called but ADL trigger conditions are not met.
     */
    10: {
        message: string;
    };
    /**
     * Position leverage exceeds the per-market max leverage.
     */
    11: {
        message: string;
    };
    /**
     * No max leverage configured for this market symbol.
     */
    12: {
        message: string;
    };
    /**
     * execute_order called but neither TP nor SL trigger condition is met.
     */
    13: {
        message: string;
    };
    /**
     * Invalid take-profit or stop-loss price for the position direction.
     */
    14: {
        message: string;
    };
    /**
     * increase_position called with `is_long` opposite to the existing position's direction.
     */
    15: {
        message: string;
    };
    /**
     * Collateral below the protocol's min_collateral limit.
     */
    16: {
        message: string;
    };
    /**
     * ADL target position is not profitable (PnL <= 0).
     */
    17: {
        message: string;
    };
    /**
     * Max leverage exceeds the absolute safety cap (200x).
     */
    18: {
        message: string;
    };
    /**
     * Mark price at execution time exceeded the trader's `acceptable_price`.
     */
    19: {
        message: string;
    };
    /**
     * `set_max_leverage` called with a value below `MIN_LEVERAGE`. Use
     * `disable_market` to take a market offline instead.
     */
    20: {
        message: string;
    };
    /**
     * Trading is disabled for this market — `enable_market` re-opens it.
     */
    21: {
        message: string;
    };
    /**
     * `decrease_position` called with `size_delta > pos.size`. Use
     * `pos.size` (or simply close fully) instead of over-closing.
     */
    22: {
        message: string;
    };
    /**
     * `upgrade` rejected — no `propose_upgrade` was made before commit.
     */
    23: {
        message: string;
    };
    /**
     * `upgrade` rejected — timelock has not elapsed yet.
     */
    24: {
        message: string;
    };
    /**
     * `upgrade` rejected — `new_wasm_hash` does not match the proposed
     * `PendingUpgrade.wasm_hash`.
     */
    25: {
        message: string;
    };
};
export type StorageKey = {
    tag: "Initialized";
    values: void;
} | {
    tag: "VaultAddress";
    values: void;
} | {
    tag: "ConfigManager";
    values: void;
} | {
    tag: "OracleRouter";
    values: void;
} | {
    tag: "IsPaused";
    values: void;
} | {
    tag: "Version";
    values: void;
} | {
    tag: "RealizedPnl";
    values: void;
} | {
    tag: "TotalUnrealizedPnl";
    values: void;
} | {
    tag: "MarketUnrealizedPnl";
    values: readonly [string];
} | {
    tag: "LastUnpauseTime";
    values: void;
} | {
    tag: "MaxLeverage";
    values: readonly [string];
} | {
    tag: "MarketDisabled";
    values: readonly [string];
} | {
    tag: "Position";
    values: readonly [PositionKey];
} | {
    tag: "Market";
    values: readonly [string];
};
/**
 * Composite key for looking up a position by trader address and asset symbol.
 */
export interface PositionKey {
    symbol: string;
    trader: string;
}
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
 * Pending WASM upgrade — set by `propose_upgrade`, consumed by `upgrade`
 * (cleared atomically on a successful install), or cleared by `cancel_upgrade`.
 * Single shape across every protocol contract; all four contracts store it at
 * the shared `pending_upgrade` Symbol key in their own instance storage (see
 * `interfaces::upgrade::pending_upgrade_key`). `upgrade` refuses to install
 * unless `pending.wasm_hash` matches the supplied hash and `now >= eta`.
 */
export interface PendingUpgrade {
    eta: u64;
    wasm_hash: Buffer;
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
 * Defines how protocol revenue is split between parties.
 * All values are in basis points (bps). Must sum to 10_000.
 */
export interface FeeSplits {
    dev_bps: u32;
    keeper_bps: u32;
    lp_bps: u32;
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
     * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    pause: ({ caller }: {
        caller: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a migrate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    migrate: ({ migration_data, operator }: {
        migration_data: MigrationData;
        operator: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    unpause: ({ caller }: {
        caller: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    upgrade: ({ new_wasm_hash, operator }: {
        new_wasm_hash: Buffer;
        operator: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a set_tp_sl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_tp_sl: ({ trader, symbol, take_profit, stop_loss }: {
        trader: string;
        symbol: string;
        take_profit: i128;
        stop_loss: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_market: ({ symbol }: {
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<MarketInfo>>;
    /**
     * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    initialize: ({ admin, vault_address, config_manager, oracle_router }: {
        admin: string;
        vault_address: string;
        config_manager: string;
        oracle_router: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_position: ({ trader, symbol }: {
        trader: string;
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Position>>;
    /**
     * Construct and simulate a bump_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    bump_position: ({ user_address, symbol }: {
        user_address: string;
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a enable_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    enable_market: ({ caller, symbol }: {
        caller: string;
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a execute_order transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    execute_order: ({ caller, trader, symbol }: {
        caller: string;
        trader: string;
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a cancel_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    cancel_upgrade: ({ caller }: {
        caller: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a disable_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    disable_market: ({ caller, symbol }: {
        caller: string;
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_indices transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_indices: ({ caller, symbol }: {
        caller: string;
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a propose_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    propose_upgrade: ({ caller, wasm_hash }: {
        caller: string;
        wasm_hash: Buffer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_max_leverage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_max_leverage: ({ symbol }: {
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a set_max_leverage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_max_leverage: ({ caller, symbol, max_leverage }: {
        caller: string;
        symbol: string;
        max_leverage: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a decrease_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    decrease_position: ({ trader, symbol, size_delta }: {
        trader: string;
        symbol: string;
        size_delta: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a increase_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    increase_position: ({ trader, symbol, size, collateral, is_long, take_profit, stop_loss, acceptable_price }: {
        trader: string;
        symbol: string;
        size: i128;
        collateral: i128;
        is_long: boolean;
        take_profit: i128;
        stop_loss: i128;
        acceptable_price: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a is_market_disabled transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    is_market_disabled: ({ symbol }: {
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>;
    /**
     * Construct and simulate a liquidate_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    liquidate_position: ({ caller, trader, symbol }: {
        caller: string;
        trader: string;
        symbol: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a deleverage_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    deleverage_position: ({ caller, trader, symbol }: {
        caller: string;
        trader: string;
        symbol: string;
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
        pause: (json: string) => AssembledTransaction<null>;
        migrate: (json: string) => AssembledTransaction<null>;
        unpause: (json: string) => AssembledTransaction<null>;
        upgrade: (json: string) => AssembledTransaction<null>;
        set_tp_sl: (json: string) => AssembledTransaction<null>;
        get_market: (json: string) => AssembledTransaction<MarketInfo>;
        initialize: (json: string) => AssembledTransaction<null>;
        get_position: (json: string) => AssembledTransaction<Position>;
        bump_position: (json: string) => AssembledTransaction<null>;
        enable_market: (json: string) => AssembledTransaction<null>;
        execute_order: (json: string) => AssembledTransaction<null>;
        cancel_upgrade: (json: string) => AssembledTransaction<null>;
        disable_market: (json: string) => AssembledTransaction<null>;
        update_indices: (json: string) => AssembledTransaction<null>;
        propose_upgrade: (json: string) => AssembledTransaction<null>;
        get_max_leverage: (json: string) => AssembledTransaction<bigint>;
        set_max_leverage: (json: string) => AssembledTransaction<null>;
        decrease_position: (json: string) => AssembledTransaction<null>;
        increase_position: (json: string) => AssembledTransaction<null>;
        is_market_disabled: (json: string) => AssembledTransaction<boolean>;
        liquidate_position: (json: string) => AssembledTransaction<null>;
        deleverage_position: (json: string) => AssembledTransaction<null>;
    };
}

import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u32, u64, i128, Option } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const VaultError: {
    1: {
        message: string;
    };
    2: {
        message: string;
    };
    3: {
        message: string;
    };
    4: {
        message: string;
    };
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
     * Reservation would exceed total vault assets.
     */
    9: {
        message: string;
    };
    /**
     * claim_fees_to amount exceeds available unclaimed fees.
     */
    10: {
        message: string;
    };
};
export type VaultDataKey = {
    tag: "Initialized";
    values: void;
} | {
    tag: "ConfigManager";
    values: void;
} | {
    tag: "PositionManager";
    values: void;
} | {
    tag: "ReservedUsdc";
    values: void;
} | {
    tag: "UnclaimedFees";
    values: void;
} | {
    tag: "NetGlobalTraderPnl";
    values: void;
} | {
    tag: "IsPaused";
    values: void;
} | {
    tag: "Version";
    values: void;
} | {
    tag: "LockupExpiresAt";
    values: readonly [string];
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
export interface OwnerTokensKey {
    index: u32;
    owner: string;
}
/**
 * Storage keys for the data associated with the enumerable extension of
 * `NonFungibleToken`
 */
export type NFTEnumerableStorageKey = {
    tag: "TotalSupply";
    values: void;
} | {
    tag: "OwnerTokens";
    values: readonly [OwnerTokensKey];
} | {
    tag: "OwnerTokensIndex";
    values: readonly [u32];
} | {
    tag: "GlobalTokens";
    values: readonly [u32];
} | {
    tag: "GlobalTokensIndex";
    values: readonly [u32];
};
/**
 * Storage keys for the data associated with the consecutive extension of
 * `NonFungibleToken`
 */
export type NFTConsecutiveStorageKey = {
    tag: "Approval";
    values: readonly [u32];
} | {
    tag: "Owner";
    values: readonly [u32];
} | {
    tag: "OwnershipBucket";
    values: readonly [u32];
} | {
    tag: "BurnedToken";
    values: readonly [u32];
};
/**
 * Storage container for royalty information
 */
export interface RoyaltyInfo {
    basis_points: u32;
    receiver: string;
}
/**
 * Storage keys for royalty data
 */
export type NFTRoyaltiesStorageKey = {
    tag: "DefaultRoyalty";
    values: void;
} | {
    tag: "TokenRoyalty";
    values: readonly [u32];
};
export declare const NonFungibleTokenError: {
    /**
     * Indicates a non-existent `token_id`.
     */
    200: {
        message: string;
    };
    /**
     * Indicates an error related to the ownership over a particular token.
     * Used in transfers.
     */
    201: {
        message: string;
    };
    /**
     * Indicates a failure with the `operator`s approval. Used in transfers.
     */
    202: {
        message: string;
    };
    /**
     * Indicates a failure with the `approver` of a token to be approved. Used
     * in approvals.
     */
    203: {
        message: string;
    };
    /**
     * Indicates an invalid value for `live_until_ledger` when setting
     * approvals.
     */
    204: {
        message: string;
    };
    /**
     * Indicates overflow when adding two values
     */
    205: {
        message: string;
    };
    /**
     * Indicates all possible `token_id`s are already in use.
     */
    206: {
        message: string;
    };
    /**
     * Indicates an invalid amount to batch mint in `consecutive` extension.
     */
    207: {
        message: string;
    };
    /**
     * Indicates the token does not exist in owner's list.
     */
    208: {
        message: string;
    };
    /**
     * Indicates the token does not exist in global list.
     */
    209: {
        message: string;
    };
    /**
     * Indicates access to unset metadata.
     */
    210: {
        message: string;
    };
    /**
     * Indicates the length of the base URI exceeds the maximum allowed.
     */
    211: {
        message: string;
    };
    /**
     * Indicates the royalty amount is higher than 10_000 (100%) basis points.
     */
    212: {
        message: string;
    };
    /**
     * Indicates the length of the name exceeds the maximum allowed.
     */
    213: {
        message: string;
    };
    /**
     * Indicates the length of the symbol exceeds the maximum allowed.
     */
    214: {
        message: string;
    };
};
export type NFTSequentialStorageKey = {
    tag: "TokenIdCounter";
    values: void;
};
/**
 * Storage container for token metadata
 */
export interface Metadata {
    base_uri: string;
    name: string;
    symbol: string;
}
/**
 * Storage container for the token for which an approval is granted
 * and the ledger number at which this approval expires.
 */
export interface ApprovalData {
    approved: string;
    live_until_ledger: u32;
}
/**
 * Storage keys for the data associated with `NonFungibleToken`
 */
export type NFTStorageKey = {
    tag: "Owner";
    values: readonly [u32];
} | {
    tag: "Balance";
    values: readonly [string];
} | {
    tag: "Approval";
    values: readonly [u32];
} | {
    tag: "ApprovalForAll";
    values: readonly [string, string];
} | {
    tag: "Metadata";
    values: void;
};
/**
 * Hook types for modular compliance system.
 *
 * Each hook type represents a specific event or validation point
 * where compliance modules can be executed.
 */
export type ComplianceHook = {
    tag: "Transferred";
    values: void;
} | {
    tag: "Created";
    values: void;
} | {
    tag: "Destroyed";
    values: void;
} | {
    tag: "CanTransfer";
    values: void;
} | {
    tag: "CanCreate";
    values: void;
};
export declare const ComplianceError: {
    /**
     * Indicates a module is already registered for this hook.
     */
    360: {
        message: string;
    };
    /**
     * Indicates a module is not registered for this hook.
     */
    361: {
        message: string;
    };
    /**
     * Indicates a module bound is exceeded.
     */
    362: {
        message: string;
    };
    /**
     * Indicates a token is not bound to this compliance contract.
     */
    363: {
        message: string;
    };
};
/**
 * Storage keys for the modular compliance contract.
 */
export type ComplianceDataKey = {
    tag: "HookModules";
    values: readonly [ComplianceHook];
};
/**
 * Error codes for document management operations.
 */
export declare const DocumentError: {
    /**
     * The specified document was not found.
     */
    380: {
        message: string;
    };
    /**
     * Maximum number of documents has been reached.
     */
    381: {
        message: string;
    };
    /**
     * The URI exceeds the maximum allowed length.
     */
    382: {
        message: string;
    };
};
/**
 * Represents a document with its metadata.
 */
export interface Document {
    /**
   * The hash of the document contents.
   */
    document_hash: Buffer;
    /**
   * Timestamp when the document was last modified.
   */
    timestamp: u64;
    /**
   * The URI where the document can be accessed.
   */
    uri: string;
}
/**
 * Storage keys for document management.
 */
export type DocumentStorageKey = {
    tag: "Index";
    values: readonly [Buffer];
} | {
    tag: "Bucket";
    values: readonly [u32];
} | {
    tag: "Count";
    values: void;
};
export declare const ClaimIssuerError: {
    /**
     * Signature data length does not match the expected scheme.
     */
    350: {
        message: string;
    };
    /**
     * The provided key is empty.
     */
    351: {
        message: string;
    };
    /**
     * The key is already allowed for the specified topic.
     */
    352: {
        message: string;
    };
    /**
     * The specified key was not found in the allowed keys.
     */
    353: {
        message: string;
    };
    /**
     * The claim issuer is not allowed to sign claims about the specified
     * claim topic.
     */
    354: {
        message: string;
    };
    /**
     * Maximum limit exceeded (keys per topic or registries per key).
     */
    355: {
        message: string;
    };
    /**
     * No signing keys found for the specified claim topic.
     */
    356: {
        message: string;
    };
    /**
     * Invalid claim data encoding.
     */
    357: {
        message: string;
    };
    /**
     * Recovery of the Secp256k1 public key failed.
     */
    358: {
        message: string;
    };
    /**
     * Indicates overflow when adding two values.
     */
    359: {
        message: string;
    };
};
export interface SigningKey {
    public_key: Buffer;
    scheme: u32;
}
/**
 * Signature data for Ed25519 scheme.
 */
export interface Ed25519SignatureData {
    public_key: Buffer;
    signature: Buffer;
}
/**
 * Storage keys for claim issuer key management.
 */
export type ClaimIssuerStorageKey = {
    tag: "Topics";
    values: readonly [u32];
} | {
    tag: "Pairs";
    values: readonly [SigningKey];
} | {
    tag: "RevokedClaim";
    values: readonly [Buffer];
} | {
    tag: "ClaimNonce";
    values: readonly [string, u32];
};
/**
 * Signature data for Secp256k1 scheme.
 */
export interface Secp256k1SignatureData {
    public_key: Buffer;
    recovery_id: u32;
    signature: Buffer;
}
/**
 * Signature data for Secp256r1 scheme.
 */
export interface Secp256r1SignatureData {
    public_key: Buffer;
    signature: Buffer;
}
export declare const ClaimsError: {
    /**
     * Claim  ID does not exist.
     */
    340: {
        message: string;
    };
    /**
     * Claim Issuer cannot validate the claim (revocation, signature mismatch,
     * unauthorized signing key, etc.)
     */
    341: {
        message: string;
    };
};
/**
 * Represents a claim stored on-chain.
 */
export interface Claim {
    /**
   * The claim data
   */
    data: Buffer;
    /**
   * The address of the claim issuer
   */
    issuer: string;
    /**
   * The signature scheme used
   */
    scheme: u32;
    /**
   * The cryptographic signature
   */
    signature: Buffer;
    /**
   * The claim topic (numeric identifier)
   */
    topic: u32;
    /**
   * Optional URI for additional information
   */
    uri: string;
}
/**
 * Storage keys for the data associated with Identity Claims.
 */
export type ClaimsStorageKey = {
    tag: "Claim";
    values: readonly [Buffer];
} | {
    tag: "ClaimsByTopic";
    values: readonly [u32];
};
/**
 * Storage keys for the data associated with `RWA` token
 */
export type IdentityVerifierStorageKey = {
    tag: "ClaimTopicsAndIssuers";
    values: void;
} | {
    tag: "IdentityRegistryStorage";
    values: void;
};
export declare const RWAError: {
    /**
     * Indicates an error related to insufficient balance for the operation.
     */
    300: {
        message: string;
    };
    /**
     * Indicates an error when an input must be >= 0.
     */
    301: {
        message: string;
    };
    /**
     * Indicates the address is frozen and cannot perform operations.
     */
    302: {
        message: string;
    };
    /**
     * Indicates insufficient free tokens (due to partial freezing).
     */
    303: {
        message: string;
    };
    /**
     * Indicates an identity cannot be verified.
     */
    304: {
        message: string;
    };
    /**
     * Indicates the transfer does not comply with the compliance rules.
     */
    305: {
        message: string;
    };
    /**
     * Indicates the mint operation does not comply with the compliance rules.
     */
    306: {
        message: string;
    };
    /**
     * Indicates the compliance contract is not set.
     */
    307: {
        message: string;
    };
    /**
     * Indicates the onchain ID is not set.
     */
    308: {
        message: string;
    };
    /**
     * Indicates the version is not set.
     */
    309: {
        message: string;
    };
    /**
     * Indicates the claim topics and issuers contract is not set.
     */
    310: {
        message: string;
    };
    /**
     * Indicates the identity registry storage contract is not set.
     */
    311: {
        message: string;
    };
    /**
     * Indicates the identity verifier contract is not set.
     */
    312: {
        message: string;
    };
    /**
     * Indicates the old account and new account have different identities.
     */
    313: {
        message: string;
    };
};
export declare const ClaimTopicsAndIssuersError: {
    /**
     * Indicates a non-existent claim topic.
     */
    370: {
        message: string;
    };
    /**
     * Indicates a non-existent trusted issuer.
     */
    371: {
        message: string;
    };
    /**
     * Indicates a claim topic already exists.
     */
    372: {
        message: string;
    };
    /**
     * Indicates a trusted issuer already exists.
     */
    373: {
        message: string;
    };
    /**
     * Indicates max claim topics limit is reached.
     */
    374: {
        message: string;
    };
    /**
     * Indicates max trusted issuers limit is reached.
     */
    375: {
        message: string;
    };
    /**
     * Indicates claim topics set provided for the issuer cannot be empty.
     */
    376: {
        message: string;
    };
};
/**
 * Storage keys for the data associated with the claim topics and issuers
 * extension
 */
export type ClaimTopicsAndIssuersStorageKey = {
    tag: "ClaimTopics";
    values: void;
} | {
    tag: "TrustedIssuers";
    values: void;
} | {
    tag: "IssuerClaimTopics";
    values: readonly [string];
} | {
    tag: "ClaimTopicIssuers";
    values: readonly [u32];
};
/**
 * Error codes for the Identity Registry Storage system.
 */
export declare const IRSError: {
    /**
     * An identity already exists for the given account.
     */
    320: {
        message: string;
    };
    /**
     * No identity found for the given account.
     */
    321: {
        message: string;
    };
    /**
     * Country data not found at the specified index.
     */
    322: {
        message: string;
    };
    /**
     * Identity can't be with empty country data list.
     */
    323: {
        message: string;
    };
    /**
     * The maximum number of country entries has been reached.
     */
    324: {
        message: string;
    };
    /**
     * Account has been recovered and cannot be used.
     */
    325: {
        message: string;
    };
    /**
     * Metadata has too many entries (exceeds MAX_METADATA_ENTRIES).
     */
    326: {
        message: string;
    };
    /**
     * Metadata string value is too long (exceeds MAX_METADATA_STRING_LEN).
     */
    327: {
        message: string;
    };
};
/**
 * A country data containing the country relationship and optional metadata
 */
export interface CountryData {
    /**
   * Type of country relationship
   */
    country: CountryRelation;
    /**
   * Optional metadata (e.g., visa type, validity period)
   */
    metadata: Option<Map<string, string>>;
}
/**
 * Represents the type of identity holder
 */
export type IdentityType = {
    tag: "Individual";
    values: void;
} | {
    tag: "Organization";
    values: void;
};
/**
 * Storage keys for the data associated with Identity Storage Registry.
 */
export type IRSStorageKey = {
    tag: "Identity";
    values: readonly [string];
} | {
    tag: "IdentityProfile";
    values: readonly [string];
} | {
    tag: "RecoveredTo";
    values: readonly [string];
};
/**
 * Unified country relationship that can be either individual or organizational
 */
export type CountryRelation = {
    tag: "Individual";
    values: readonly [IndividualCountryRelation];
} | {
    tag: "Organization";
    values: readonly [OrganizationCountryRelation];
};
/**
 * Complete identity profile containing identity type and country data
 */
export interface IdentityProfile {
    countries: Array<CountryData>;
    identity_type: IdentityType;
}
/**
 * Represents different types of country relationships for individuals
 * ISO 3166-1 numeric country code
 */
export type IndividualCountryRelation = {
    tag: "Residence";
    values: readonly [u32];
} | {
    tag: "Citizenship";
    values: readonly [u32];
} | {
    tag: "SourceOfFunds";
    values: readonly [u32];
} | {
    tag: "TaxResidency";
    values: readonly [u32];
} | {
    tag: "Custom";
    values: readonly [string, u32];
};
/**
 * Represents different types of country relationships for organizations
 */
export type OrganizationCountryRelation = {
    tag: "Incorporation";
    values: readonly [u32];
} | {
    tag: "OperatingJurisdiction";
    values: readonly [u32];
} | {
    tag: "TaxJurisdiction";
    values: readonly [u32];
} | {
    tag: "SourceOfFunds";
    values: readonly [u32];
} | {
    tag: "Custom";
    values: readonly [string, u32];
};
/**
 * Error codes for the Token Binder system.
 */
export declare const TokenBinderError: {
    /**
     * The specified token was not found in the bound tokens list.
     */
    330: {
        message: string;
    };
    /**
     * Attempted to bind a token that is already bound.
     */
    331: {
        message: string;
    };
    /**
     * Total token capacity (MAX_TOKENS) has been reached.
     */
    332: {
        message: string;
    };
    /**
     * Batch bind size exceeded.
     */
    333: {
        message: string;
    };
    /**
     * The batch contains duplicates.
     */
    334: {
        message: string;
    };
};
/**
 * Storage keys for the token binder system.
 *
 * - Tokens are stored in buckets of 100 addresses each
 * - Each bucket is a `Vec<Address>` stored under its bucket index
 * - Total count is tracked separately
 * - When a token is unbound, the last token is moved to fill the gap
 * (swap-remove pattern)
 */
export type TokenBinderStorageKey = {
    tag: "TokenBucket";
    values: readonly [u32];
} | {
    tag: "TotalCount";
    values: void;
};
/**
 * Storage keys for the data associated with `RWA` token
 */
export type RWAStorageKey = {
    tag: "AddressFrozen";
    values: readonly [string];
} | {
    tag: "FrozenTokens";
    values: readonly [string];
} | {
    tag: "Compliance";
    values: void;
} | {
    tag: "OnchainId";
    values: void;
} | {
    tag: "Version";
    values: void;
} | {
    tag: "IdentityVerifier";
    values: void;
};
export declare const VaultTokenError: {
    /**
     * Indicates access to uninitialized vault asset address.
     */
    400: {
        message: string;
    };
    /**
     * Indicates that vault asset address is already set.
     */
    401: {
        message: string;
    };
    /**
     * Indicates that vault virtual decimals offset is already set.
     */
    402: {
        message: string;
    };
    /**
     * Indicates the amount is not a valid vault assets value.
     */
    403: {
        message: string;
    };
    /**
     * Indicates the amount is not a valid vault shares value.
     */
    404: {
        message: string;
    };
    /**
     * Attempted to deposit more assets than the max amount for address.
     */
    405: {
        message: string;
    };
    /**
     * Attempted to mint more shares than the max amount for address.
     */
    406: {
        message: string;
    };
    /**
     * Attempted to withdraw more assets than the max amount for address.
     */
    407: {
        message: string;
    };
    /**
     * Attempted to redeem more shares than the max amount for address.
     */
    408: {
        message: string;
    };
    /**
     * Maximum number of decimals offset exceeded
     */
    409: {
        message: string;
    };
    /**
     * Indicates overflow due to mathematical operations
     */
    410: {
        message: string;
    };
};
/**
 * Storage keys for the data associated with the vault extension
 */
export type VaultStorageKey = {
    tag: "AssetAddress";
    values: void;
} | {
    tag: "VirtualDecimalsOffset";
    values: void;
};
/**
 * Storage keys for the data associated with the allowlist extension
 */
export type AllowListStorageKey = {
    tag: "Allowed";
    values: readonly [string];
};
/**
 * Storage keys for the data associated with the blocklist extension
 */
export type BlockListStorageKey = {
    tag: "Blocked";
    values: readonly [string];
};
export declare const FungibleTokenError: {
    /**
     * Indicates an error related to the current balance of account from which
     * tokens are expected to be transferred.
     */
    100: {
        message: string;
    };
    /**
     * Indicates a failure with the allowance mechanism when a given spender
     * doesn't have enough allowance.
     */
    101: {
        message: string;
    };
    /**
     * Indicates an invalid value for `live_until_ledger` when setting an
     * allowance.
     */
    102: {
        message: string;
    };
    /**
     * Indicates an error when an input that must be >= 0
     */
    103: {
        message: string;
    };
    /**
     * Indicates overflow when adding two values
     */
    104: {
        message: string;
    };
    /**
     * Indicates access to uninitialized metadata
     */
    105: {
        message: string;
    };
    /**
     * Indicates that the operation would have caused `total_supply` to exceed
     * the `cap`.
     */
    106: {
        message: string;
    };
    /**
     * Indicates the supplied `cap` is not a valid cap value.
     */
    107: {
        message: string;
    };
    /**
     * Indicates the Cap was not set.
     */
    108: {
        message: string;
    };
    /**
     * Indicates the SAC address was not set.
     */
    109: {
        message: string;
    };
    /**
     * Indicates a SAC address different than expected.
     */
    110: {
        message: string;
    };
    /**
     * Indicates a missing function parameter in the SAC contract context.
     */
    111: {
        message: string;
    };
    /**
     * Indicates an invalid function parameter in the SAC contract context.
     */
    112: {
        message: string;
    };
    /**
     * The user is not allowed to perform this operation
     */
    113: {
        message: string;
    };
    /**
     * The user is blocked and cannot perform this operation
     */
    114: {
        message: string;
    };
};
/**
 * Storage key for accessing the SAC address
 */
export type SACAdminGenericDataKey = {
    tag: "Sac";
    values: void;
};
/**
 * Storage key for accessing the SAC address
 */
export type SACAdminWrapperDataKey = {
    tag: "Sac";
    values: void;
};
/**
 * Storage container for token metadata
 */
export interface Metadata {
    decimals: u32;
    name: string;
    symbol: string;
}
/**
 * Storage keys for the data associated with `FungibleToken`
 */
export type StorageKey = {
    tag: "TotalSupply";
    values: void;
} | {
    tag: "Balance";
    values: readonly [string];
} | {
    tag: "Allowance";
    values: readonly [AllowanceKey];
};
/**
 * Storage key that maps to [`AllowanceData`]
 */
export interface AllowanceKey {
    owner: string;
    spender: string;
}
/**
 * Storage container for the amount of tokens for which an allowance is granted
 * and the ledger number at which this allowance expires.
 */
export interface AllowanceData {
    amount: i128;
    live_until_ledger: u32;
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
export interface Client {
    /**
     * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    mint: ({ shares, receiver, from, operator }: {
        shares: i128;
        receiver: string;
        from: string;
        operator: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Returns the name for this token.
     *
     * # Arguments
     *
     * * `e` - Access to Soroban environment.
     */
    name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    pause: ({ caller }: {
        caller: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    redeem: ({ shares, receiver, owner, operator }: {
        shares: i128;
        receiver: string;
        owner: string;
        operator: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Returns the symbol for this token.
     *
     * # Arguments
     *
     * * `e` - Access to Soroban environment.
     */
    symbol: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Sets the amount of tokens a `spender` is allowed to spend on behalf of
     * an `owner`. Overrides any existing allowance set between `spender` and
     * `owner`.
     *
     * # Arguments
     *
     * * `e` - Access to Soroban environment.
     * * `owner` - The address holding the tokens.
     * * `spender` - The address authorized to spend the tokens.
     * * `amount` - The amount of tokens made available to `spender`.
     * * `live_until_ledger` - The ledger number at which the allowance
     * expires.
     *
     * # Errors
     *
     * * [`FungibleTokenError::InvalidLiveUntilLedger`] - Occurs when
     * attempting to set `live_until_ledger` that is less than the current
     * ledger number and greater than `0`.
     * * [`FungibleTokenError::LessThanZero`] - Occurs when `amount < 0`.
     *
     * # Events
     *
     * * topics - `["approve", from: Address, spender: Address]`
     * * data - `[amount: i128, live_until_ledger: u32]`
     */
    approve: ({ owner, spender, amount, live_until_ledger }: {
        owner: string;
        spender: string;
        amount: i128;
        live_until_ledger: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Returns the amount of tokens held by `account`.
     *
     * # Arguments
     *
     * * `e` - Access to the Soroban environment.
     * * `account` - The address for which the balance is being queried.
     */
    balance: ({ account }: {
        account: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    deposit: ({ assets, receiver, from, operator }: {
        assets: i128;
        receiver: string;
        from: string;
        operator: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
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
     * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    decimals: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>;
    /**
     * Construct and simulate a max_mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    max_mint: ({ receiver }: {
        receiver: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Override to propagate the sender's remaining lockup onto the recipient.
     * Without this, an LP could circumvent the cooldown by transferring LP
     * shares to a fresh address that then withdraws.
     */
    transfer: ({ from, to, amount }: {
        from: string;
        to: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    withdraw: ({ assets, receiver, owner, operator }: {
        assets: i128;
        receiver: string;
        owner: string;
        operator: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Returns the amount of tokens a `spender` is allowed to spend on behalf
     * of an `owner`.
     *
     * # Arguments
     *
     * * `e` - Access to Soroban environment.
     * * `owner` - The address holding the tokens.
     * * `spender` - The address authorized to spend the tokens.
     */
    allowance: ({ owner, spender }: {
        owner: string;
        spender: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a claim_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    claim_fees: ({ caller, recipient }: {
        caller: string;
        recipient: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    initialize: ({ admin, asset, config_manager, position_manager }: {
        admin: string;
        asset: string;
        config_manager: string;
        position_manager: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a max_redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    max_redeem: ({ owner }: {
        owner: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a pay_profit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Pay `amount` from the vault to `trader` to settle a profitable close.
     * Loss settlement does NOT route through here — see ADR-0001.
     */
    pay_profit: ({ caller, trader, amount }: {
        caller: string;
        trader: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a accrue_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    accrue_fees: ({ caller, amount }: {
        caller: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a max_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    max_deposit: ({ receiver }: {
        receiver: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a query_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    query_asset: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a max_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    max_withdraw: ({ owner }: {
        owner: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a preview_mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    preview_mint: ({ shares }: {
        shares: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a total_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    total_assets: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a total_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Returns the total amount of tokens in circulation.
     *
     * # Arguments
     *
     * * `e` - Access to the Soroban environment.
     */
    total_supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a claim_fees_to transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    claim_fees_to: ({ caller, recipient, amount }: {
        caller: string;
        recipient: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a reserved_usdc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    reserved_usdc: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Same lockup-propagation guarantee for the allowance-based path.
     */
    transfer_from: ({ spender, from, to, amount }: {
        spender: string;
        from: string;
        to: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a free_liquidity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    free_liquidity: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a preview_redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    preview_redeem: ({ shares }: {
        shares: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a update_net_pnl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_net_pnl: ({ caller, pnl }: {
        caller: string;
        pnl: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a preview_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    preview_deposit: ({ assets }: {
        assets: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a bump_vault_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    bump_vault_state: (options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a preview_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    preview_withdraw: ({ assets }: {
        assets: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a convert_to_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    convert_to_assets: ({ shares }: {
        shares: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a convert_to_shares transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    convert_to_shares: ({ assets }: {
        assets: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a lockup_expires_at transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Returns the unix timestamp at which `user` may next withdraw/redeem.
     * Returns 0 if `user` has never deposited (no lockup recorded).
     */
    lockup_expires_at: ({ user }: {
        user: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
    /**
     * Construct and simulate a release_liquidity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    release_liquidity: ({ caller, amount }: {
        caller: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a reserve_liquidity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    reserve_liquidity: ({ caller, amount }: {
        caller: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a record_absorbed_collateral transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Notify the vault that PositionManager has just transferred `amount`
     * USDC of seized/loss-settlement collateral directly into the vault's
     * wallet. This call does NOT move tokens — it only verifies the caller
     * is PM, then emits an event so off-chain indexers can update their
     * tracked total_assets in lockstep with the vault's actual on-chain
     * balance. See ADR-0001 for why losses bypass `pay_profit`.
     */
    record_absorbed_collateral: ({ caller, trader, amount }: {
        caller: string;
        trader: string;
        amount: i128;
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
        mint: (json: string) => AssembledTransaction<bigint>;
        name: (json: string) => AssembledTransaction<string>;
        pause: (json: string) => AssembledTransaction<null>;
        redeem: (json: string) => AssembledTransaction<bigint>;
        symbol: (json: string) => AssembledTransaction<string>;
        approve: (json: string) => AssembledTransaction<null>;
        balance: (json: string) => AssembledTransaction<bigint>;
        deposit: (json: string) => AssembledTransaction<bigint>;
        migrate: (json: string) => AssembledTransaction<null>;
        unpause: (json: string) => AssembledTransaction<null>;
        upgrade: (json: string) => AssembledTransaction<null>;
        decimals: (json: string) => AssembledTransaction<number>;
        max_mint: (json: string) => AssembledTransaction<bigint>;
        transfer: (json: string) => AssembledTransaction<null>;
        withdraw: (json: string) => AssembledTransaction<bigint>;
        allowance: (json: string) => AssembledTransaction<bigint>;
        claim_fees: (json: string) => AssembledTransaction<null>;
        initialize: (json: string) => AssembledTransaction<null>;
        max_redeem: (json: string) => AssembledTransaction<bigint>;
        pay_profit: (json: string) => AssembledTransaction<null>;
        accrue_fees: (json: string) => AssembledTransaction<null>;
        max_deposit: (json: string) => AssembledTransaction<bigint>;
        query_asset: (json: string) => AssembledTransaction<string>;
        max_withdraw: (json: string) => AssembledTransaction<bigint>;
        preview_mint: (json: string) => AssembledTransaction<bigint>;
        total_assets: (json: string) => AssembledTransaction<bigint>;
        total_supply: (json: string) => AssembledTransaction<bigint>;
        claim_fees_to: (json: string) => AssembledTransaction<null>;
        reserved_usdc: (json: string) => AssembledTransaction<bigint>;
        transfer_from: (json: string) => AssembledTransaction<null>;
        free_liquidity: (json: string) => AssembledTransaction<bigint>;
        preview_redeem: (json: string) => AssembledTransaction<bigint>;
        update_net_pnl: (json: string) => AssembledTransaction<null>;
        preview_deposit: (json: string) => AssembledTransaction<bigint>;
        bump_vault_state: (json: string) => AssembledTransaction<null>;
        preview_withdraw: (json: string) => AssembledTransaction<bigint>;
        convert_to_assets: (json: string) => AssembledTransaction<bigint>;
        convert_to_shares: (json: string) => AssembledTransaction<bigint>;
        lockup_expires_at: (json: string) => AssembledTransaction<bigint>;
        release_liquidity: (json: string) => AssembledTransaction<null>;
        reserve_liquidity: (json: string) => AssembledTransaction<null>;
        record_absorbed_collateral: (json: string) => AssembledTransaction<null>;
    };
}

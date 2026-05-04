/**
 * Contract error tables — kept in sync with the `#[contracterror]` enums in
 * each Rust contract. When a Soroban transaction fails, the error message
 * generally embeds `Error(Contract, #<discriminant>)` for the failing
 * contract; we look it up here to produce a friendly toast message.
 *
 * Why hand-maintain this rather than codegen? The contract bindings only
 * type-export the enum names — the discriminant ↔ name mapping doesn't make
 * it through. These enums are small (≤ 20 variants) and change rarely, so a
 * literal table keeps the resolution path zero-runtime-dependency.
 */

import { StrKey, xdr } from "@stellar/stellar-sdk";
import { CONTRACTS } from "@/lib/constants";

interface ErrorTable {
  contract: string;
  by: Record<number, { name: string; message: string }>;
}

const positionManager: ErrorTable = {
  contract: "PositionManager",
  by: {
    1: { name: "AlreadyInitialized", message: "Position manager already initialized." },
    2: { name: "NotInitialized", message: "Position manager not initialized yet." },
    3: { name: "Paused", message: "Trading is paused." },
    4: { name: "UtilizationCapBreached", message: "Trade would push vault utilization past 85%. Try a smaller size." },
    5: { name: "PositionNotOldEnough", message: "Position is too young to close. Wait for the minimum lifetime." },
    6: { name: "PositionNotFound", message: "Position not found." },
    7: { name: "Unauthorized", message: "Not authorized for this action." },
    8: { name: "ZeroAmount", message: "Amount must be greater than zero." },
    9: { name: "HealthFactorOk", message: "Position is still healthy — can't be liquidated." },
    10: { name: "AdlNotTriggered", message: "ADL conditions not met." },
    11: { name: "ExcessiveLeverage", message: "Leverage exceeds this market's maximum." },
    12: { name: "MarketNotConfigured", message: "Market isn't configured. Try a different symbol." },
    13: { name: "OrderNotTriggered", message: "TP/SL trigger price not reached." },
    14: { name: "InvalidTpSl", message: "Invalid TP/SL price for this position direction." },
    15: { name: "DirectionMismatch", message: "Existing position is on the opposite side. Close it first." },
    16: { name: "BelowMinCollateral", message: "Collateral is below the protocol minimum." },
    17: { name: "AdlTargetNotProfitable", message: "ADL target position isn't profitable." },
    18: { name: "LeverageCapExceeded", message: "Max leverage exceeds the safety cap (200×)." },
  },
};

const vault: ErrorTable = {
  contract: "Vault",
  by: {
    1: { name: "AlreadyInitialized", message: "Vault already initialized." },
    2: { name: "NotInitialized", message: "Vault not initialized yet." },
    3: { name: "Paused", message: "Vault is paused." },
    4: { name: "InsufficientFreeLiquidity", message: "Not enough free liquidity to satisfy this withdrawal." },
    5: { name: "Unauthorized", message: "Not authorized for this vault action." },
    6: { name: "ZeroAmount", message: "Amount must be greater than zero." },
    7: { name: "NotPositionManager", message: "Only the position manager can call this." },
    8: { name: "CooldownNotElapsed", message: "LP withdrawal cooldown hasn't elapsed yet." },
    9: { name: "ReservationExceedsTotalAssets", message: "Reservation exceeds vault's total assets." },
    10: { name: "InsufficientFees", message: "Not enough unclaimed fees for this claim." },
  },
};

const oracleRouter: ErrorTable = {
  contract: "OracleRouter",
  by: {
    1: { name: "AlreadyInitialized", message: "Oracle router already initialized." },
    2: { name: "NotInitialized", message: "Oracle router not initialized yet." },
    3: { name: "Unauthorized", message: "Not authorized for oracle action." },
    4: { name: "StalePrice", message: "Price is stale — oracle hasn't updated recently." },
    5: { name: "PriceDeviationTooHigh", message: "Oracle sources disagree too much; price rejected." },
    6: { name: "NoPriceSources", message: "No oracle sources configured for this symbol." },
    7: { name: "PriceFetchFailed", message: "Oracle source call failed." },
    8: { name: "InvalidConfig", message: "Invalid oracle configuration." },
  },
};

const configManager: ErrorTable = {
  contract: "ConfigManager",
  by: {
    1: { name: "AlreadyInitialized", message: "Config manager already initialized." },
    2: { name: "NotInitialized", message: "Config manager not initialized yet." },
    3: { name: "Unauthorized", message: "Not authorized to change protocol config." },
    4: { name: "InvalidFeeSplits", message: "Fee split values must sum to 10_000 bps." },
    5: { name: "InvalidLimits", message: "Protocol limit value is out of acceptable range." },
  },
};

const oracle: ErrorTable = {
  contract: "Oracle",
  by: {
    1: { name: "AlreadyInitialized", message: "Oracle already initialized." },
    2: { name: "NotInitialized", message: "Oracle not initialized yet." },
    3: { name: "Unauthorized", message: "Not authorized to write oracle prices." },
    4: { name: "NoPriceSet", message: "No price has been published for this symbol yet." },
  },
};

const tables: ErrorTable[] = [positionManager, vault, oracleRouter, configManager, oracle];

interface ContractIdToTable {
  [contractId: string]: ErrorTable;
}

function buildContractMap(): ContractIdToTable {
  const map: ContractIdToTable = {};
  if (CONTRACTS.positionManager) map[CONTRACTS.positionManager] = positionManager;
  if (CONTRACTS.vault) map[CONTRACTS.vault] = vault;
  if (CONTRACTS.oracleRouter) map[CONTRACTS.oracleRouter] = oracleRouter;
  if (CONTRACTS.configManager) map[CONTRACTS.configManager] = configManager;
  if (CONTRACTS.oracle) map[CONTRACTS.oracle] = oracle;
  return map;
}

let contractMap: ContractIdToTable | null = null;
function getContractMap(): ContractIdToTable {
  if (!contractMap) contractMap = buildContractMap();
  return contractMap;
}

export interface ParsedContractError {
  /** Human-friendly message ready for a toast. */
  message: string;
  /** Variant name (e.g. "InsufficientFreeLiquidity") if we matched. */
  name?: string;
  /** Source contract name (e.g. "Vault"). */
  contract?: string;
  /** Numeric error code from the contracterror enum. */
  code?: number;
}

const CONTRACT_ERROR_RE = /Error\(Contract,\s*#?(\d+)\)/i;
const CONTRACT_ID_RE = /\b(C[A-Z0-9]{55})\b/; // Stellar contract addresses are 56-char "C..." strkeys
// Stellar tx result codes leak through stringified XDR as `"name":"txXxx"`.
// We probe for that as a last resort when the throw was a plain Error wrapping
// JSON.stringify(errorResult).
const TX_CODE_RE = /"name"\s*:\s*"(tx[A-Za-z]+)"/;

/**
 * Best-effort extraction of a Soroban contract error from anything thrown by
 * the SDK / wallet / RPC. Returns null if the payload doesn't look like a
 * structured contract error — caller should fall back to the raw message.
 */
export function parseContractError(input: unknown): ParsedContractError | null {
  const text = stringifyError(input);
  if (!text) return null;

  const codeMatch = CONTRACT_ERROR_RE.exec(text);
  if (!codeMatch) return null;
  const code = Number(codeMatch[1]);
  if (!Number.isFinite(code)) return null;

  // Try to find a contract address in the text and resolve it to a known
  // table. If none, fall back to scanning every table for the code.
  const idMatch = CONTRACT_ID_RE.exec(text);
  if (idMatch) {
    const table = getContractMap()[idMatch[1]];
    const variant = table?.by[code];
    if (table && variant) {
      return { message: variant.message, name: variant.name, contract: table.contract, code };
    }
  }

  for (const table of tables) {
    const variant = table.by[code];
    if (variant) {
      return { message: variant.message, name: variant.name, contract: table.contract, code };
    }
  }

  return { message: `Contract error #${code}`, code };
}

function stringifyError(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (input instanceof Error) {
    // SubmitError carries structured `details` — surface the friendly message
    // we already computed instead of falling back to `Error.stack` parsing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const det = (input as any).details;
    if (det && typeof det.message === "string") return det.message;
    return input.message + " " + (input.stack ?? "");
  }
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

/**
 * Stellar tx-level result codes (from the TransactionResultCode enum). These
 * fire BEFORE the host function executes, so they're never contract-specific.
 */
const TX_RESULT_MESSAGES: Record<string, string> = {
  txSuccess: "Transaction succeeded.",
  txFailed: "Transaction failed.",
  txTooEarly: "Transaction submitted before its valid time window.",
  txTooLate: "Transaction expired before submission.",
  txMissingOperation: "Transaction has no operations.",
  txBadSeq: "Wrong account sequence number — try refreshing and resubmitting.",
  txBadAuth: "Bad signature on the transaction.",
  txInsufficientBalance: "Source account doesn't have enough XLM to pay the fee.",
  txNoAccount: "Source account doesn't exist on-chain.",
  txInsufficientFee: "Fee is below the network minimum.",
  txBadAuthExtra: "Extra signatures attached to the transaction.",
  txInternalError: "Stellar core hit an internal error.",
  txNotSupported: "Transaction type not supported by this network.",
  txFeeBumpInnerFailed: "The inner fee-bump transaction failed.",
  txBadSponsorship: "Sponsorship structure is invalid.",
  txBadMinSeqAgeOrGap: "Minimum sequence age/gap precondition not met.",
  txMalformed: "Transaction is malformed — likely a build/sign mismatch.",
  txSorobanInvalid: "Soroban transaction failed validation.",
};

export function txResultCodeToMessage(code: string | undefined): string | null {
  if (!code) return null;
  return TX_RESULT_MESSAGES[code] ?? null;
}

/**
 * Carries the parsed reason for a failed submission up to the toast layer.
 * `kind` lets the UI decide whether to show a generic "Transaction failed"
 * title or a contract-specific one.
 */
export interface SubmitErrorDetails {
  message: string;
  kind: "tx-level" | "host-function" | "contract" | "timeout";
  /** Contract name (e.g. "Vault") when `kind === "contract"`. */
  contract?: string;
  /** Stellar/contract error code identifier (e.g. "txMalformed", "InsufficientFreeLiquidity"). */
  code?: string;
}

/**
 * Walk a FAILED `getTransaction` response's diagnostic events looking for the
 * Soroban-emitted `error` event whose body holds the `Error(Contract, #N)`
 * value. Returns null if the response doesn't carry one (e.g. the failure
 * was at the host-function envelope rather than inside the contract).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractContractErrorFromTxMeta(got: any): ParsedContractError | null {
  try {
    const meta = got.resultMetaXdr ?? got.envelopeXdr; // SDK shapes vary
    const events: xdr.DiagnosticEvent[] = got.diagnosticEventsXdr ?? [];
    if (!events?.length && !meta) return null;

    for (const ev of events) {
      const parsed = parseDiagnosticEventForError(ev);
      if (parsed) return parsed;
    }
  } catch {
    // fall through
  }
  return null;
}

function parseDiagnosticEventForError(ev: xdr.DiagnosticEvent): ParsedContractError | null {
  try {
    const inner = ev.event();
    const body = inner.body().v0();
    const data = body.data();
    // The contract error is encoded as ScVal::Error(ScError::Contract(#N)).
    if (data.switch().name !== "scvError") return null;
    const err = data.error();
    if (err.switch().name !== "sceContract") return null;
    const codeNum = Number(err.contractCode());
    if (!Number.isFinite(codeNum)) return null;

    // Resolve the emitting contract via the event's contractId so we don't
    // hit the wrong table when discriminants overlap (e.g. Vault #8 vs
    // PositionManager #8). Falls back to a linear scan if we can't.
    const contractId = contractIdFromEvent(inner);
    if (contractId) {
      const table = getContractMap()[contractId];
      const variant = table?.by[codeNum];
      if (table && variant) {
        return { message: variant.message, name: variant.name, contract: table.contract, code: codeNum };
      }
    }
    for (const table of tables) {
      const variant = table.by[codeNum];
      if (variant) {
        return { message: variant.message, name: variant.name, contract: table.contract, code: codeNum };
      }
    }
    return { message: `Contract error #${codeNum}`, code: codeNum };
  } catch {
    return null;
  }
}

function contractIdFromEvent(event: xdr.ContractEvent): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = (event as any).contractId?.();
    if (!hash) return null;
    // Hash is an Opaque[32] in the XDR types; the underlying value is a
    // Uint8Array we can hand straight to StrKey.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bytes = hash as unknown as Uint8Array;
    if (!bytes || (bytes as { length?: number }).length !== 32) return null;
    return StrKey.encodeContract(Buffer.from(bytes));
  } catch {
    return null;
  }
}

/**
 * Convert any thrown value into a clean string for toasts. Tries, in order:
 *   1. structured contract-error parsing (Error(Contract, #N))
 *   2. stringified Stellar tx-result code ("name":"txMalformed", …)
 *   3. raw Error.message
 *   4. JSON fallback
 */
export function toErrorMessage(input: unknown): string {
  const parsed = parseContractError(input);
  if (parsed) return parsed.message;

  const text = stringifyError(input);
  const txMatch = TX_CODE_RE.exec(text);
  const friendly = txMatch ? txResultCodeToMessage(txMatch[1]) : null;
  if (friendly) return friendly;

  if (input instanceof Error) return input.message;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return "Something went wrong.";
  }
}

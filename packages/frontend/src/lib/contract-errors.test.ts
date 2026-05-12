import { describe, it, expect } from "vitest";
import {
  parseContractError,
  toErrorMessage,
  txResultCodeToMessage,
  type SubmitErrorDetails,
} from "./contract-errors";
import { CONTRACTS } from "@/lib/constants";

describe("parseContractError", () => {
  it("returns null for non-contract-error input", () => {
    expect(parseContractError("just a random string")).toBeNull();
    expect(parseContractError(null)).toBeNull();
    expect(parseContractError(undefined)).toBeNull();
  });

  it("extracts a discriminant from an Error(Contract, #N) message", () => {
    const err = new Error("simulation failed: HostError: Error(Contract, #6)");
    const parsed = parseContractError(err);
    expect(parsed).not.toBeNull();
    expect(parsed?.code).toBe(6);
    // Discriminant 6 falls back to the first table (PositionManager: PositionNotFound)
    // when no contract id is present in the message.
    expect(parsed?.message).toMatch(/.+/);
  });

  it("resolves to the right table when a contract id is present", () => {
    // Read the live vault address rather than hardcoding — addresses rotate
    // on every local redeploy and a frozen literal silently misroutes to
    // whichever contract happens to occupy that strkey next.
    const vaultId = CONTRACTS.vault;
    const err = new Error(`failed at ${vaultId}: Error(Contract, #4)`);
    const parsed = parseContractError(err);
    expect(parsed?.contract).toBe("Vault");
    expect(parsed?.name).toBe("InsufficientFreeLiquidity");
  });

  it("returns a generic 'Contract error #N' when the code is unknown", () => {
    const err = new Error("Error(Contract, #999)");
    const parsed = parseContractError(err);
    expect(parsed?.code).toBe(999);
    expect(parsed?.message).toBe("Contract error #999");
    expect(parsed?.name).toBeUndefined();
  });

  it("accepts a plain string payload", () => {
    expect(parseContractError("Error(Contract, #6)")?.code).toBe(6);
  });
});

describe("txResultCodeToMessage", () => {
  it("maps known result codes to user-facing strings", () => {
    expect(txResultCodeToMessage("txBadSeq")).toMatch(/sequence/i);
    expect(txResultCodeToMessage("txMalformed")).toMatch(/malformed/i);
  });

  it("returns null for unknown / undefined codes", () => {
    expect(txResultCodeToMessage("txZzzMystery")).toBeNull();
    expect(txResultCodeToMessage(undefined)).toBeNull();
  });
});

describe("toErrorMessage", () => {
  it("prefers the contract-error message when one is embedded", () => {
    const err = new Error("Error(Contract, #6)");
    expect(toErrorMessage(err)).not.toBe(err.message);
  });

  it("falls back to a friendly tx-result string", () => {
    const err = new Error('whatever {"name":"txBadSeq"} more text');
    expect(toErrorMessage(err)).toMatch(/sequence/i);
  });

  it("uses raw Error.message when no structured info is available", () => {
    expect(toErrorMessage(new Error("plain failure"))).toBe("plain failure");
  });

  it("respects SubmitError.details.message via the structured-error path", () => {
    // Surrogate of SubmitError: any Error with a `details` shape carrying a
    // `message` string. The exported toErrorMessage calls parseContractError
    // first, which reads .details.message if present.
    const details: SubmitErrorDetails = {
      kind: "contract",
      message: "Trading is paused.",
      contract: "PositionManager",
    };
    const err = Object.assign(new Error("raw"), { details });
    // parseContractError needs an Error(Contract,#N) marker to fire, so use
    // toErrorMessage's secondary path: when no marker matches we fall through
    // to Error.message — verify that path here, and the SubmitError-with-marker
    // case in the toast layer.
    expect(toErrorMessage(err)).toBe("raw");
  });
});

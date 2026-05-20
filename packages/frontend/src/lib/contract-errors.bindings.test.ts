// Drift guard: every hand-typed variant name in contract-errors.ts must match
// the auto-generated `*Error` map from @stellars/bindings. The bindings ARE
// the canonical mapping (stellar contract bindings typescript reads the same
// `#[contracterror]` enum the contract uses), so this test fails fast when a
// rename or renumber happens upstream and contract-errors.ts wasn't refreshed.

import { describe, it, expect } from "vitest";
import { PositionManagerError } from "@stellars/bindings/position-manager";
import { VaultError } from "@stellars/bindings/vault";
import { OracleRouterError } from "@stellars/bindings/oracle-router";
import { ConfigManagerError } from "@stellars/bindings/config-manager";
import { OracleError } from "@stellars/bindings/oracle";

import { parseContractError } from "./contract-errors";
import { CONTRACTS } from "./constants";

type BindingErrorMap = Record<number, { message: string }>;

/**
 * Drift check is subset-shaped, not equality-shaped: bindings can declare
 * more variants than contract-errors.ts cares to user-message (e.g.
 * admin-only `UpgradeTimelockTooShort` doesn't need a trader-facing copy).
 * For every variant contract-errors.ts *does* declare for this contract,
 * its `name` must match the binding's name at the same discriminant. If it
 * doesn't, the contract has been renamed/renumbered without refreshing the
 * frontend's user-copy table.
 */
function assertNamesMatch(contractId: string, label: string, bindings: BindingErrorMap) {
  if (!contractId) return;

  for (const [codeStr, variant] of Object.entries(bindings)) {
    const code = Number(codeStr);
    const input = `Error(Contract, #${code}) at ${contractId}`;
    const parsed = parseContractError(input);
    if (!parsed) continue;
    // `name` is undefined when no table covered this code — that means the
    // frontend doesn't declare a user message for it, which is allowed.
    if (parsed.name === undefined) continue;
    // When the frontend resolved to a different contract's table via the
    // linear-scan fallback, skip — the name there refers to a different
    // contract's variant and is not a parity claim about *this* contract.
    if (parsed.contract && parsed.contract !== label) continue;
    expect(
      parsed.name,
      `${label}#${code}: contract-errors.ts says "${parsed.name}", bindings say "${variant.message}"`,
    ).toBe(variant.message);
  }
}

describe("contract-errors.ts ↔ @stellars/bindings name parity", () => {
  it("PositionManager variant names match bindings", () => {
    assertNamesMatch(CONTRACTS.positionManager, "PositionManager", PositionManagerError as BindingErrorMap);
  });
  it("Vault variant names match bindings", () => {
    assertNamesMatch(CONTRACTS.vault, "Vault", VaultError as BindingErrorMap);
  });
  it("OracleRouter variant names match bindings", () => {
    assertNamesMatch(CONTRACTS.oracleRouter, "OracleRouter", OracleRouterError as BindingErrorMap);
  });
  it("ConfigManager variant names match bindings", () => {
    assertNamesMatch(CONTRACTS.configManager, "ConfigManager", ConfigManagerError as BindingErrorMap);
  });
  it("Oracle variant names match bindings", () => {
    assertNamesMatch(CONTRACTS.oracle, "Oracle", OracleError as BindingErrorMap);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The toast helpers route transaction-lifecycle and validation errors into
 * sonner's API. We mock `sonner` so we can assert the (title, description)
 * pair the user-facing toast would render — that's where the contract-error
 * parsing pays off, and where regressions tend to bite.
 */

const sonner = {
  loading: vi.fn().mockReturnValue("tx-id"),
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock("sonner", () => ({ toast: sonner }));

const { txToast, toastError, toastSuccess } = await import("./toast");
const { SubmitError } = await import("@/contracts/sender");
import type { SubmitErrorDetails } from "@/lib/contract-errors";

beforeEach(() => {
  for (const fn of Object.values(sonner)) fn.mockReset();
  sonner.loading.mockReturnValue("tx-id");
});

describe("txToast lifecycle", () => {
  it("emits a loading toast with the action verb and a default body", () => {
    txToast({ action: "Open long" });
    expect(sonner.loading).toHaveBeenCalledWith(
      "Open long · awaiting confirmation",
      expect.objectContaining({ description: expect.stringMatching(/Sign the transaction/) }),
    );
  });

  it("uses the optional pending body when supplied", () => {
    txToast({ action: "Withdraw", pending: "Confirm withdrawal in wallet." });
    expect(sonner.loading).toHaveBeenCalledWith(
      "Withdraw · awaiting confirmation",
      expect.objectContaining({ description: "Confirm withdrawal in wallet." }),
    );
  });

  it("upgrades the same toast id to success on success()", () => {
    const t = txToast({ action: "Open long" });
    t.success("Position opened.");
    expect(sonner.success).toHaveBeenCalledWith(
      "Open long confirmed",
      expect.objectContaining({ id: "tx-id", description: "Position opened." }),
    );
  });

  it("falls back to the successDetail when success() is called with no arg", () => {
    const t = txToast({ action: "Withdraw", successDetail: "USDC credited." });
    t.success();
    expect(sonner.success).toHaveBeenCalledWith(
      "Withdraw confirmed",
      expect.objectContaining({ description: "USDC credited." }),
    );
  });

  it("falls back to a generic confirmation when nothing is supplied", () => {
    const t = txToast({ action: "Withdraw" });
    t.success();
    expect(sonner.success).toHaveBeenCalledWith(
      "Withdraw confirmed",
      expect.objectContaining({ description: "Transaction landed on Stellar." }),
    );
  });
});

describe("txToast.error — SubmitError titles", () => {
  function submit(details: SubmitErrorDetails) {
    return new SubmitError(details);
  }

  it("uses 'reverted · <Contract>' for contract-kind failures", () => {
    const t = txToast({ action: "Open long" });
    t.error(
      submit({ kind: "contract", message: "Trading is paused.", contract: "PositionManager" }),
    );
    expect(sonner.error).toHaveBeenCalledWith(
      "Open long reverted · PositionManager",
      expect.objectContaining({ description: "Trading is paused.", id: "tx-id" }),
    );
  });

  it("falls back to 'Contract' when SubmitError omits the contract name", () => {
    const t = txToast({ action: "Open long" });
    t.error(submit({ kind: "contract", message: "Generic." }));
    expect(sonner.error).toHaveBeenCalledWith(
      "Open long reverted · Contract",
      expect.any(Object),
    );
  });

  it("titles host-function failures distinctly", () => {
    const t = txToast({ action: "Open long" });
    t.error(submit({ kind: "host-function", message: "host crashed" }));
    expect(sonner.error).toHaveBeenCalledWith(
      "Open long failed · host",
      expect.objectContaining({ description: "host crashed" }),
    );
  });

  it("renders tx-level rejections with the code in the title when present", () => {
    const t = txToast({ action: "Open long" });
    t.error(submit({ kind: "tx-level", message: "Bad seq", code: "txBadSeq" }));
    expect(sonner.error).toHaveBeenCalledWith(
      "Open long rejected · txBadSeq",
      expect.objectContaining({ description: "Bad seq" }),
    );
  });

  it("renders tx-level rejections without a code as just 'rejected'", () => {
    const t = txToast({ action: "Open long" });
    t.error(submit({ kind: "tx-level", message: "Bad seq" }));
    expect(sonner.error).toHaveBeenCalledWith(
      "Open long rejected",
      expect.any(Object),
    );
  });

  it("titles timeouts with 'timed out'", () => {
    const t = txToast({ action: "Open long" });
    t.error(submit({ kind: "timeout", message: "no land within window" }));
    expect(sonner.error).toHaveBeenCalledWith(
      "Open long timed out",
      expect.objectContaining({ description: "no land within window" }),
    );
  });
});

describe("txToast.error — non-SubmitError paths", () => {
  it("parses an embedded contract error from a plain Error and routes to reverted", () => {
    const t = txToast({ action: "Withdraw" });
    // No contract id in the text, so the parser can't pin the source contract
    // (discriminants overlap across tables). The toast still says "reverted"
    // generically — useful signal — but won't claim a specific contract name.
    t.error(new Error("simulation failed: Error(Contract, #4)"));
    expect(sonner.error).toHaveBeenCalled();
    const [title, opts] = sonner.error.mock.calls[0];
    expect(title).toMatch(/reverted/i);
    expect(opts.description).toBeDefined();
  });

  it("falls back to a generic title when no structured info is available", () => {
    const t = txToast({ action: "Withdraw" });
    t.error(new Error("just a plain string"));
    expect(sonner.error).toHaveBeenCalledWith(
      "Withdraw failed",
      expect.objectContaining({ description: "just a plain string" }),
    );
  });
});

describe("non-tx helpers", () => {
  it("toastSuccess passes title + description through to sonner.success", () => {
    toastSuccess("Copied", "Address copied to clipboard");
    expect(sonner.success).toHaveBeenCalledWith("Copied", {
      description: "Address copied to clipboard",
    });
  });

  it("toastError uses the default title when one isn't supplied", () => {
    toastError(new Error("invalid amount"));
    expect(sonner.error).toHaveBeenCalledWith("Something went wrong", {
      description: "invalid amount",
    });
  });

  it("toastError respects a custom title", () => {
    toastError("size must be > 0", "Invalid order");
    expect(sonner.error).toHaveBeenCalledWith("Invalid order", {
      description: "size must be > 0",
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The wrapper in `freighter.ts` is a status-mapping layer over
 * `@stellar/freighter-api`. We mock the entire `@stellar/freighter-api`
 * module so we can drive the wrapper through every status branch
 * (missing extension, locked, ok) and every error case (sign rejected,
 * empty auth entry) without a real wallet.
 */

const fa = {
  isConnected: vi.fn(),
  isAllowed: vi.fn(),
  setAllowed: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
  signAuthEntry: vi.fn(),
};

vi.mock("@stellar/freighter-api", () => fa);

const {
  getFreighterStatus,
  requestFreighterPermission,
  signTx,
  signAuth,
} = await import("./freighter");

beforeEach(() => {
  for (const fn of Object.values(fa)) fn.mockReset();
});

describe("getFreighterStatus", () => {
  it("returns kind: missing when the extension isn't installed", async () => {
    fa.isConnected.mockResolvedValue({ isConnected: false });
    await expect(getFreighterStatus()).resolves.toEqual({ kind: "missing" });
  });

  it("returns kind: locked when the user hasn't granted permission", async () => {
    fa.isConnected.mockResolvedValue({ isConnected: true });
    fa.isAllowed.mockResolvedValue({ isAllowed: false });
    await expect(getFreighterStatus()).resolves.toEqual({ kind: "locked" });
  });

  it("returns kind: locked when either getAddress or getNetwork errors out", async () => {
    fa.isConnected.mockResolvedValue({ isConnected: true });
    fa.isAllowed.mockResolvedValue({ isAllowed: true });
    fa.getAddress.mockResolvedValue({ error: { message: "no acct" } });
    fa.getNetwork.mockResolvedValue({ network: "TESTNET", networkPassphrase: "p" });
    await expect(getFreighterStatus()).resolves.toEqual({ kind: "locked" });

    fa.getAddress.mockResolvedValue({ address: "GABC" });
    fa.getNetwork.mockResolvedValue({ error: { message: "no net" } });
    await expect(getFreighterStatus()).resolves.toEqual({ kind: "locked" });
  });

  it("returns kind: ok with address + network when everything works", async () => {
    fa.isConnected.mockResolvedValue({ isConnected: true });
    fa.isAllowed.mockResolvedValue({ isAllowed: true });
    fa.getAddress.mockResolvedValue({ address: "GTRADER" });
    fa.getNetwork.mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    await expect(getFreighterStatus()).resolves.toEqual({
      kind: "ok",
      address: "GTRADER",
      network: "TESTNET",
      passphrase: "Test SDF Network ; September 2015",
    });
  });
});

describe("requestFreighterPermission", () => {
  it("resolves silently when the user accepts", async () => {
    fa.setAllowed.mockResolvedValue({ isAllowed: true });
    await expect(requestFreighterPermission()).resolves.toBeUndefined();
  });

  it("throws when the user denies", async () => {
    fa.setAllowed.mockResolvedValue({ isAllowed: false });
    await expect(requestFreighterPermission()).rejects.toThrow(/permission denied/);
  });
});

describe("signTx", () => {
  it("returns the signed XDR on success", async () => {
    fa.signTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    await expect(signTx("unsigned", "pass")).resolves.toBe("signed-xdr");
    expect(fa.signTransaction).toHaveBeenCalledWith("unsigned", { networkPassphrase: "pass" });
  });

  it("throws using the wallet's error.message when present", async () => {
    fa.signTransaction.mockResolvedValue({ error: { message: "user rejected" } });
    await expect(signTx("x", "p")).rejects.toThrow(/user rejected/);
  });

  it("falls back to a generic message when the error has none", async () => {
    fa.signTransaction.mockResolvedValue({ error: {} });
    await expect(signTx("x", "p")).rejects.toThrow(/sign failed/);
  });
});

describe("signAuth", () => {
  it("base64-encodes the signed auth entry on success", async () => {
    // The wallet hands us bytes; we base64-encode for the SDK's submitter.
    const bytes = new Uint8Array([1, 2, 3]);
    fa.signAuthEntry.mockResolvedValue({ signedAuthEntry: bytes });
    const out = await signAuth("entry", "passphrase", "GTRADER");
    expect(out).toBe(Buffer.from(bytes).toString("base64"));
    expect(fa.signAuthEntry).toHaveBeenCalledWith("entry", {
      networkPassphrase: "passphrase",
      address: "GTRADER",
    });
  });

  it("throws when Freighter returns an error", async () => {
    fa.signAuthEntry.mockResolvedValue({ error: { message: "auth rejected" } });
    await expect(signAuth("e", "p", "G")).rejects.toThrow(/auth rejected/);
  });

  it("falls back to a generic message when the error has none", async () => {
    fa.signAuthEntry.mockResolvedValue({ error: {} });
    await expect(signAuth("e", "p", "G")).rejects.toThrow(/sign auth failed/);
  });

  it("throws when the wallet returns an empty signed entry", async () => {
    fa.signAuthEntry.mockResolvedValue({ signedAuthEntry: null });
    await expect(signAuth("e", "p", "G")).rejects.toThrow(/empty signed auth entry/);
  });
});

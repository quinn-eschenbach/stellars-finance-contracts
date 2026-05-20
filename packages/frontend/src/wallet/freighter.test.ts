import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wrapper in `freighter.ts` is now a thin adapter over Stellar
 * Wallets Kit's static API. We mock the kit module so we can drive every
 * branch (no stored wallet → missing, stored + valid → ok, sign happy/
 * error paths) without spinning up a real wallet extension.
 */

const kitMock = {
  init: vi.fn(),
  setWallet: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  authModal: vi.fn(),
  signTransaction: vi.fn(),
  signAuthEntry: vi.fn(),
  disconnect: vi.fn(),
  // selectedModule is read by getFreighterStatus (live polling path) and
  // after authModal (to learn which wallet won). Back it with a setter so
  // tests can mutate between assertions without re-mocking the module.
  selectedModule: undefined as
    | { productId: string; getAddress?: ReturnType<typeof vi.fn> }
    | undefined,
};

vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: kitMock,
}));

// Module factories — the wrapper instantiates one of each at init time.
// We don't care about their behavior in unit tests, just that the import
// doesn't trip the kit's runtime checks.
vi.mock("@creit.tech/stellar-wallets-kit/types", () => ({
  Networks: {
    PUBLIC: "Public Global Stellar Network ; September 2015",
    TESTNET: "Test SDF Network ; September 2015",
    FUTURENET: "Test SDF Future Network ; October 2022",
    SANDBOX: "Local Sandbox Stellar Network ; September 2022",
    STANDALONE: "Standalone Network ; February 2017",
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/albedo", () => ({ AlbedoModule: class {} }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({ FreighterModule: class {} }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/hana", () => ({ HanaModule: class {} }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/lobstr", () => ({ LobstrModule: class {} }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/rabet", () => ({ RabetModule: class {} }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/xbull", () => ({ xBullModule: class {} }));

const STORED_WALLET_KEY = "stellars.wallet.selectedId";

beforeEach(() => {
  for (const fn of Object.values(kitMock)) {
    if (typeof fn === "function") (fn as { mockReset?: () => void }).mockReset?.();
  }
  kitMock.selectedModule = undefined;
  window.localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function load() {
  return import("./freighter");
}

describe("getFreighterStatus", () => {
  it("is 'missing' when no wallet has been stored", async () => {
    const { getFreighterStatus } = await load();
    await expect(getFreighterStatus()).resolves.toEqual({ kind: "missing" });
  });

  it("is 'ok' with address + network when the stored wallet resolves", async () => {
    window.localStorage.setItem(STORED_WALLET_KEY, "freighter");
    const moduleGetAddress = vi.fn().mockResolvedValue({ address: "GTRADER" });
    kitMock.selectedModule = { productId: "freighter", getAddress: moduleGetAddress };
    kitMock.getNetwork.mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    const { getFreighterStatus } = await load();
    await expect(getFreighterStatus()).resolves.toEqual({
      kind: "ok",
      address: "GTRADER",
      network: "TESTNET",
      passphrase: "Test SDF Network ; September 2015",
    });
    expect(kitMock.setWallet).toHaveBeenCalledWith("freighter");
    // Polling must skip the permission prompt so Freighter doesn't reopen
    // its popup every interval tick.
    expect(moduleGetAddress).toHaveBeenCalledWith({ skipRequestAccess: true });
  });

  it("falls back to 'missing' when the kit cannot resolve the stored wallet", async () => {
    window.localStorage.setItem(STORED_WALLET_KEY, "ghost-wallet");
    kitMock.selectedModule = {
      productId: "ghost-wallet",
      getAddress: vi.fn().mockRejectedValue(new Error("module not initialised")),
    };
    const { getFreighterStatus } = await load();
    await expect(getFreighterStatus()).resolves.toEqual({ kind: "missing" });
  });

  it("falls back to 'missing' when setWallet leaves no selected module", async () => {
    window.localStorage.setItem(STORED_WALLET_KEY, "freighter");
    kitMock.selectedModule = undefined;
    const { getFreighterStatus } = await load();
    await expect(getFreighterStatus()).resolves.toEqual({ kind: "missing" });
  });
});

describe("requestFreighterPermission", () => {
  it("stores the picked wallet id after a successful connect", async () => {
    kitMock.authModal.mockResolvedValue({ address: "GTRADER" });
    kitMock.selectedModule = { productId: "lobstr" };
    const { requestFreighterPermission } = await load();
    await expect(requestFreighterPermission()).resolves.toBeUndefined();
    expect(window.localStorage.getItem(STORED_WALLET_KEY)).toBe("lobstr");
  });

  it("throws when the modal closes without an address", async () => {
    kitMock.authModal.mockResolvedValue({ address: "" });
    const { requestFreighterPermission } = await load();
    await expect(requestFreighterPermission()).rejects.toThrow(/cancelled/);
    expect(window.localStorage.getItem(STORED_WALLET_KEY)).toBeNull();
  });
});

describe("signTx", () => {
  it("forwards the XDR + passphrase and returns the signed payload", async () => {
    kitMock.signTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    const { signTx } = await load();
    await expect(signTx("unsigned", "pass")).resolves.toBe("signed-xdr");
    expect(kitMock.signTransaction).toHaveBeenCalledWith("unsigned", { networkPassphrase: "pass" });
  });
});

describe("signAuth", () => {
  it("passes the signed entry through when the kit returns a base64 string", async () => {
    kitMock.signAuthEntry.mockResolvedValue({ signedAuthEntry: "already-base64" });
    const { signAuth } = await load();
    await expect(signAuth("entry", "pass", "GTRADER")).resolves.toBe("already-base64");
  });

  it("base64-encodes byte payloads so the submitter does not have to branch", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    kitMock.signAuthEntry.mockResolvedValue({ signedAuthEntry: bytes });
    const { signAuth } = await load();
    const out = await signAuth("entry", "pass", "GTRADER");
    expect(out).toBe(Buffer.from(bytes).toString("base64"));
    expect(kitMock.signAuthEntry).toHaveBeenCalledWith("entry", {
      networkPassphrase: "pass",
      address: "GTRADER",
    });
  });
});

describe("disconnect", () => {
  it("clears the stored wallet id and calls the kit", async () => {
    window.localStorage.setItem(STORED_WALLET_KEY, "freighter");
    kitMock.disconnect.mockResolvedValue(undefined);
    const { disconnect } = await load();
    await disconnect();
    expect(window.localStorage.getItem(STORED_WALLET_KEY)).toBeNull();
    expect(kitMock.disconnect).toHaveBeenCalled();
  });
});

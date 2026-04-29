import { Client as MockTokenClient } from "@stellars/bindings/mock-token";
import { Client as VaultClient } from "@stellars/bindings/vault";
import { Client as PositionManagerClient } from "@stellars/bindings/position-manager";
import { CONTRACTS, MOCK_TOKEN_CONTRACT, NETWORK_PASSPHRASE, RPC_URL } from "@/lib/constants";

const baseOpts = {
  networkPassphrase: NETWORK_PASSPHRASE,
  rpcUrl: RPC_URL,
  allowHttp: RPC_URL.startsWith("http://"),
};

/**
 * Build a binding client scoped to a particular signer's public key. The
 * `publicKey` controls who appears as the source account in simulated /
 * unsigned transactions; the wallet supplies the signature later.
 */
export function mockToken(publicKey: string): MockTokenClient {
  return new MockTokenClient({ ...baseOpts, contractId: MOCK_TOKEN_CONTRACT, publicKey });
}

export function vault(publicKey: string): VaultClient {
  return new VaultClient({ ...baseOpts, contractId: CONTRACTS.vault, publicKey });
}

export function positionManager(publicKey: string): PositionManagerClient {
  return new PositionManagerClient({ ...baseOpts, contractId: CONTRACTS.positionManager, publicKey });
}

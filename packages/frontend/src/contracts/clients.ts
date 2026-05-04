import { Client as MockTokenClient } from "@stellars/bindings/mock-token";
import { Client as VaultClient } from "@stellars/bindings/vault";
import { Client as PositionManagerClient } from "@stellars/bindings/position-manager";
import { client, readOnlySigner } from "@stellars/protocol-clients";
import { CONTRACTS, MOCK_TOKEN_CONTRACT, NETWORK_PASSPHRASE, RPC_URL } from "@/lib/constants";

const env = { rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE };

/**
 * Build a binding client scoped to a particular signer's public key. The
 * `publicKey` controls who appears as the source account in simulated /
 * unsigned transactions; the wallet supplies the signature later.
 */
export function mockToken(publicKey: string): MockTokenClient {
  return client(MockTokenClient, env, MOCK_TOKEN_CONTRACT, readOnlySigner(publicKey));
}

export function vault(publicKey: string): VaultClient {
  return client(VaultClient, env, CONTRACTS.vault, readOnlySigner(publicKey));
}

export function positionManager(publicKey: string): PositionManagerClient {
  return client(PositionManagerClient, env, CONTRACTS.positionManager, readOnlySigner(publicKey));
}

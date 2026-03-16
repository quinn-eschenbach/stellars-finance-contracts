import addresses from "./addresses.json";

export type Network = "testnet" | "mainnet";

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contracts: {
    vault: string;
    positionManager: string;
    configManager: string;
    oracleRouter: string;
    oracle: string;
  };
}

export type Addresses = Record<Network, NetworkConfig>;

export const config: Addresses = addresses;

export function getNetworkConfig(network: Network): NetworkConfig {
  return config[network];
}

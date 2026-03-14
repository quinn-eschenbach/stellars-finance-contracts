export interface ContractIds {
  vault: string;
  positionManager: string;
  configManager: string;
  oracleRouter: string;
}

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractIds: ContractIds;
}

export const Networks: Record<string, NetworkConfig> = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractIds: {
      vault: '',
      positionManager: '',
      configManager: '',
      oracleRouter: '',
    },
  },
  mainnet: {
    rpcUrl: 'https://soroban.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    contractIds: {
      vault: '',
      positionManager: '',
      configManager: '',
      oracleRouter: '',
    },
  },
};

export function getContractIds(network: string): ContractIds {
  const config = Networks[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}. Available: ${Object.keys(Networks).join(', ')}`);
  }
  return config.contractIds;
}

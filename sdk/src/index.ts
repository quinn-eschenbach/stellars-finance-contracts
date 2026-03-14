// Aliased client classes
export { Client as VaultClient } from '@stellars-finance/vault';
export { Client as PositionManagerClient } from '@stellars-finance/position-manager';
export { Client as ConfigManagerClient } from '@stellars-finance/config-manager';
export { Client as OracleRouterClient } from '@stellars-finance/oracle-router';

// Namespaced type exports (avoids collisions)
export * as vault from '@stellars-finance/vault';
export * as positionManager from '@stellars-finance/position-manager';
export * as configManager from '@stellars-finance/config-manager';
export * as oracleRouter from '@stellars-finance/oracle-router';

// Network helpers
export { Networks, getContractIds, type ContractIds, type NetworkConfig } from './networks';

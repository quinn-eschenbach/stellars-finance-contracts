import type { Db } from "@stellars/db";
import type { ContractInfo } from "@stellars/config";
import type { ParsedEvent } from "../spec-parser.js";
import { handlePositionManagerEvent } from "./position-manager.js";
import { handleVaultEvent } from "./vault.js";
import { handleConfigManagerEvent } from "./config-manager.js";
import { handleOracleRouterEvent } from "./oracle-router.js";

export interface ContractRoutes {
  [contractId: string]: (db: Db, event: ParsedEvent) => Promise<void>;
}

export function buildRoutes(contracts: {
  vault: ContractInfo;
  positionManager: ContractInfo;
  configManager: ContractInfo;
  oracleRouter: ContractInfo;
}): ContractRoutes {
  const routes: ContractRoutes = {};
  if (contracts.positionManager.address) routes[contracts.positionManager.address] = handlePositionManagerEvent;
  if (contracts.vault.address) routes[contracts.vault.address] = handleVaultEvent;
  if (contracts.configManager.address) routes[contracts.configManager.address] = handleConfigManagerEvent;
  if (contracts.oracleRouter.address) routes[contracts.oracleRouter.address] = handleOracleRouterEvent;
  return routes;
}

import type { Db } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { handlePositionManagerEvent } from "./position-manager.js";
import { handleVaultEvent } from "./vault.js";
import { handleConfigManagerEvent } from "./config-manager.js";
import { handleOracleRouterEvent } from "./oracle-router.js";

export interface ContractRoutes {
  [contractId: string]: (db: Db, event: ParsedEvent) => Promise<void>;
}

export function buildRoutes(contracts: {
  vault: string;
  positionManager: string;
  configManager: string;
  oracleRouter: string;
}): ContractRoutes {
  const routes: ContractRoutes = {};
  if (contracts.positionManager) routes[contracts.positionManager] = handlePositionManagerEvent;
  if (contracts.vault) routes[contracts.vault] = handleVaultEvent;
  if (contracts.configManager) routes[contracts.configManager] = handleConfigManagerEvent;
  if (contracts.oracleRouter) routes[contracts.oracleRouter] = handleOracleRouterEvent;
  return routes;
}

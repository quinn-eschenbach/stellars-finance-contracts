import { readdir } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { Fixture } from "./src/fixture.js";
import { clearKeypairState } from "./src/signer.js";

const SCENARIOS_DIR = resolve(import.meta.dirname, "scenarios");

async function listScenarios(): Promise<string[]> {
  const files = await readdir(SCENARIOS_DIR);
  return files
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

async function runScenario(name: string, fixture: Fixture): Promise<boolean> {
  const file = resolve(SCENARIOS_DIR, `${name}.ts`);
  const start = performance.now();

  try {
    const mod = await import(file);
    const fn = mod.default as (f: Fixture) => Promise<void>;
    if (typeof fn !== "function") {
      throw new Error(`Scenario "${name}" does not export a default function`);
    }
    await fn(fixture);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    console.log(`\x1b[32m[PASS]\x1b[0m ${name} (${elapsed}s)\n`);
    return true;
  } catch (err) {
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    console.error(`\x1b[31m[FAIL]\x1b[0m ${name} (${elapsed}s)`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}\n`);
    return false;
  }
}

async function main() {
  // Strip `--` separators that pnpm forwards through `pnpm <script> -- <args>`.
  const args = process.argv.slice(2).filter((a) => a !== "--");

  // --cleanup mode
  if (args.includes("--cleanup")) {
    await clearKeypairState();
    process.exit(0);
  }

  // Parse which scenarios to run
  let scenarioNames: string[];
  const scenarioIdx = args.indexOf("--scenario");
  if (scenarioIdx !== -1 && args[scenarioIdx + 1]) {
    scenarioNames = [args[scenarioIdx + 1]];
  } else {
    scenarioNames = await listScenarios();
  }

  if (scenarioNames.length === 0) {
    console.log("No scenarios found in scenarios/");
    process.exit(0);
  }

  console.log("=========================================");
  console.log("  Stellars Finance — Local Simulation");
  console.log("=========================================\n");

  const fixture = Fixture.load();
  console.log("");

  let passed = 0;
  let failed = 0;

  for (const name of scenarioNames) {
    console.log(`[simulation] Running: ${name}`);
    const ok = await runScenario(name, fixture);
    if (ok) passed++;
    else failed++;
  }

  console.log("=========================================");
  console.log(`  ${passed} passed, ${failed} failed (${scenarioNames.length} total)`);
  console.log("=========================================");

  process.exit(failed > 0 ? 1 : 0);
}

main();

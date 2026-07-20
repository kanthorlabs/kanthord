// Composition root — the ONLY file that imports concrete adapters and wires
// them to use cases and the CLI.
import { buildProgram } from "./apps/cli/index.ts";
import { buildDeps } from "./composition.ts";

const dbPath = process.env.KANTHORD_DB ?? ".data/kanthord.db";

const rawMaxTurns = process.env.KANTHORD_MAX_TURNS;
let maxTurns: number | undefined;
if (rawMaxTurns !== undefined) {
  const parsed = Number(rawMaxTurns);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    process.stderr.write(
      `KANTHORD_MAX_TURNS must be a positive integer, got: ${rawMaxTurns}\n`,
    );
    process.exit(1);
  }
  maxTurns = parsed;
}

const deps = buildDeps(dbPath, { maxTurns });

const program = buildProgram(deps);
await program.parseAsync(process.argv);

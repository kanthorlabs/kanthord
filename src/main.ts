// Composition root — the ONLY file that imports concrete adapters and wires
// them to use cases and the CLI.
import { dispatch } from "./apps/cli/router.ts";
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

const result = await dispatch(process.argv.slice(2), deps);
for (const line of result.stdout) {
  process.stdout.write(line + "\n");
}
for (const line of result.stderr) {
  process.stderr.write(line + "\n");
}
process.exitCode = result.exitCode;

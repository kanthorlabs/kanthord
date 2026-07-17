// Composition root — the ONLY file that imports concrete adapters and wires
// them to use cases and the CLI.
import { dispatch } from "./apps/cli/router.ts";
import { buildDeps } from "./composition.ts";

const dbPath = process.env.KANTHORD_DB ?? ".data/kanthord.db";
const deps = buildDeps(dbPath);

const result = await dispatch(process.argv.slice(2), deps);
for (const line of result.stdout) {
  process.stdout.write(line + "\n");
}
for (const line of result.stderr) {
  process.stderr.write(line + "\n");
}
process.exitCode = result.exitCode;

// Composition root — the ONLY file that imports concrete adapters and wires
// them to use cases and the CLI.
import { buildProgram } from "./apps/cli/index.ts";
import { buildDeps } from "./composition.ts";

// Pipe safety: a downstream reader closing the pipe early (e.g. `… | grep -q`,
// `… | head`) makes Node emit an unhandled 'error' on stdout/stderr and crash
// with EPIPE. Swallow EPIPE and exit cleanly so every CLI command is pipe-safe.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
}

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

// E2E seam (off by default): KANTHORD_FAKE_AGENT=<path> points at a JSON file
// of scripted `FakeTurn[]`. When set, the daemon runs the pi Agent loop with a
// deterministic no-model/no-network session factory instead of a real provider.
// Used only by the deterministic Part-A landing Proof (scripts/e2e).
const fakeAgentPath = process.env.KANTHORD_FAKE_AGENT;
let sessionFactory;
if (fakeAgentPath !== undefined) {
  const { readFileSync } = await import("node:fs");
  const { fakeSessionFactoryFromTurns } =
    await import("./agent-runner/fake-session.ts");
  const turns = JSON.parse(readFileSync(fakeAgentPath, "utf8"));
  sessionFactory = fakeSessionFactoryFromTurns(turns);
}

const deps = buildDeps(dbPath, { maxTurns, sessionFactory });

const program = buildProgram(deps);
await program.parseAsync(process.argv);

/**
 * CLI-retirement inventory test (EPIC 019 Story 08).
 *
 * A diagnostic, never proof that a route works: it walks the Commander tree
 * the way `src/apps/cli/commands/commands.ts:13-19` does and checks that
 * every `ROUTES` row's `cliCommands` entries name a real CLI leaf. The
 * roadmap lives in `.agent/plan/stories/019-http-server/retirement.md`, not
 * in an assertion here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { Command } from "commander";

import { buildProgram } from "../cli/index.ts";
import type { CliDeps } from "../cli/deps.ts";
import { ROUTES } from "./routes.ts";

const program = buildProgram({} as unknown as CliDeps, {
  out: () => {},
  err: () => {},
  setExitCode: () => {},
});

const leaves: string[] = [];
const walk = (cmd: Command, path: string): void => {
  const full = path ? `${path} ${cmd.name()}` : cmd.name();
  if (cmd.commands.length === 0) {
    leaves.push(full);
    return;
  }
  for (const sub of cmd.commands) walk(sub, full);
};
for (const sub of program.commands) walk(sub, "");

test("every ROUTES row's cliCommands entries name a real CLI leaf", () => {
  for (const route of ROUTES) {
    for (const cliCommand of route.cliCommands) {
      assert.ok(
        leaves.includes(cliCommand),
        `route "${route.id}" claims CLI leaf "${cliCommand}", which does not exist in the Commander tree`,
      );
    }
  }
});

test("leaves.length is 80 after Story 07 (serve included)", () => {
  // sibling count: src/apps/cli/architecture.test.ts:40 (EXPECTED_LEAF_COUNT)
  assert.equal(leaves.length, 80);
});

test("the uncovered set (leaves minus every row's cliCommands, minus serve/commands) is non-empty in 019", () => {
  const covered = new Set(ROUTES.flatMap((route) => route.cliCommands));
  const uncovered = leaves.filter(
    (leaf) => !covered.has(leaf) && leaf !== "serve" && leaf !== "commands",
  );
  assert.ok(uncovered.length > 0, "expected a non-empty uncovered set in 019");

  if (process.env["KANTHORD_CLI_COVERAGE_REPORT"] === "1") {
    process.stdout.write(uncovered.sort().join("\n") + "\n");
  }
});

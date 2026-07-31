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

test("the 27 CLI leaves claimed by EPIC 020 and 022 all appear across ROUTES' cliCommands", () => {
  const covered = new Set(ROUTES.flatMap((route) => route.cliCommands));
  const expectedCovered = [
    "get project",
    "get initiative",
    "get objective",
    "get task",
    "get resource",
    "get repository",
    "get ai-provider",
    "get graph",
    "get overview",
    "get conflict",
    "list project",
    "list initiative",
    "list objective",
    "list task",
    "list credential",
    "list filesystem",
    "list notification",
    "list repository",
    "list ai-provider",
    "list model",
    "queue",
    "find project",
    "find initiative",
    "find objective",
    "find resource",
    "list event",
    "ack project",
  ];
  assert.equal(expectedCovered.length, 27);
  for (const cliCommand of expectedCovered) {
    assert.ok(
      covered.has(cliCommand),
      `expected "${cliCommand}" to be covered by ROUTES' cliCommands`,
    );
  }
});

test("the 27 CLI leaves claimed by EPIC 021 all appear across ROUTES' cliCommands", () => {
  const covered = new Set(ROUTES.flatMap((route) => route.cliCommands));
  const expectedCovered = [
    "create project",
    "create initiative",
    "create objective",
    "create task",
    "create credential",
    "create filesystem",
    "create notification",
    "create repository",
    "rename project",
    "rename initiative",
    "rename objective",
    "add dependency",
    "add initiative-dependency",
    "add objective-dependency",
    "remove dependency",
    "remove initiative-dependency",
    "remove objective-dependency",
    "update credential",
    "update filesystem",
    "update notification",
    "update repository",
    "import resource",
    "import graph",
    "export initiative",
    "export diagnostic",
    "check graph",
    "check project",
  ];
  assert.equal(expectedCovered.length, 27);
  for (const cliCommand of expectedCovered) {
    assert.ok(
      covered.has(cliCommand),
      `expected "${cliCommand}" to be covered by ROUTES' cliCommands`,
    );
  }
});

test("the uncovered set shrank by the 27 leaves EPIC 021 claims plus the 2 leaves EPIC 022 claims plus EPIC 023's 9 leaves (S2 2, S3 2, S4 3, S5 2)", () => {
  const covered = new Set(ROUTES.flatMap((route) => route.cliCommands));
  const uncovered = leaves.filter(
    (leaf) => !covered.has(leaf) && leaf !== "serve" && leaf !== "commands",
  );
  // 78 retirable leaves, 25 claimed by 020, 27 claimed by 021, 2 claimed by 022,
  // 2 claimed by 023 S2 ("approve task", "reject task"), 2 claimed by 023 S3
  // ("retry task", "abandon task"), 3 claimed by 023 S4 ("approve objective",
  // "reject objective", "retry objective"), 2 claimed by 023 S5 ("pause
  // initiative", "resume initiative").
  assert.equal(uncovered.length, 15);
});

test("the 9 CLI leaves claimed by EPIC 023 all appear across ROUTES' cliCommands", () => {
  const covered = new Set(ROUTES.flatMap((route) => route.cliCommands));
  const expectedCovered = [
    "approve task",
    "approve objective",
    "reject task",
    "reject objective",
    "retry task",
    "retry objective",
    "abandon task",
    "pause initiative",
    "resume initiative",
  ];
  for (const cliCommand of expectedCovered) {
    assert.ok(
      covered.has(cliCommand),
      `expected "${cliCommand}" to be covered by ROUTES' cliCommands`,
    );
  }
});

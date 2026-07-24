/**
 * Architecture, help-completeness, and old-spelling-rejection tests.
 * Story 07 Task T6 (EPIC 007.2).
 *
 * Three structural guarantees:
 *   (a) index.ts assembles only — no .action()/.option()/.requiredOption()/.argument().
 *   (b) Every leaf command has a non-empty description and full help (Usage + Example).
 *   (c) Every old/removed spelling exits non-zero with an unknown-command message.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { Command } from "commander";

import { buildProgram } from "./index.ts";
import { runCli } from "./commands/run-cli.ts";
import type { CliDeps } from "./deps.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const INDEX_SRC = join(__dirname, "index.ts");
const COMMANDS_DIR = join(__dirname, "commands");

/** Number of leaf files under commands/ subdirectories (007.12 added four: approve/objective.ts, retry/objective.ts, get/initiative.ts, get/objective.ts). */
const EXPECTED_LEAF_FILE_COUNT = 52;

/** Number of audited leaves in the EPIC inventory. */
const EXPECTED_LEAF_COUNT = 54;

/** Methods that must not appear in index.ts (leaf-only concerns). */
const BANNED_IN_INDEX = [
  ".action(",
  ".option(",
  ".requiredOption(",
  ".argument(",
] as const;

/** Recursively collect leaf commands (nodes with no subcommands). */
function collectLeaves(cmd: Command): Command[] {
  if (cmd.commands.length === 0) return [cmd];
  return cmd.commands.flatMap(collectLeaves);
}

const noopDeps = {} as unknown as CliDeps;
const noopIo = {
  out: () => {},
  err: () => {},
  setExitCode: () => {},
};

describe("src/apps/cli/architecture.ts", () => {
  test("index.ts assembles only — no action/option/requiredOption/argument registration", () => {
    const source = readFileSync(INDEX_SRC, "utf8");
    for (const banned of BANNED_IN_INDEX) {
      assert.ok(
        !source.includes(banned),
        `index.ts must not contain '${banned}' — leaf files own option and action registration`,
      );
    }
  });

  test("commands/ contains exactly 52 leaf files — one per audited inventory entry", () => {
    const parentDirs = readdirSync(COMMANDS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    let count = 0;
    for (const dir of parentDirs) {
      const leafFiles = readdirSync(join(COMMANDS_DIR, dir), {
        withFileTypes: true,
      }).filter(
        (e) =>
          e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"),
      );
      count += leafFiles.length;
    }

    assert.equal(
      count,
      EXPECTED_LEAF_FILE_COUNT,
      `Expected ${EXPECTED_LEAF_FILE_COUNT} leaf files under commands/*/, found ${count}`,
    );
  });

  test("every leaf command has a non-empty description and complete help with Usage and Example", () => {
    const program = buildProgram(noopDeps, noopIo);
    const leaves = collectLeaves(program);

    assert.equal(
      leaves.length,
      EXPECTED_LEAF_COUNT,
      `buildProgram must expose exactly ${EXPECTED_LEAF_COUNT} registered leaves`,
    );

    for (const leaf of leaves) {
      const name = leaf.name();

      assert.ok(
        leaf.description().length > 0,
        `leaf '${name}' must have a non-empty description`,
      );

      let helpText = "";
      leaf.configureOutput({
        writeOut: (s) => {
          helpText += s;
        },
      });
      leaf.outputHelp();

      assert.ok(
        helpText.includes("Usage:"),
        `leaf '${name}' help must contain 'Usage:'`,
      );
      assert.ok(
        helpText.includes("Example"),
        `leaf '${name}' help must contain 'Example'`,
      );
    }
  });

  test("runCli rejects each old/removed spelling with non-zero exit and unknown-command message", async () => {
    /**
     * The five renamed routes (EPIC 007.2 goal) plus the old positional login form.
     * B3 specifically requires 'events' and 'get models' (previously untested).
     */
    const OLD_SPELLINGS: Array<[label: string, argv: string[]]> = [
      ["daemon run (→ run daemon)", ["daemon", "run"]],
      ["events (→ list event)", ["events"]],
      ["get models (→ list model)", ["get", "models"]],
      ["diagnostics export (→ export diagnostic)", ["diagnostics", "export"]],
      ["repo land (→ land repository)", ["repo", "land"]],
      [
        "login <provider> positional (→ login provider --provider)",
        ["login", "openai-codex"],
      ],
    ];

    for (const [label, argv] of OLD_SPELLINGS) {
      const result = await runCli(argv, noopDeps);
      assert.ok(
        result.exitCode !== 0,
        `old spelling '${label}' must exit non-zero; got exitCode ${result.exitCode}`,
      );
      const allOutput = [...result.stdout, ...result.stderr].join(" ");
      assert.ok(
        allOutput.toLowerCase().includes("unknown"),
        `old spelling '${label}' must report an unknown command/argument; got: ${allOutput}`,
      );
    }
  });

  /**
   * (Story D / F5, EPIC 007.10) `<group> <sub> --help` must print the
   * subcommand's own help (`Usage: kanthord <group> <sub> [options]…`), not
   * the root program's help (`Usage: kanthord [options] [command]`) — proven
   * across the command-group matrix, with `login provider` as the regression
   * guard for the one group already known to work.
   */
  test("(Story D) '<group> <sub> --help' prints the subcommand's own help across the command matrix", async () => {
    const MATRIX: Array<[group: string, sub: string]> = [
      ["get", "conflict"],
      ["create", "ai-provider"],
      ["run", "daemon"],
      ["retry", "task"],
      ["login", "provider"], // regression guard: this pair already works today
    ];

    for (const [group, sub] of MATRIX) {
      const result = await runCli([group, sub, "--help"], noopDeps);
      const output = result.stdout[0] ?? result.stderr[0] ?? "";
      const firstLine = output.split("\n")[0] ?? "";
      assert.equal(
        firstLine,
        `Usage: kanthord ${group} ${sub} [options]`,
        `'${group} ${sub} --help' must print the subcommand's own usage line; got: ${firstLine}`,
      );
    }
  });

  /**
   * (Story D / F5) The `<group> help <sub>` form (Commander's built-in
   * "help as a command" spelling) must keep printing the same subcommand
   * help as `<group> <sub> --help`.
   */
  test("(Story D) '<group> help <sub>' keeps printing the subcommand's own help", async () => {
    const result = await runCli(["get", "help", "conflict"], noopDeps);
    const output = result.stdout[0] ?? result.stderr[0] ?? "";
    const firstLine = output.split("\n")[0] ?? "";
    assert.ok(
      firstLine.startsWith("Usage: kanthord get conflict"),
      `'get help conflict' must print the conflict subcommand's own usage line; got: ${firstLine}`,
    );
  });
});

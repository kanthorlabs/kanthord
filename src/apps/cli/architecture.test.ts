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

/** Number of leaf files under commands/ subdirectories (007.9 Story 03 item A added one file, list/resource.ts, that registers three leaves). */
const EXPECTED_LEAF_FILE_COUNT = 48;

/** Number of audited leaves in the EPIC inventory. */
const EXPECTED_LEAF_COUNT = 50;

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

  test("commands/ contains exactly 48 leaf files — one per audited inventory entry", () => {
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
});

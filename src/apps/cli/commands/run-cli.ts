import { Command, CommanderError } from "commander";

import { buildProgram } from "../index.ts";
import type { CliDeps } from "../deps.ts";

export interface CliRunResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

function captureLine(lines: string[], text: string): void {
  lines.push(text.endsWith("\n") ? text.slice(0, -1) : text);
}

/** Run the Commander program hermetically and capture its legacy result shape. */
export async function runCli(
  argv: string[],
  deps: CliDeps,
): Promise<CliRunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;
  const program = buildProgram(deps, {
    out: (text) => captureLine(stdout, text),
    err: (text) => captureLine(stderr, text),
    setExitCode: (code) => {
      exitCode = code;
    },
  });

  // Apply hermetic exit + output capture to every command in the tree so a
  // parse error in any subcommand throws (instead of calling process.exit and
  // writing to the real streams, which would terminate the test process).
  const makeHermetic = (command: Command): void => {
    command.exitOverride().configureOutput({
      writeOut: (text) => captureLine(stdout, text),
      writeErr: (text) => captureLine(stderr, text),
    });
    for (const child of command.commands) makeHermetic(child);
  };
  makeHermetic(program);

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return {
        exitCode: error.exitCode || 1,
        stdout,
        stderr: [error.message],
      };
    }
    throw error;
  }

  return { exitCode, stdout, stderr };
}

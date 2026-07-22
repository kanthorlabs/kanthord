import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildRenameCommand } from "./rename.ts";
import { buildRenameInitiativeCommand } from "./rename/initiative.ts";
import { buildRenameObjectiveCommand } from "./rename/objective.ts";
import { buildRenameProjectCommand } from "./rename/project.ts";
import { buildAddCommand } from "./add.ts";
import { buildApproveCommand } from "./approve.ts";
import { buildPauseCommand } from "./pause.ts";
import { buildRejectCommand } from "./reject.ts";
import { buildRemoveCommand } from "./remove.ts";
import { buildRetryCommand } from "./retry.ts";
import { buildResumeCommand } from "./resume.ts";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  let code = 0;

  return {
    io: {
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
      setExitCode: (exitCode: number) => {
        code = exitCode;
      },
    },
    out,
    err,
    code: () => code,
  };
}

describe("src/apps/cli/commands/mutation.ts", () => {
  test("renames a project from its required ID and name", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      renameProject: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as Parameters<typeof buildRenameProjectCommand>[0];

    await buildRenameProjectCommand(
      deps,
      cap.io as Parameters<typeof buildRenameProjectCommand>[1],
    ).parseAsync(["--id", "project-1", "--name", "roadmap"], { from: "user" });

    assert.deepEqual(received, { id: "project-1", name: "roadmap" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("renames an initiative from its required ID and name", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      renameInitiative: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as Parameters<typeof buildRenameInitiativeCommand>[0];

    await buildRenameInitiativeCommand(
      deps,
      cap.io as Parameters<typeof buildRenameInitiativeCommand>[1],
    ).parseAsync(["--id", "initiative-1", "--name", "cli"], { from: "user" });

    assert.deepEqual(received, { id: "initiative-1", name: "cli" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("renames an objective from its required ID and name", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      renameObjective: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as Parameters<typeof buildRenameObjectiveCommand>[0];

    await buildRenameObjectiveCommand(
      deps,
      cap.io as Parameters<typeof buildRenameObjectiveCommand>[1],
    ).parseAsync(["--id", "objective-1", "--name", "routing"], {
      from: "user",
    });

    assert.deepEqual(received, { id: "objective-1", name: "routing" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("rejects a rename without its required ID", async () => {
    const cap = capture();
    const command = buildRenameProjectCommand(
      {} as Parameters<typeof buildRenameProjectCommand>[0],
      cap.io as Parameters<typeof buildRenameProjectCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["--name", "roadmap"], { from: "user" }),
      (error: { code?: string }) =>
        error.code === "commander.missingMandatoryOptionValue",
    );
  });

  test("documents rename leaves with canonical usage and examples", async () => {
    const cap = capture();
    const command = buildRenameCommand(
      {} as Parameters<typeof buildRenameCommand>[0],
      cap.io as Parameters<typeof buildRenameCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    for (const resource of ["project", "initiative", "objective"]) {
      await assert.rejects(
        command.parseAsync([resource, "--help"], { from: "user" }),
      );
    }

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord rename project/);
    assert.match(help, /Usage: kanthord rename initiative/);
    assert.match(help, /Usage: kanthord rename objective/);
    assert.match(help, /Example/);
  });

  test("pauses an initiative from its required ID and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      pauseInitiative: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as Parameters<typeof buildPauseCommand>[0];

    await buildPauseCommand(
      deps,
      cap.io as Parameters<typeof buildPauseCommand>[1],
    ).parseAsync(["initiative", "--id", "initiative-1"], { from: "user" });

    assert.deepEqual(received, { initiativeId: "initiative-1" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, ["initiative paused: initiative-1\n"]);
    assert.equal(cap.code(), 0);
  });

  test("resumes an initiative from its required ID and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      resumeInitiative: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as Parameters<typeof buildResumeCommand>[0];

    await buildResumeCommand(
      deps,
      cap.io as Parameters<typeof buildResumeCommand>[1],
    ).parseAsync(["initiative", "--id", "initiative-1"], { from: "user" });

    assert.deepEqual(received, { initiativeId: "initiative-1" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, ["initiative resumed: initiative-1\n"]);
    assert.equal(cap.code(), 0);
  });

  test("rejects pause and resume without their required ID", async () => {
    const cap = capture();

    for (const buildCommand of [buildPauseCommand, buildResumeCommand]) {
      const command = buildCommand(
        {} as Parameters<typeof buildCommand>[0],
        cap.io as Parameters<typeof buildCommand>[1],
      ).exitOverride();
      command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

      await assert.rejects(
        command.parseAsync(["initiative"], { from: "user" }),
        (error: { code?: string }) =>
          error.code === "commander.missingMandatoryOptionValue",
      );
    }
  });

  test("adds a dependency from its task and dependency inputs", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      addDependency: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as Parameters<typeof buildAddCommand>[0];

    await buildAddCommand(
      deps,
      cap.io as Parameters<typeof buildAddCommand>[1],
    ).parseAsync(["dependency", "--task", "task-1", "--dependency", "task-2"], {
      from: "user",
    });

    assert.deepEqual(received, { taskId: "task-1", dependencyId: "task-2" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, ["dependency added: task-1 → task-2\n"]);
    assert.equal(cap.code(), 0);
  });

  test("removes a dependency from its task and dependency inputs", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      removeDependency: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as Parameters<typeof buildRemoveCommand>[0];

    await buildRemoveCommand(
      deps,
      cap.io as Parameters<typeof buildRemoveCommand>[1],
    ).parseAsync(["dependency", "--task", "task-1", "--dependency", "task-2"], {
      from: "user",
    });

    assert.deepEqual(received, { taskId: "task-1", dependencyId: "task-2" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("retries a task from its required ID and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      retryTask: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as Parameters<typeof buildRetryCommand>[0];

    await buildRetryCommand(
      deps,
      cap.io as Parameters<typeof buildRetryCommand>[1],
    ).parseAsync(["task", "--id", "task-1"], { from: "user" });

    assert.deepEqual(received, {
      taskId: "task-1",
      note: undefined,
      rebuild: undefined,
    });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, ["task re-queued: task-1\n"]);
    assert.equal(cap.code(), 0);
  });

  test("approves a task from its required ID and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      approveTask: {
        execute: async (input: unknown) => {
          received = input;
          return {
            kind: "approved",
            taskId: (input as { taskId: string }).taskId,
            canonicalSHA: "",
          };
        },
      },
    } as unknown as Parameters<typeof buildApproveCommand>[0];

    await buildApproveCommand(
      deps,
      cap.io as Parameters<typeof buildApproveCommand>[1],
    ).parseAsync(["task", "--id", "task-1"], { from: "user" });

    assert.deepEqual(received, { taskId: "task-1" });
    assert.deepEqual(cap.out, ["task-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("rejects a task with its resolution and optional reason", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      rejectTask: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as Parameters<typeof buildRejectCommand>[0];

    await buildRejectCommand(
      deps,
      cap.io as Parameters<typeof buildRejectCommand>[1],
    ).parseAsync(
      ["task", "--id", "task-1", "--resolution", "discard", "--reason", "why"],
      { from: "user" },
    );

    assert.deepEqual(received, {
      taskId: "task-1",
      resolution: "discard",
      reason: "why",
    });
    assert.deepEqual(cap.out, ["task-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("documents reject resolution values in canonical help", async () => {
    const cap = capture();
    const command = buildRejectCommand(
      {} as Parameters<typeof buildRejectCommand>[0],
      cap.io as Parameters<typeof buildRejectCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["task", "--help"], { from: "user" }),
    );

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord reject task/);
    assert.match(help, /--resolution <resolution>/);
    assert.match(help, /retry/);
    assert.match(help, /discard/);
    assert.match(help, /Example/);
  });
});

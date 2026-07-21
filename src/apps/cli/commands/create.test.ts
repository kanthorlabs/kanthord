import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PassThrough } from "node:stream";

import { buildCreateCommand } from "./create.ts";
import { buildCreateCredentialCommand } from "./create/credential.ts";
import { buildCreateInitiativeCommand } from "./create/initiative.ts";
import { buildCreateObjectiveCommand } from "./create/objective.ts";
import { buildCreateProjectCommand } from "./create/project.ts";
import { buildCreateRepositoryCommand } from "./create/repository.ts";
import { buildCreateTaskCommand } from "./create/task.ts";

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

describe("src/apps/cli/commands/create.ts", () => {
  test("creates a project from its required name and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      createProject: {
        execute: async (input: unknown) => {
          received = input;
          return "project-1";
        },
      },
    } as Parameters<typeof buildCreateProjectCommand>[0];

    await buildCreateProjectCommand(
      deps,
      cap.io as Parameters<typeof buildCreateProjectCommand>[1],
    ).parseAsync(["--name", "roadmap"], { from: "user" });

    assert.deepEqual(received, { name: "roadmap" });
    assert.deepEqual(cap.out, ["project-1\n"]);
    assert.deepEqual(cap.err, ["project created: roadmap\n"]);
    assert.equal(cap.code(), 0);
  });

  test("creates an initiative from its required project and name and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      createInitiative: {
        execute: async (input: unknown) => {
          received = input;
          return "initiative-1";
        },
      },
    } as Parameters<typeof buildCreateInitiativeCommand>[0];

    await buildCreateInitiativeCommand(
      deps,
      cap.io as Parameters<typeof buildCreateInitiativeCommand>[1],
    ).parseAsync(["--project", "project-1", "--name", "cli"], { from: "user" });

    assert.deepEqual(received, { projectId: "project-1", name: "cli" });
    assert.deepEqual(cap.out, ["initiative-1\n"]);
    assert.deepEqual(cap.err, ["initiative created: cli\n"]);
    assert.equal(cap.code(), 0);
  });

  test("creates an objective from its required initiative and name and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      createObjective: {
        execute: async (input: unknown) => {
          received = input;
          return "objective-1";
        },
      },
    } as Parameters<typeof buildCreateObjectiveCommand>[0];

    await buildCreateObjectiveCommand(
      deps,
      cap.io as Parameters<typeof buildCreateObjectiveCommand>[1],
    ).parseAsync(["--initiative", "initiative-1", "--name", "routing"], {
      from: "user",
    });

    assert.deepEqual(received, {
      initiativeId: "initiative-1",
      name: "routing",
    });
    assert.deepEqual(cap.out, ["objective-1\n"]);
    assert.deepEqual(cap.err, ["objective created: routing\n"]);
    assert.equal(cap.code(), 0);
  });

  test("rejects a project without its required name", async () => {
    const cap = capture();
    const command = buildCreateProjectCommand(
      {} as Parameters<typeof buildCreateProjectCommand>[0],
      cap.io as Parameters<typeof buildCreateProjectCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync([], { from: "user" }),
      (error: { code?: string }) =>
        error.code === "commander.missingMandatoryOptionValue",
    );
  });

  test("creates a notification from its provider and destination and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      addResource: {
        execute: async (input: unknown) => {
          received = input;
          return "notification-1";
        },
      },
    } as Parameters<typeof buildCreateCommand>[0];

    await buildCreateCommand(
      deps,
      cap.io as Parameters<typeof buildCreateCommand>[1],
    ).parseAsync(
      [
        "notification",
        "--project",
        "project-1",
        "--name",
        "alerts",
        "--provider",
        "slack",
        "--destination",
        "#ops",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, {
      type: "notification",
      projectId: "project-1",
      name: "alerts",
      provider: "slack",
      destination: "#ops",
    });
    assert.deepEqual(cap.out, ["notification-1\n"]);
    assert.deepEqual(cap.err, ["notification resource added: alerts\n"]);
    assert.equal(cap.code(), 0);
  });

  test("creates a filesystem from its path and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      addResource: {
        execute: async (input: unknown) => {
          received = input;
          return "filesystem-1";
        },
      },
    } as Parameters<typeof buildCreateCommand>[0];

    await buildCreateCommand(
      deps,
      cap.io as Parameters<typeof buildCreateCommand>[1],
    ).parseAsync(
      [
        "filesystem",
        "--project",
        "project-1",
        "--name",
        "workspace",
        "--path",
        "./work",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, {
      type: "filesystem",
      projectId: "project-1",
      name: "workspace",
      path: "./work",
    });
    assert.deepEqual(cap.out, ["filesystem-1\n"]);
    assert.deepEqual(cap.err, ["filesystem resource added: workspace\n"]);
    assert.equal(cap.code(), 0);
  });

  test("creates an ai-provider from its provider, model, and effort and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      addResource: {
        execute: async (input: unknown) => {
          received = input;
          return "ai-provider-1";
        },
      },
    } as Parameters<typeof buildCreateCommand>[0];

    await buildCreateCommand(
      deps,
      cap.io as Parameters<typeof buildCreateCommand>[1],
    ).parseAsync(
      [
        "ai-provider",
        "--project",
        "project-1",
        "--name",
        "primary",
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-terra",
        "--effort",
        "high",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, {
      type: "ai_provider",
      projectId: "project-1",
      name: "primary",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      effort: "high",
    });
    assert.deepEqual(cap.out, ["ai-provider-1\n"]);
    assert.deepEqual(cap.err, ["ai_provider resource added: primary\n"]);
    assert.equal(cap.code(), 0);
  });

  test("creates a repository with its kebab-case resource options and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      addResource: {
        execute: async (input: unknown) => {
          received = input;
          return "repository-1";
        },
      },
    } as Parameters<typeof buildCreateRepositoryCommand>[0];

    await buildCreateRepositoryCommand(
      deps,
      cap.io as Parameters<typeof buildCreateRepositoryCommand>[1],
    ).parseAsync(
      [
        "--project",
        "project-1",
        "--name",
        "api",
        "--remote-url",
        "https://github.com/acme/api.git",
        "--branch",
        "main",
        "--auth",
        "https-token",
        "--credential",
        "credential-1",
        "--path",
        "./api",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, {
      type: "repository",
      projectId: "project-1",
      name: "api",
      remoteUrl: "https://github.com/acme/api.git",
      branch: "main",
      path: "./api",
      auth: { kind: "https-token", credentialId: "credential-1" },
    });
    assert.deepEqual(cap.out, ["repository-1\n"]);
    assert.deepEqual(cap.err, ["repository resource added: api\n"]);
    assert.equal(cap.code(), 0);
  });

  test("rejects a repository without its required remote URL or branch", async () => {
    for (const args of [
      ["--project", "project-1", "--name", "api", "--branch", "main"],
      [
        "--project",
        "project-1",
        "--name",
        "api",
        "--remote-url",
        "https://github.com/acme/api.git",
      ],
    ]) {
      const cap = capture();
      const command = buildCreateRepositoryCommand(
        {} as Parameters<typeof buildCreateRepositoryCommand>[0],
        cap.io as Parameters<typeof buildCreateRepositoryCommand>[1],
      ).exitOverride();
      command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

      await assert.rejects(
        command.parseAsync(args, { from: "user" }),
        (error: { code?: string }) =>
          error.code === "commander.missingMandatoryOptionValue",
      );
    }
  });

  test("documents repository authentication values in canonical help", async () => {
    const cap = capture();
    const command = buildCreateRepositoryCommand(
      {} as Parameters<typeof buildCreateRepositoryCommand>[0],
      cap.io as Parameters<typeof buildCreateRepositoryCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(command.parseAsync(["--help"], { from: "user" }));

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord create repository/);
    assert.match(help, /ambient/);
    assert.match(help, /https-token/);
    assert.match(help, /ssh-agent/);
    assert.match(help, /Example/);
  });

  test("creates a credential from stdin through its value-file input and emits its result", async () => {
    const input = new PassThrough();
    const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    const cap = capture();
    const deps = {
      addResource: {
        execute: async (resource: {
          type: string;
          projectId: string;
          name: string;
          provider: string;
          value: string;
        }) => {
          assert.deepEqual(resource, {
            type: "credential",
            projectId: "project-1",
            name: "anthropic-key",
            provider: "anthropic",
            value: "credential-from-stdin",
          });
          return "credential-1";
        },
      },
    } as Parameters<typeof buildCreateCredentialCommand>[0];

    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: input,
    });
    try {
      input.end("credential-from-stdin\n");
      await buildCreateCredentialCommand(
        deps,
        cap.io as Parameters<typeof buildCreateCredentialCommand>[1],
      ).parseAsync(
        [
          "--project",
          "project-1",
          "--name",
          "anthropic-key",
          "--provider",
          "anthropic",
          "--value-file",
          "-",
        ],
        { from: "user" },
      );
    } finally {
      if (originalStdin !== undefined) {
        Object.defineProperty(process, "stdin", originalStdin);
      }
    }

    assert.deepEqual(cap.out, ["credential-1\n"]);
    assert.deepEqual(cap.err, ["credential resource added: anthropic-key\n"]);
    assert.equal(cap.code(), 0);
  });

  test("documents credential file input without placing a secret in its example", async () => {
    const cap = capture();
    const command = buildCreateCredentialCommand(
      {} as Parameters<typeof buildCreateCredentialCommand>[0],
      cap.io as Parameters<typeof buildCreateCredentialCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(command.parseAsync(["--help"], { from: "user" }));

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord create credential/);
    assert.match(help, /--value-file/);
    assert.match(help, /Example/);
    assert.doesNotMatch(help, /credential-from-stdin/);
  });

  test("creates a task with repeated inputs and emits its result", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      createTask: {
        execute: async (input: unknown) => {
          received = input;
          return "task-1";
        },
      },
    } as Parameters<typeof buildCreateTaskCommand>[0];

    await buildCreateTaskCommand(
      deps,
      cap.io as Parameters<typeof buildCreateTaskCommand>[1],
    ).parseAsync(
      [
        "--objective",
        "objective-1",
        "--title",
        "migrate parser",
        "--instructions",
        "Route the CLI with Commander.js.",
        "--ac",
        "a1",
        "--ac",
        "a2",
        "--verification",
        "v1",
        "--dependencies",
        "task-0",
        "--context",
        "filesystem=resource-1",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, {
      objectiveId: "objective-1",
      title: "migrate parser",
      agent: "generic@1",
      instructions: "Route the CLI with Commander.js.",
      ac: ["a1", "a2"],
      verification: ["v1"],
      dependencies: ["task-0"],
      context: { filesystem: "resource-1" },
    });
    assert.deepEqual(cap.out, ["task-1\n"]);
    assert.deepEqual(cap.err, ["task created: migrate parser\n"]);
    assert.equal(cap.code(), 0);
  });

  test("documents create leaves with canonical usage and examples", async () => {
    const cap = capture();
    const deps = {} as Parameters<typeof buildCreateCommand>[0];

    for (const resource of [
      "project",
      "initiative",
      "objective",
      "notification",
      "filesystem",
      "ai-provider",
    ]) {
      const command = buildCreateCommand(
        deps,
        cap.io as Parameters<typeof buildCreateCommand>[1],
      ).exitOverride();
      command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
      await assert.rejects(
        command.parseAsync([resource, "--help"], { from: "user" }),
      );
    }

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord create project/);
    assert.match(help, /Usage: kanthord create initiative/);
    assert.match(help, /Usage: kanthord create objective/);
    assert.match(help, /Usage: kanthord create notification/);
    assert.match(help, /Usage: kanthord create filesystem/);
    assert.match(help, /Usage: kanthord create ai-provider/);
    assert.match(help, /slack/);
    assert.match(help, /telegram/);
    assert.match(help, /minimal/);
    assert.match(help, /xhigh/);
    assert.match(help, /Example/);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { buildImportCommand } from "./import.ts";
import { buildExportCommand } from "./export.ts";
import { buildLoginCommand } from "./login.ts";
import { buildRunCommand } from "./run.ts";
import { buildLandCommand } from "./land.ts";

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

async function makeGraphDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-special-"));
  await mkdir(join(dir, "api"));
  await writeFile(
    join(dir, "initiative.md"),
    [
      "---",
      "kind: initiative",
      "ref: cli",
      "name: cli",
      "bindings:",
      "  repository: repository",
      "  model: ai_provider",
      "---",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "api", "objective.md"),
    [
      "---",
      "kind: objective",
      "ref: api",
      "initiative: cli",
      "name: api",
      "context:",
      "  repository: repository",
      "  model: model",
      "---",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "api", "task.md"),
    [
      "---",
      "kind: task",
      "ref: route",
      "objective: api",
      "title: Route the CLI",
      "agent: generic@1",
      "---",
      "# Instructions",
      "Route the command.",
      "# Acceptance Criteria",
      "- [ ] command is routed",
      "",
    ].join("\n"),
  );
  return dir;
}

describe("src/apps/cli/commands/import.ts", () => {
  test("imports resources from its required path and emits its result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-resource-import-"));
    const path = join(dir, "resources.yaml");
    await writeFile(path, "project: project-1\nresources: []\n");

    try {
      let received: unknown;
      const cap = capture();
      const deps = {
        importResources: {
          execute: async (input: unknown) => {
            received = input;
            return ["resource-1"];
          },
        },
      } as unknown as Parameters<typeof buildImportCommand>[0];

      await buildImportCommand(
        deps,
        cap.io as Parameters<typeof buildImportCommand>[1],
      ).parseAsync(["resource", "--path", path], { from: "user" });

      assert.deepEqual(received, { projectId: "project-1", entries: [] });
      assert.deepEqual(cap.out, ["resource-1\n"]);
      assert.deepEqual(cap.err, ["imported 1 resources\n"]);
      assert.equal(cap.code(), 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("imports a graph from its positional directory with repeated bindings", async () => {
    const dir = await makeGraphDirectory();

    try {
      const findCalls: unknown[] = [];
      const resourceIds: string[] = [];
      const graphCalls: unknown[] = [];
      const cap = capture();
      const deps = {
        createGraph: {
          execute: async (input: unknown) => {
            graphCalls.push(input);
            return {
              initiativeId: "initiative-1",
              refToId: {
                objectives: { api: "objective-1" },
                tasks: { route: "task-1" },
              },
              nodes: {
                "initiative-1": "a".repeat(64),
                "objective-1": "b".repeat(64),
                "task-1": "c".repeat(64),
              },
            };
          },
        },
        newId: () => "package-1",
        findResource: {
          execute: async (input: unknown) => {
            findCalls.push(input);
            return (input as { name: string }).name === "repository-name"
              ? "repository-1"
              : "model-1";
          },
        },
        getResource: {
          execute: async (id: string) => {
            resourceIds.push(id);
            return {
              type: id === "repository-1" ? "repository" : "ai_provider",
            };
          },
        },
      } as unknown as Parameters<typeof buildImportCommand>[0];

      await buildImportCommand(
        deps,
        cap.io as Parameters<typeof buildImportCommand>[1],
      ).parseAsync(
        [
          "graph",
          dir,
          "--create",
          "--project",
          "project-1",
          "--bind",
          "repository=repository-name",
          "--bind",
          "model=model-name",
          "--dry-run",
        ],
        { from: "user" },
      );

      assert.deepEqual(findCalls, [
        { projectId: "project-1", name: "repository-name" },
        { projectId: "project-1", name: "model-name" },
      ]);
      assert.deepEqual(resourceIds, ["repository-1", "model-1"]);
      assert.equal(graphCalls.length, 1);
      assert.deepEqual((graphCalls[0] as { bindings?: unknown }).bindings, {
        repository: "repository-1",
        model: "model-1",
      });
      assert.deepEqual(cap.out, ["created 3 nodes\n"]);
      assert.deepEqual(cap.err, []);
      assert.equal(cap.code(), 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("defaults the optional graph directory argument to the current directory", () => {
    const cap = capture();
    const command = buildImportCommand(
      {} as Parameters<typeof buildImportCommand>[0],
      cap.io as Parameters<typeof buildImportCommand>[1],
    );
    const graph = command.commands.find((child) => child.name() === "graph");

    assert.equal(graph?.registeredArguments[0]?.defaultValue, ".");
  });
});

describe("src/apps/cli/commands/export.ts", () => {
  test("exports an initiative from its positional ID and output directory", async () => {
    const out = await mkdtemp(join(tmpdir(), "kanthord-initiative-export-"));

    try {
      const received: string[] = [];
      const cap = capture();
      const deps = {
        exportInitiative: {
          execute: async (id: string) => {
            received.push(id);
            return {
              packageId: "package-1",
              formatVersion: 1,
              initiative: {
                ref: "initiative-1",
                name: "initiative",
                sourcePath: "initiative.md",
              },
              objectives: [],
              tasks: [],
            };
          },
        },
      } as unknown as Parameters<typeof buildExportCommand>[0];

      await buildExportCommand(
        deps,
        cap.io as Parameters<typeof buildExportCommand>[1],
      ).parseAsync(["initiative", "initiative-1", "--out", out], {
        from: "user",
      });

      assert.deepEqual(received, ["initiative-1"]);
      assert.equal(cap.code(), 0);
      assert.equal(cap.err.length, 0);
      assert.ok(cap.out[0]?.startsWith("exported to "));
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  test("exports diagnostics through the canonical diagnostic leaf", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      diagnosticsExport: {
        execute: async (input: unknown) => {
          received = input;
          return {
            recordCount: 1,
            outPath: "/tmp/diagnostic.json",
            preview: [],
          };
        },
      },
    } as unknown as Parameters<typeof buildExportCommand>[0];

    await buildExportCommand(
      deps,
      cap.io as Parameters<typeof buildExportCommand>[1],
    ).parseAsync(
      [
        "diagnostic",
        "--initiative",
        "initiative-1",
        "--out",
        "/tmp/diagnostic.json",
        "--task",
        "task-1",
        "--debug",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, {
      initiativeId: "initiative-1",
      outPath: "/tmp/diagnostic.json",
      taskId: "task-1",
      debug: true,
    });
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.out, []);
    assert.equal(cap.err.length, 1);
  });

  test("does not resolve the old diagnostics export spelling", async () => {
    const cap = capture();
    const command = buildExportCommand(
      {} as Parameters<typeof buildExportCommand>[0],
      cap.io as Parameters<typeof buildExportCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["diagnostics", "export"], { from: "user" }),
    );
  });
});

describe("src/apps/cli/commands/login.ts", () => {
  test("logs in a provider from its required canonical options", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      login: {
        loginProvider: {
          execute: async (input: unknown) => {
            received = input;
            return "credential-1";
          },
        },
        io: {
          print: () => {},
          prompt: async () => "",
        },
      },
    } as unknown as Parameters<typeof buildLoginCommand>[0];

    await buildLoginCommand(
      deps,
      cap.io as Parameters<typeof buildLoginCommand>[1],
    ).parseAsync(
      [
        "provider",
        "--provider",
        "openai-codex",
        "--project",
        "project-1",
        "--name",
        "openai",
        "--method",
        "browser",
      ],
      { from: "user" },
    );

    const { presenter, ...loginInput } = received as {
      presenter?: unknown;
      providerId?: unknown;
      projectId?: unknown;
      name?: unknown;
      method?: unknown;
    };
    assert.deepEqual(loginInput, {
      providerId: "openai-codex",
      projectId: "project-1",
      name: "openai",
      method: "browser",
    });
    assert.equal(typeof presenter, "object");
    assert.deepEqual(cap.out, ["credential-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("requires provider, project, and name for provider login", async () => {
    const cap = capture();
    const command = buildLoginCommand(
      {} as Parameters<typeof buildLoginCommand>[0],
      cap.io as Parameters<typeof buildLoginCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(
        ["provider", "--project", "project-1", "--name", "openai"],
        {
          from: "user",
        },
      ),
      (error: { code?: string }) =>
        error.code === "commander.missingMandatoryOptionValue",
    );
  });

  test("does not resolve the old positional login spelling", async () => {
    const cap = capture();
    const command = buildLoginCommand(
      {} as Parameters<typeof buildLoginCommand>[0],
      cap.io as Parameters<typeof buildLoginCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["openai-codex"], { from: "user" }),
    );
  });
});

describe("src/apps/cli/commands/run.ts", () => {
  test("runs a daemon with repeated failures and canonical options", async () => {
    let receivedFailIds: string[] | undefined;
    let receivedExecuteInput: unknown;
    const cap = capture();
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const deps = {
      logger,
      buildDaemon: (failTaskIds: string[]) => {
        receivedFailIds = failTaskIds;
        return {
          execute: async (input: unknown) => {
            receivedExecuteInput = input;
            return { exitCode: 0, escalatedCount: 0 };
          },
          stop: () => {},
        };
      },
    } as unknown as Parameters<typeof buildRunCommand>[0];

    await buildRunCommand(
      deps,
      cap.io as Parameters<typeof buildRunCommand>[1],
    ).parseAsync(
      [
        "daemon",
        "--fail",
        "task-1",
        "--fail",
        "task-2",
        "--until-idle",
        "--poll-interval",
        "50",
      ],
      { from: "user" },
    );

    assert.deepEqual(receivedFailIds, ["task-1", "task-2"]);
    assert.deepEqual(receivedExecuteInput, {
      untilIdle: true,
      pollIntervalMs: 50,
    });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("does not resolve the old daemon run spelling", async () => {
    const cap = capture();
    const command = buildRunCommand(
      {} as Parameters<typeof buildRunCommand>[0],
      cap.io as Parameters<typeof buildRunCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["daemon", "run"], { from: "user" }),
    );
  });
});

describe("src/apps/cli/commands/land.ts", () => {
  test("lands a repository from its required canonical options", async () => {
    const candidates: unknown[] = [];
    const homes: string[] = [];
    const cap = capture();
    const deps = {
      repoLanding: {
        land: async (home: string, candidate: unknown) => {
          homes.push(home);
          candidates.push(candidate);
          return {
            outcome: { kind: "fast-forward" },
            canonicalSHA: "canonical-1",
          };
        },
      },
      resolveHomeDir: (repositoryId: string) => `/home/${repositoryId}`,
    } as unknown as Parameters<typeof buildLandCommand>[0];

    await buildLandCommand(
      deps,
      cap.io as Parameters<typeof buildLandCommand>[1],
    ).parseAsync(
      [
        "repository",
        "--repository",
        "repository-1",
        "--workspace",
        "/work/repository",
        "--base",
        "main",
        "--candidate",
        "candidate-1",
      ],
      { from: "user" },
    );

    assert.deepEqual(homes, ["/home/repository-1"]);
    assert.deepEqual(candidates, [
      {
        id: "candidate-1",
        taskId: null,
        repoId: "repository-1",
        baseSHA: "",
        candidateSHA: "candidate-1",
        ref: "",
        target: "main",
        workspace: "/work/repository",
      },
    ]);
    assert.deepEqual(cap.out, [
      '{\n  "outcome": "fast-forward",\n  "canonicalSHA": "canonical-1"\n}\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("does not resolve the old repo land spelling", async () => {
    const cap = capture();
    const command = buildLandCommand(
      {} as Parameters<typeof buildLandCommand>[0],
      cap.io as Parameters<typeof buildLandCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["repo", "land"], { from: "user" }),
    );
  });
});

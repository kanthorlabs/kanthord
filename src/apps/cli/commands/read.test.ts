import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildGetCommand } from "./get.ts";
import { buildFindCommand } from "./find.ts";
import { buildListCommand } from "./list.ts";

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

describe("src/apps/cli/commands/read.ts", () => {
  test("gets a task in JSON mode with only its JSON boolean", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getTask: {
        execute: async (input: unknown) => {
          received = input;
          return {
            id: "task-1",
            title: "task",
            status: "pending",
            agent: undefined,
            objectiveId: "objective-1",
            dependencies: [],
            result: undefined,
            context: {},
          };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["task", "--id", "task-1", "--json"], { from: "user" });

    assert.deepEqual(received, { id: "task-1" });
    assert.equal(cap.code(), 0);
    assert.equal(cap.err.length, 0);
    assert.equal(cap.out.length, 1);
    assert.equal(JSON.parse(cap.out[0]!).id, "task-1");
  });

  test("gets a task result with only its result boolean", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getTask: {
        execute: async (input: unknown) => {
          received = input;
          return {
            id: "task-1",
            title: "task",
            status: "completed",
            agent: undefined,
            objectiveId: "objective-1",
            dependencies: [],
            result: {
              workspace: null,
              branch: null,
              baseCommit: null,
              proposalCommit: null,
              commitSha: "commit-1",
              summary: "done",
              reason: null,
              rejectionResolution: null,
              rejectionReason: null,
              evidence: null,
            },
            context: {},
          };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["task", "--id", "task-1", "--result"], { from: "user" });

    assert.deepEqual(received, { id: "task-1" });
    assert.equal(cap.code(), 0);
    assert.equal(cap.err.length, 0);
    assert.ok(cap.out.some((line) => line.includes("commit-1")));
  });

  test("gets a project with its ID and JSON boolean", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getProject: {
        execute: async (input: unknown) => {
          received = input;
          return { id: "project-1", name: "roadmap" };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["project", "--id", "project-1", "--json"], { from: "user" });

    assert.deepEqual(received, { id: "project-1" });
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.err, []);
    assert.deepEqual(cap.out, ['{"id":"project-1","name":"roadmap"}\n']);
  });

  test("gets a resource with its ID and JSON boolean", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getResource: {
        execute: (input: unknown) => {
          received = input;
          return { id: "resource-1", type: "filesystem" };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["resource", "--id", "resource-1", "--json"], {
      from: "user",
    });

    assert.equal(received, "resource-1");
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.err, []);
    assert.deepEqual(cap.out, [
      '{\n  "id": "resource-1",\n  "type": "filesystem"\n}\n',
    ]);
  });

  test("documents get resource with an example that does not expose a secret", async () => {
    const cap = capture();
    const command = buildGetCommand(
      {} as unknown as Parameters<typeof buildGetCommand>[0],
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["resource", "--help"], { from: "user" }),
    );

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord get resource/);
    assert.match(help, /--id <id>/);
    assert.match(help, /Example/);
    assert.doesNotMatch(help, /not-a-secret-value/);
  });

  test("finds a project from its required name and emits its bare ID", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      findProject: {
        execute: async (input: unknown) => {
          received = input;
          return "project-1";
        },
      },
    } as unknown as Parameters<typeof buildFindCommand>[0];

    await buildFindCommand(
      deps,
      cap.io as Parameters<typeof buildFindCommand>[1],
    ).parseAsync(["project", "--name", "roadmap"], { from: "user" });

    assert.deepEqual(received, { name: "roadmap" });
    assert.deepEqual(cap.out, ["project-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("finds an initiative from its required project and name and emits its bare ID", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      findInitiative: {
        execute: async (input: unknown) => {
          received = input;
          return "initiative-1";
        },
      },
    } as unknown as Parameters<typeof buildFindCommand>[0];

    await buildFindCommand(
      deps,
      cap.io as Parameters<typeof buildFindCommand>[1],
    ).parseAsync(["initiative", "--project", "project-1", "--name", "cli"], {
      from: "user",
    });

    assert.deepEqual(received, { projectId: "project-1", name: "cli" });
    assert.deepEqual(cap.out, ["initiative-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("finds an objective from its required initiative and name and emits its bare ID", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      findObjective: {
        execute: async (input: unknown) => {
          received = input;
          return "objective-1";
        },
      },
    } as unknown as Parameters<typeof buildFindCommand>[0];

    await buildFindCommand(
      deps,
      cap.io as Parameters<typeof buildFindCommand>[1],
    ).parseAsync(
      ["objective", "--initiative", "initiative-1", "--name", "routing"],
      { from: "user" },
    );

    assert.deepEqual(received, {
      initiativeId: "initiative-1",
      name: "routing",
    });
    assert.deepEqual(cap.out, ["objective-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("finds a resource from its required project and name and emits its bare ID", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      findResource: {
        execute: async (input: unknown) => {
          received = input;
          return "resource-1";
        },
      },
    } as unknown as Parameters<typeof buildFindCommand>[0];

    await buildFindCommand(
      deps,
      cap.io as Parameters<typeof buildFindCommand>[1],
    ).parseAsync(
      ["resource", "--project", "project-1", "--name", "workspace"],
      { from: "user" },
    );

    assert.deepEqual(received, { projectId: "project-1", name: "workspace" });
    assert.deepEqual(cap.out, ["resource-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists tasks with its required and optional filters in JSON mode", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listTasks: {
        execute: async (input: unknown) => {
          received = input;
          return [
            {
              id: "task-1",
              title: "migrate",
              status: "pending",
              state: "ready",
              waiting: [],
            },
          ];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(
      [
        "task",
        "--initiative",
        "initiative-1",
        "--objective",
        "objective-1",
        "--status",
        "pending",
        "--json",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, {
      initiativeId: "initiative-1",
      objectiveId: "objective-1",
      status: "pending",
    });
    assert.deepEqual(cap.out, [
      '[{"id":"task-1","title":"migrate","status":"pending","state":"ready","waiting":[]}]\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists initiatives from its required project in JSON mode", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listInitiatives: {
        execute: (input: unknown) => {
          received = input;
          return [{ id: "initiative-1", name: "cli" }];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(["initiative", "--project", "project-1", "--json"], {
      from: "user",
    });

    assert.deepEqual(received, { projectId: "project-1" });
    assert.deepEqual(cap.out, ['[{"id":"initiative-1","name":"cli"}]\n']);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists objectives from its required initiative in JSON mode", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listObjectives: {
        execute: (input: unknown) => {
          received = input;
          return [{ id: "objective-1", name: "routing" }];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(["objective", "--initiative", "initiative-1", "--json"], {
      from: "user",
    });

    assert.deepEqual(received, { initiativeId: "initiative-1" });
    assert.deepEqual(cap.out, ['[{"id":"objective-1","name":"routing"}]\n']);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists events with canonical options and removes its SIGINT listener", async () => {
    const cap = capture();
    const listenersBefore = process.listenerCount("SIGINT");
    let listenersWhileListing = 0;
    const received: Array<{ after: string; limit?: number }> = [];
    const deps = {
      listEvents: {
        execute: (input: { after: string; limit?: number }) => {
          listenersWhileListing = process.listenerCount("SIGINT");
          received.push(input);
          setTimeout(() => process.emit("SIGINT"), 0);
          return [{ id: "event-1", type: "task.ready", taskId: "task-1" }];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(
      [
        "event",
        "--after",
        "0",
        "--limit",
        "1",
        "--json",
        "--follow",
        "--poll-interval",
        "1",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, [{ after: "0", limit: 1 }]);
    assert.equal(listenersWhileListing, listenersBefore + 1);
    assert.equal(process.listenerCount("SIGINT"), listenersBefore);
    assert.deepEqual(cap.out, [
      '{"events":[{"id":"event-1","type":"task.ready","taskId":"task-1"}],"nextCursor":""}\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists models in JSON and filters models by provider", async () => {
    const allModels = capture();
    const providers: Array<string | undefined> = [];
    const deps = {
      listModels: (provider?: string) => {
        providers.push(provider);
        return [
          {
            provider: provider ?? "openai-codex",
            id: "gpt-5.5",
            name: "GPT-5.5",
            reasoning: true,
            contextWindow: 200000,
          },
        ];
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      allModels.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(["model", "--json"], { from: "user" });

    assert.deepEqual(providers, [undefined]);
    assert.deepEqual(JSON.parse(allModels.out.join("")), [
      {
        provider: "openai-codex",
        id: "gpt-5.5",
        name: "GPT-5.5",
        reasoning: true,
        contextWindow: 200000,
      },
    ]);
    assert.equal(allModels.code(), 0);

    const filtered = capture();
    await buildListCommand(
      deps,
      filtered.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(["model", "--provider", "anthropic"], { from: "user" });

    assert.deepEqual(providers, [undefined, "anthropic"]);
    assert.match(filtered.out.join(""), /anthropic/);
    assert.deepEqual(filtered.err, []);
    assert.equal(filtered.code(), 0);
  });

  // -------------------------------------------------------------------------
  // 007.9 Story 03 item A — list credential | ai-provider | repository
  // -------------------------------------------------------------------------

  test("(007.9 S3-A) list credential --project <id> --json: forwards {projectId, type: 'credential'}; secret absent from output", async () => {
    let received: unknown;
    const cap = capture();
    const CANARY = "CANARY_SECRET_VALUE";
    const deps = {
      listResources: {
        execute: (input: unknown) => {
          received = input;
          return [
            {
              type: "credential",
              id: "cred-1",
              name: "k1",
              provider: "openai",
            },
          ];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(
      ["credential", "--project", "project-1", "--json"],
      { from: "user" },
    );

    assert.deepEqual(received, { projectId: "project-1", type: "credential" });
    const out = cap.out.join("");
    assert.ok(
      out.includes("cred-1") && out.includes("k1"),
      `expected id + name in output, got: ${out}`,
    );
    assert.equal(
      out.includes(CANARY),
      false,
      "credential secret value must never appear in list output (even --json)",
    );
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("(007.9 S3-A) list ai-provider --project <id>: forwards {projectId, type: 'ai_provider'}", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listResources: {
        execute: (input: unknown) => {
          received = input;
          return [
            {
              type: "ai_provider",
              id: "aip-1",
              name: "claude",
              provider: "anthropic",
              model: "claude-3-5-sonnet",
            },
          ];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(["ai-provider", "--project", "project-1"], {
      from: "user",
    });

    assert.deepEqual(received, { projectId: "project-1", type: "ai_provider" });
    assert.ok(
      cap.out.join("").includes("aip-1"),
      `expected id in output, got: ${cap.out.join("")}`,
    );
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("(007.9 S3-A) list repository --project <id> --json: forwards {projectId, type: 'repository'}", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listResources: {
        execute: (input: unknown) => {
          received = input;
          return [
            {
              type: "repository",
              id: "repo-1",
              name: "home",
              remoteUrl: "https://github.com/acme/api.git",
            },
          ];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(
      ["repository", "--project", "project-1", "--json"],
      { from: "user" },
    );

    assert.deepEqual(received, { projectId: "project-1", type: "repository" });
    assert.deepEqual(cap.out, [
      '[{"type":"repository","id":"repo-1","name":"home","remoteUrl":"https://github.com/acme/api.git"}]\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });
});

// src/apps/cli/ai-provider.test.ts — CLI integration for global AI provider
// commands (008.1 Story C: register, list, get, set-default).

import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import type { CliDeps } from "./deps.ts";
import {
  LoggedOutProviderError,
  DefaultNeedsReplacementError,
  SelfReplacementError,
  ConflictingDefaultChoiceError,
  AssignedProviderError,
  DuplicateAssignmentError,
} from "../../app/ai-provider/errors.ts";
import { buildRegisterAiProviderCommand } from "./commands/register/ai-provider.ts";
import { buildGetAiProviderCommand } from "./commands/get/ai-provider.ts";
import { buildSetDefaultAiProviderCommand } from "./commands/set-default/ai-provider.ts";
import { buildListAiProviderCommand } from "./commands/list/resource.ts";
import { buildLogoutAiProviderCommand } from "./commands/logout/ai-provider.ts";
import { buildRemoveAiProviderCommand } from "./commands/remove/ai-provider.ts";
import { buildAssignAiProviderCommand } from "./commands/assign/ai-provider.ts";
import { buildUnassignAiProviderCommand } from "./commands/unassign/ai-provider.ts";
import { CommanderError } from "commander";
import { UnknownReferenceError } from "../../app/errors.ts";

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

test("register ai-provider: registers a global provider and emits id on stdout + friendly on stderr", async () => {
  let received: unknown;
  const input = new PassThrough();
  const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");

  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: input,
  });
  try {
    input.end("sk-test-key\n");
    const cap = capture();
    const deps = {
      registerAiProvider: {
        execute: (inp: unknown) => {
          received = inp;
          return "aip-test-1";
        },
      },
    } as unknown as Parameters<typeof buildRegisterAiProviderCommand>[0];

    const command = buildRegisterAiProviderCommand(
      deps as unknown as CliDeps,
      cap.io as Parameters<typeof buildRegisterAiProviderCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await command.parseAsync(
      [
        "--name",
        "alpha",
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-terra",
        "--value-file",
        "-",
      ],
      { from: "user" },
    );

    assert.deepEqual(cap.out, ["aip-test-1\n"]);
    assert.equal(cap.err[0], "ai-provider registered: aip-test-1\n");
    assert.equal(cap.code(), 0);
  } finally {
    if (originalStdin !== undefined) {
      Object.defineProperty(process, "stdin", originalStdin);
    }
  }
});

test("get ai-provider --id --json: prints the provider view as JSON with no value", async () => {
  const cap = capture();
  const deps = {
    getAiProvider: {
      execute: (_id: string) => ({
        id: "aip-1",
        name: "alpha",
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        baseUrl: null,
        effort: null,
        state: "active",
        isDefault: true,
      }),
    },
  } as unknown as Parameters<typeof buildGetAiProviderCommand>[0];

  const command = buildGetAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildGetAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1", "--json"], { from: "user" });

  const out0 = cap.out[0]!;
  const json = JSON.parse(out0);
  assert.equal(json.id, "aip-1");
  assert.equal("value" in json, false, "value must not appear in JSON output");
  assert.equal(cap.code(), 0);
});

test("set-default ai-provider --id: flips the default and emits id on stdout + friendly on stderr", async () => {
  let received: unknown;
  const cap = capture();
  const deps = {
    setDefaultAiProvider: {
      execute: (id: string) => {
        received = id;
      },
    },
  } as unknown as Parameters<typeof buildSetDefaultAiProviderCommand>[0];

  const command = buildSetDefaultAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildSetDefaultAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-2"], { from: "user" });

  assert.equal(received, "aip-2");
  assert.deepEqual(cap.out, ["aip-2\n"]);
  assert.equal(cap.err[0], "default ai-provider set: aip-2\n");
  assert.equal(cap.code(), 0);
});

test("set-default ai-provider --id of logged_out provider: exits 1 with error message", async () => {
  const cap = capture();
  const deps = {
    setDefaultAiProvider: {
      execute: (_id: string) => {
        throw new LoggedOutProviderError("aip-2", "set-default");
      },
    },
  } as unknown as Parameters<typeof buildSetDefaultAiProviderCommand>[0];

  const command = buildSetDefaultAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildSetDefaultAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-2"], { from: "user" });

  assert.equal(cap.code(), 1);
  assert.ok(cap.err.length > 0, "stderr must contain error message");
  assert.match(cap.err[0]!, /error:/);
});

test("list ai-provider --json: prints all providers as JSON with no value", async () => {
  const cap = capture();
  const deps = {
    listAiProviders: {
      execute: () => [
        {
          id: "aip-1",
          name: "alpha",
          provider: "openai-codex",
          model: "gpt-5.6-terra",
          baseUrl: null,
          effort: null,
          state: "active",
          isDefault: true,
        },
        {
          id: "aip-2",
          name: "beta",
          provider: "openai-codex",
          model: "gpt-5.6-sol",
          baseUrl: null,
          effort: null,
          state: "active",
          isDefault: false,
        },
      ],
    },
  } as unknown as Parameters<typeof buildListAiProviderCommand>[0];

  const command = buildListAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildListAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--json"], { from: "user" });

  const out0 = cap.out[0]!;
  const json = JSON.parse(out0);
  assert.equal(json.length, 2);
  assert.equal("value" in json[0], false, "value must not appear in list JSON");
  assert.equal(cap.code(), 0);
});

// ── S1: project-scoped list ai-provider (routed to resolveProjectChain) ──
test("list ai-provider --project <id>: calls resolveProjectChain with projectId", async () => {
  const cap = capture();
  let resolveCalled = false;
  const deps = {
    resolveProjectChain: {
      execute: (projectId: string) => {
        resolveCalled = true;
        assert.equal(projectId, "proj-1");
        return [];
      },
    },
    listAiProviders: {
      execute: () => {
        throw new Error(
          "should not call global listAiProviders when --project is given",
        );
      },
    },
  } as unknown as Parameters<typeof buildListAiProviderCommand>[0];

  const command = buildListAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildListAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--project", "proj-1", "--json"], { from: "user" });

  assert.equal(
    resolveCalled,
    true,
    "resolveProjectChain should be called for project-scoped list",
  );
  assert.equal(cap.code(), 0);
});

test("logout ai-provider --id: logs out a non-default provider and emits audit on stderr", async () => {
  let received: unknown;
  const cap = capture();
  const deps = {
    logoutAiProvider: {
      execute: (
        id: string,
        options?: { replacement?: string; confirmNoDefault?: boolean },
      ) => {
        received = { id, replacement: options?.replacement };
      },
    },
    getAiProvider: {
      execute: (_id: string) => ({ name: "alpha", provider: "openai-codex" }),
    },
  } as unknown as Parameters<typeof buildLogoutAiProviderCommand>[0];

  const command = buildLogoutAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildLogoutAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1"], { from: "user" });

  assert.deepEqual(received, { id: "aip-1", replacement: undefined });
  assert.ok(cap.err.length > 0, "stderr must contain audit message");
  const auditLine = cap.err[0]!;
  assert.ok(auditLine.includes("logout"), "audit must contain operation word");
  assert.ok(auditLine.includes("aip-1"), "audit must contain provider id");
  // B5: rich audit — safe name, provider kind, local invalidation
  assert.ok(auditLine.includes("alpha"), "audit must contain safe name");
  assert.ok(
    auditLine.includes("openai-codex") || auditLine.includes("openai"),
    "audit must contain provider kind",
  );
  assert.ok(
    auditLine.includes("local") ||
      auditLine.includes("invalidation") ||
      auditLine.includes("no remote"),
    "audit must mention local invalidation (no remote token revoke)",
  );
  assert.equal(cap.code(), 0);
});

test("logout ai-provider --id of default without --replacement: exits 1 with error", async () => {
  const cap = capture();
  const deps = {
    logoutAiProvider: {
      execute: (
        _id: string,
        _options?: { replacement?: string; confirmNoDefault?: boolean },
      ) => {
        throw new DefaultNeedsReplacementError("aip-1", "logout");
      },
    },
  } as unknown as Parameters<typeof buildLogoutAiProviderCommand>[0];

  const command = buildLogoutAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildLogoutAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1"], { from: "user" });

  assert.equal(cap.code(), 1);
  assert.ok(cap.err.length > 0, "stderr must contain error message");
  assert.match(cap.err[0]!, /error:/);
});

test("remove ai-provider --id: removes non-default provider and emits audit on stderr", async () => {
  let received: unknown;
  const cap = capture();
  const deps = {
    removeAiProvider: {
      execute: (
        id: string,
        options?: { replacement?: string; confirmNoDefault?: boolean },
      ) => {
        received = { id, replacement: options?.replacement };
      },
    },
    getAiProvider: {
      execute: (_id: string) => ({ name: "alpha", provider: "openai-codex" }),
    },
  } as unknown as Parameters<typeof buildRemoveAiProviderCommand>[0];

  const command = buildRemoveAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildRemoveAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1"], { from: "user" });

  assert.deepEqual(received, { id: "aip-1", replacement: undefined });
  assert.ok(cap.err.length > 0, "stderr must contain audit message");
  const auditLine = cap.err[0]!;
  assert.ok(auditLine.includes("remove"), "audit must contain operation word");
  assert.ok(auditLine.includes("aip-1"), "audit must contain provider id");
  // B5: rich audit — safe name, provider kind
  assert.ok(auditLine.includes("alpha"), "audit must contain safe name");
  assert.ok(
    auditLine.includes("openai-codex") || auditLine.includes("openai"),
    "audit must contain provider kind",
  );
  assert.equal(cap.code(), 0);
});

test("remove ai-provider --id of default without --replacement: exits 1 with error", async () => {
  const cap = capture();
  const deps = {
    removeAiProvider: {
      execute: (
        _id: string,
        _options?: { replacement?: string; confirmNoDefault?: boolean },
      ) => {
        throw new DefaultNeedsReplacementError("aip-1", "remove");
      },
    },
  } as unknown as Parameters<typeof buildRemoveAiProviderCommand>[0];

  const command = buildRemoveAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildRemoveAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1"], { from: "user" });

  assert.equal(cap.code(), 1);
  assert.ok(cap.err.length > 0, "stderr must contain error message");
  assert.match(cap.err[0]!, /error:/);
});

// ── B3: CLI-level self-replacement guard ──
test("logout ai-provider --id of default with --replacement same id: exits 1 with friendly error and no stack trace", async () => {
  const cap = capture();
  const deps = {
    logoutAiProvider: {
      execute: (
        _id: string,
        _options?: { replacement?: string; confirmNoDefault?: boolean },
      ) => {
        throw new SelfReplacementError("logout", "aip-1");
      },
    },
  } as unknown as Parameters<typeof buildLogoutAiProviderCommand>[0];

  const command = buildLogoutAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildLogoutAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1", "--replacement", "aip-1"], {
    from: "user",
  });

  assert.equal(cap.code(), 1);
  const stderrAll = cap.err.join("");
  assert.match(stderrAll, /error:/, "stderr must contain error: prefix");
  // No raw stack trace lines
  assert.doesNotMatch(stderrAll, /at /, "no raw stack trace lines");
  assert.doesNotMatch(stderrAll, /^Error:/m, "no Error: line prefix");
});

// ── 008.2 Story B — assign/unassign AI provider CLI ──────────────────────────

test("assign ai-provider --project --provider --rank: assigns at specified rank and exits 0", async () => {
  let received: unknown;
  const cap = capture();
  const deps = {
    assignAiProvider: {
      execute: (input: unknown) => {
        received = input;
      },
    },
  } as unknown as Parameters<typeof buildAssignAiProviderCommand>[0];

  const command = buildAssignAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildAssignAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(
    ["--project", "proj-1", "--provider", "aip-1", "--rank", "0"],
    { from: "user" },
  );

  assert.deepEqual(received, {
    projectId: "proj-1",
    providerId: "aip-1",
    rank: 0,
  });
  assert.equal(cap.code(), 0);
});

test("assign ai-provider --project --provider (no --rank): appends and exits 0", async () => {
  let received: unknown;
  const cap = capture();
  const deps = {
    assignAiProvider: {
      execute: (input: unknown) => {
        received = input;
      },
    },
  } as unknown as Parameters<typeof buildAssignAiProviderCommand>[0];

  const command = buildAssignAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildAssignAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--project", "proj-1", "--provider", "aip-1"], {
    from: "user",
  });

  assert.deepEqual(received, {
    projectId: "proj-1",
    providerId: "aip-1",
  });
  assert.equal(cap.code(), 0);
});

test("assign ai-provider missing --project: exits 1 with error", async () => {
  const cap = capture();
  const deps = {
    assignAiProvider: {
      execute: () => {},
    },
  } as unknown as Parameters<typeof buildAssignAiProviderCommand>[0];

  const command = buildAssignAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildAssignAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  try {
    await command.parseAsync(["--provider", "aip-1", "--rank", "0"], {
      from: "user",
    });
  } catch (err) {
    const ce = err as CommanderError;
    assert.equal(ce.exitCode, 1);
    return;
  }

  assert.fail("expected CommanderError to be thrown");
});

test("assign ai-provider unknown project: exits 1 with error line (no stack)", async () => {
  const cap = capture();
  const deps = {
    assignAiProvider: {
      execute: () => {
        throw new UnknownReferenceError("project", "bad-proj");
      },
    },
  } as unknown as Parameters<typeof buildAssignAiProviderCommand>[0];

  const command = buildAssignAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildAssignAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--project", "bad-proj", "--provider", "aip-1"], {
    from: "user",
  });

  assert.equal(cap.code(), 1);
  assert.match(cap.err[0]!, /error:/);
  assert.doesNotMatch(cap.err.join(""), /at /, "no stack trace lines");
});

test("unassign ai-provider --project --provider: unassigns and exits 0", async () => {
  let received: unknown;
  const cap = capture();
  const deps = {
    unassignAiProvider: {
      execute: (input: unknown) => {
        received = input;
      },
    },
  } as unknown as Parameters<typeof buildUnassignAiProviderCommand>[0];

  const command = buildUnassignAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildUnassignAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--project", "proj-1", "--provider", "aip-1"], {
    from: "user",
  });

  assert.deepEqual(received, { projectId: "proj-1", providerId: "aip-1" });
  assert.equal(cap.code(), 0);
});

test("unassign ai-provider missing --project: exits 1 with error", async () => {
  const cap = capture();
  const deps = {
    unassignAiProvider: {
      execute: () => {},
    },
  } as unknown as Parameters<typeof buildUnassignAiProviderCommand>[0];

  const command = buildUnassignAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildUnassignAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  try {
    await command.parseAsync(["--provider", "aip-1"], { from: "user" });
  } catch (err) {
    const ce = err as CommanderError;
    assert.equal(ce.exitCode, 1);
    return;
  }

  assert.fail("expected CommanderError to be thrown");
});

// ── S10: allow "no default" via a second confirmation ──

test("logout ai-provider --id --confirm-no-default: reaches the use case as confirmNoDefault: true", async () => {
  let received: unknown;
  const cap = capture();
  const deps = {
    logoutAiProvider: {
      execute: (
        id: string,
        options?: { replacement?: string; confirmNoDefault?: boolean },
      ) => {
        received = { id, confirmNoDefault: options?.confirmNoDefault };
      },
    },
    getAiProvider: {
      execute: (_id: string) => ({ name: "alpha", provider: "openai-codex" }),
    },
  } as unknown as Parameters<typeof buildLogoutAiProviderCommand>[0];

  const command = buildLogoutAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildLogoutAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1", "--confirm-no-default"], {
    from: "user",
  });

  assert.deepEqual(received, { id: "aip-1", confirmNoDefault: true });
  assert.equal(cap.code(), 0);
});

test("logout ai-provider --id --replacement <id> --confirm-no-default: exits 1 with a mutually-exclusive error, no stack trace", async () => {
  const cap = capture();
  const deps = {
    logoutAiProvider: {
      execute: (
        _id: string,
        _options?: { replacement?: string; confirmNoDefault?: boolean },
      ) => {
        throw new ConflictingDefaultChoiceError("logout", "aip-1");
      },
    },
    getAiProvider: {
      execute: (_id: string) => ({ name: "alpha", provider: "openai-codex" }),
    },
  } as unknown as Parameters<typeof buildLogoutAiProviderCommand>[0];

  const command = buildLogoutAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildLogoutAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(
    ["--id", "aip-1", "--replacement", "aip-2", "--confirm-no-default"],
    { from: "user" },
  );

  assert.equal(cap.code(), 1);
  const stderrAll = cap.err.join("");
  assert.match(stderrAll, /error:/, "stderr must contain error: prefix");
  assert.match(
    stderrAll,
    /mutually exclusive/i,
    "stderr must name the conflict",
  );
  assert.doesNotMatch(stderrAll, /at /, "no raw stack trace lines");
});

test("logout ai-provider --id --confirm-no-default: the audit line reports the cleared default, and carries no secret", async () => {
  const cap = capture();
  const deps = {
    logoutAiProvider: {
      execute: (
        _id: string,
        _options?: { replacement?: string; confirmNoDefault?: boolean },
      ) => {},
    },
    getAiProvider: {
      execute: (_id: string) => ({ name: "alpha", provider: "openai-codex" }),
    },
  } as unknown as Parameters<typeof buildLogoutAiProviderCommand>[0];

  const command = buildLogoutAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildLogoutAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1", "--confirm-no-default"], {
    from: "user",
  });

  assert.equal(cap.code(), 0);
  const stderrAll = cap.err.join("");
  assert.match(
    stderrAll,
    /default (was )?cleared|no default/i,
    "audit line must report the cleared default",
  );
  assert.doesNotMatch(
    stderrAll,
    /sk-/,
    "audit line must never contain the secret",
  );
});

// ── 008.2 Story D — list ai-provider --project resolved-chain branch ──────────

test("list ai-provider --project <id> --json: calls resolveProjectChain.execute and prints chain-ordered views", async () => {
  let resolveCalled = false;
  const cap = capture();
  const deps = {
    resolveProjectChain: {
      execute: (projectId: string) => {
        resolveCalled = true;
        assert.equal(projectId, "proj-1");
        return [
          {
            id: "p3",
            name: "gamma",
            provider: "openai-codex",
            model: "gpt-5.6-luna",
            baseUrl: null,
            effort: null,
            state: "active",
            isDefault: false,
          },
          {
            id: "p1",
            name: "alpha",
            provider: "openai-codex",
            model: "gpt-5.6-terra",
            baseUrl: null,
            effort: null,
            state: "active",
            isDefault: true,
          },
        ];
      },
    },
    listAiProviders: {
      execute: () => {
        throw new Error(
          "should not call global listAiProviders when --project is given",
        );
      },
    },
  } as unknown as Parameters<typeof buildListAiProviderCommand>[0];

  const command = buildListAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildListAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--project", "proj-1", "--json"], {
    from: "user",
  });

  assert.equal(
    resolveCalled,
    true,
    "resolveProjectChain.execute should be called",
  );
  assert.equal(cap.code(), 0);
  const out0 = cap.out[0]!;
  const json = JSON.parse(out0);
  assert.equal(json.length, 2);
  assert.equal(json[0].id, "p3");
  assert.equal(json[1].id, "p1");
});

test("list ai-provider --project <id> without --json: prints human-readable chain", async () => {
  const cap = capture();
  const deps = {
    resolveProjectChain: {
      execute: (_projectId: string) => [
        {
          id: "p3",
          name: "gamma",
          provider: "openai-codex",
          model: "gpt-5.6-luna",
          baseUrl: null,
          effort: null,
          state: "active",
          isDefault: false,
        },
      ],
    },
    listAiProviders: {
      execute: () => {
        throw new Error(
          "should not call global listAiProviders when --project is given",
        );
      },
    },
  } as unknown as Parameters<typeof buildListAiProviderCommand>[0];

  const command = buildListAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildListAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--project", "proj-1"], { from: "user" });

  assert.equal(cap.code(), 0);
});

test("list ai-provider --json (no --project): still calls global listAiProviders", async () => {
  const cap = capture();
  const deps = {
    resolveProjectChain: {
      execute: () => {
        throw new Error(
          "should not call resolveProjectChain without --project",
        );
      },
    },
    listAiProviders: {
      execute: () => [
        {
          id: "aip-1",
          name: "alpha",
          provider: "openai-codex",
          model: "gpt-5.6-terra",
          baseUrl: null,
          effort: null,
          state: "active",
          isDefault: true,
        },
      ],
    },
  } as unknown as Parameters<typeof buildListAiProviderCommand>[0];

  const command = buildListAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildListAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--json"], { from: "user" });

  assert.equal(cap.code(), 0);
  const out0 = cap.out[0]!;
  const json = JSON.parse(out0);
  assert.equal(json.length, 1);
  assert.equal(json[0].id, "aip-1");
});

test("remove ai-provider --id of default with --replacement same id: exits 1 with friendly error and no stack trace", async () => {
  const cap = capture();
  const deps = {
    removeAiProvider: {
      execute: (
        _id: string,
        _options?: { replacement?: string; confirmNoDefault?: boolean },
      ) => {
        throw new SelfReplacementError("remove", "aip-1");
      },
    },
  } as unknown as Parameters<typeof buildRemoveAiProviderCommand>[0];

  const command = buildRemoveAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildRemoveAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1", "--replacement", "aip-1"], {
    from: "user",
  });

  assert.equal(cap.code(), 1);
  const stderrAll = cap.err.join("");
  assert.match(stderrAll, /error:/, "stderr must contain error: prefix");
  // No raw stack trace lines
  assert.doesNotMatch(stderrAll, /at /, "no raw stack trace lines");
  assert.doesNotMatch(stderrAll, /^Error:/m, "no Error: line prefix");
});

// ── 008.2 Story E — assignment-aware removal CLI ──────────────────────

test("remove ai-provider --id of assigned provider without cascade or replacement: exits 1 with error containing cascade/replacement", async () => {
  const cap = capture();
  const deps = {
    removeAiProvider: {
      execute: (
        _id: string,
        _options?: {
          replacement?: string;
          confirmNoDefault?: boolean;
          cascade?: boolean;
        },
      ) => {
        throw new AssignedProviderError("aip-1", 1);
      },
    },
  } as unknown as Parameters<typeof buildRemoveAiProviderCommand>[0];

  const command = buildRemoveAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildRemoveAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1"], { from: "user" });

  assert.equal(cap.code(), 1);
  const stderrAll = cap.err.join("");
  assert.match(stderrAll, /error:/, "stderr must contain error: prefix");
  assert.match(
    stderrAll,
    /cascade|replacement/i,
    "error must mention --cascade or --replacement",
  );
});

test("remove ai-provider --id --cascade: exits 0 and passes cascade flag", async () => {
  let receivedOptions: unknown;
  const cap = capture();
  const deps = {
    removeAiProvider: {
      execute: (
        id: string,
        options?: {
          replacement?: string;
          confirmNoDefault?: boolean;
          cascade?: boolean;
        },
      ) => {
        receivedOptions = options;
      },
    },
    getAiProvider: {
      execute: (_id: string) => ({ name: "alpha", provider: "openai-codex" }),
    },
  } as unknown as Parameters<typeof buildRemoveAiProviderCommand>[0];

  const command = buildRemoveAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildRemoveAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1", "--cascade"], { from: "user" });

  assert.deepEqual(receivedOptions, { cascade: true });
  assert.equal(cap.code(), 0);
});

test("remove ai-provider --id --replacement <id>: exits 0 and passes replacement flag", async () => {
  let receivedOptions: unknown;
  const cap = capture();
  const deps = {
    removeAiProvider: {
      execute: (
        id: string,
        options?: {
          replacement?: string;
          confirmNoDefault?: boolean;
          cascade?: boolean;
        },
      ) => {
        receivedOptions = options;
      },
    },
    getAiProvider: {
      execute: (_id: string) => ({ name: "alpha", provider: "openai-codex" }),
    },
  } as unknown as Parameters<typeof buildRemoveAiProviderCommand>[0];

  const command = buildRemoveAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildRemoveAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1", "--replacement", "aip-2"], {
    from: "user",
  });

  assert.equal((receivedOptions as any)?.replacement, "aip-2");
  assert.equal(cap.code(), 0);
});

// ── Review-blocker regression: DuplicateAssignmentError must be handled in error-map.ts (B1) ──

test("assign ai-provider duplicate assignment: exits 1 with error line (no stack)", async () => {
  const cap = capture();
  const deps = {
    assignAiProvider: {
      execute: () => {
        throw new DuplicateAssignmentError("proj-1", "aip-1");
      },
    },
  } as unknown as Parameters<typeof buildAssignAiProviderCommand>[0];

  const command = buildAssignAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildAssignAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--project", "proj-1", "--provider", "aip-1"], {
    from: "user",
  });

  assert.equal(cap.code(), 1);
  assert.match(cap.err[0]!, /error:/, "stderr must contain error: prefix");
  assert.doesNotMatch(cap.err.join(""), /at /, "no raw stack trace lines");
});

// ── HUMAN_REVIEW: B4 — --rank abc must not crash with raw stack trace ──

test("assign ai-provider --rank abc: exits 1 with clean error (no stack)", async () => {
  const cap = capture();
  const deps = {
    assignAiProvider: {
      execute: () => {},
    },
  } as unknown as Parameters<typeof buildAssignAiProviderCommand>[0];

  const command = buildAssignAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildAssignAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(
    ["--project", "proj-1", "--provider", "aip-1", "--rank", "abc"],
    { from: "user" },
  );

  assert.equal(cap.code(), 1, "must exit with code 1 for invalid --rank");
  const stderrAll = cap.err.join("");
  assert.match(stderrAll, /error:/, "stderr must contain error: prefix");
  assert.doesNotMatch(stderrAll, /at /, "no raw stack trace lines");
  assert.doesNotMatch(
    stderrAll,
    /NaN|NOT NULL|FOREIGN KEY/i,
    "no raw crash output",
  );
});

// ── HUMAN_REVIEW: S4 — "default reassigned to <id>" not printed when removed provider was never default ──

test("remove ai-provider --id of non-default assigned provider with --replacement: does NOT print default reassigned line", async () => {
  const cap = capture();
  const deps = {
    removeAiProvider: {
      execute: (
        _id: string,
        _options?: {
          replacement?: string;
          confirmNoDefault?: boolean;
          cascade?: boolean;
        },
      ) => {
        // mock succeeds — non-default assigned provider removed with replacement
      },
    },
    getAiProvider: {
      execute: (_id: string) => ({ name: "alpha", provider: "openai-codex" }),
    },
  } as unknown as Parameters<typeof buildRemoveAiProviderCommand>[0];

  const command = buildRemoveAiProviderCommand(
    deps as unknown as CliDeps,
    cap.io as Parameters<typeof buildRemoveAiProviderCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await command.parseAsync(["--id", "aip-1", "--replacement", "aip-2"], {
    from: "user",
  });

  assert.equal(cap.code(), 0);
  const stderrAll = cap.err.join("");
  assert.match(stderrAll, /remove/, "stderr must contain operation word");
  assert.doesNotMatch(
    stderrAll,
    /default reassigned/i,
    "must NOT print default reassigned when removed provider was not the default",
  );
});

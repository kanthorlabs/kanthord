// src/apps/cli/commands/setup/project.test.ts — EPIC 015 Story 5
// Leaf-level test for the `kanthord setup project` command. Mirrors the
// capture() pattern at `src/apps/cli/ai-provider.test.ts:33-49`.
//
// AUTO_REVIEW B3: the leaf now imports `runSetup` directly (no CliDeps
// field for it), so a whole-orchestrator `FakeRunSetup` proves nothing
// about real wiring. These tests instead build a real `CliDeps` bundle
// out of fakes for each individual use case the leaf hands to `runSetup`,
// and assert the leaf's own arg-passing (answersPath / nonInteractive /
// baseDir) through those fakes' recorded calls — plus a real temp
// answers file on disk, since `readTextFile` is not injectable (the leaf
// hardcodes `readFile`).

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Command } from "commander";

import { buildSetupProjectCommand } from "./project.ts";
import type { CliDeps } from "../../deps.ts";
import type { CliIo } from "../action.ts";
import type { ObservedFacts } from "../../../../app/project/setup-plan.ts";
import type { ReadinessReport } from "../../../../app/project/project-readiness.ts";

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
    } as CliIo,
    out,
    err,
    code: () => code,
  };
}

const emptyFacts: ObservedFacts = {
  projectsByName: [],
  credentialsByName: [],
  repositoriesByName: [],
  providersByName: [],
  initiatives: [],
};

const readyReport: ReadinessReport = {
  projectId: "proj",
  configured: true,
  verified: null,
  operational: true,
  ready: true,
  checks: [],
  next: null,
};

/** Builds a real (fake-backed) `CliDeps` sufficient to drive the real
 * `runSetup` orchestrator end to end for a minimal happy answer set:
 * `repository.auth=ambient` (no credential step), `provider.route=oauth`
 * (no registerAiProvider call), `graph.skip=true` (no graph read). */
function buildFakeDeps() {
  const createProjectCalls: Array<{ name: string }> = [];
  const addResourceCalls: Array<Record<string, unknown>> = [];
  const loginCalls: Array<Record<string, unknown>> = [];
  const checkProjectCalls: Array<Record<string, unknown>> = [];

  const deps = {
    observeSetupFacts: { execute: () => emptyFacts },
    createProject: {
      execute: async (input: { name: string }) => {
        createProjectCalls.push(input);
        return "0000000000000000000000PRJ01";
      },
    },
    addResource: {
      execute: async (input: Record<string, unknown>) => {
        addResourceCalls.push(input);
        return "0000000000000000000000REP01";
      },
    },
    registerAiProvider: {
      execute: () => {
        throw new Error(
          "registerAiProvider must not be called for provider.route=oauth",
        );
      },
    },
    assignAiProvider: { execute: () => {} },
    login: {
      loginProvider: {
        execute: async (input: Record<string, unknown>) => {
          loginCalls.push(input);
          return "0000000000000000000000AIP01";
        },
      },
      io: { print: () => {}, prompt: async () => "" },
    },
    createGraph: {
      execute: () => {
        throw new Error("createGraph must not be called for graph.skip=true");
      },
    },
    checkProject: {
      execute: async (input: Record<string, unknown>) => {
        checkProjectCalls.push(input);
        return readyReport;
      },
    },
    repositoryProbe: {
      probe: async () => ({ status: "ok" as const, detail: "ok" }),
    },
    providerProbe: {
      execute: async () => ({
        resourceId: "0000000000000000000000AIP01",
        status: "ok" as const,
        detail: "ok",
      }),
    },
    newId: () => "01JTESTULID000000000PKG001",
    findResource: {
      execute: () => {
        throw new Error("findResource must not be called (graph is skipped)");
      },
    },
    getResource: {
      execute: () => {
        throw new Error("getResource must not be called (graph is skipped)");
      },
    },
    setupPrompt: {
      ask: async () => {
        throw new Error("ask must not be called in --non-interactive mode");
      },
    },
    stdinIsTty: false,
  } as unknown as CliDeps;

  return {
    deps,
    createProjectCalls,
    addResourceCalls,
    loginCalls,
    checkProjectCalls,
  };
}

/** A minimal `--non-interactive`-complete answer set: `repository.path` is
 * left as `overrides.path` so a test can pass a relative value to prove
 * `baseDir` resolution. */
function answersText(path: string): string {
  return (
    [
      "project.name=demo",
      "repository.name=home",
      "repository.remoteUrl=file:///srv/home.git",
      "repository.branch=main",
      `repository.path=${path}`,
      "repository.auth=ambient",
      "provider.route=oauth",
      "provider.name=e2e",
      "provider.provider=openai-codex",
      "provider.model=gpt-5.6-sol",
      "provider.oauthMethod=browser",
      "graph.skip=true",
    ].join("\n") + "\n"
  );
}

describe("buildSetupProjectCommand", () => {
  test("--help first line equals 'Usage: kanthord setup project [options]' and the help text contains 'Example'", async () => {
    const cap = capture();
    const { deps } = buildFakeDeps();

    const command: Command = buildSetupProjectCommand(deps, cap.io);

    let helpText = "";
    command.configureOutput({
      writeOut: (s: string) => {
        helpText += s;
      },
    });
    command.outputHelp();

    const firstLine = helpText.split("\n")[0] ?? "";
    assert.equal(
      firstLine,
      "Usage: kanthord setup project [options]",
      `first line must be the leaf's own usage; got: ${firstLine}`,
    );
    assert.ok(
      helpText.includes("Example"),
      `help text must contain 'Example'; got: ${helpText}`,
    );
  });

  test("--answers <file> --non-interactive reaches runSetup: the answers file is read, parsed, and drives the real orchestrator", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-setup-project-"));
    try {
      const answersPath = join(dir, "setup.answers");
      await writeFile(answersPath, answersText("/srv/mirror"), "utf8");

      const cap = capture();
      const { deps, createProjectCalls, addResourceCalls, loginCalls } =
        buildFakeDeps();
      const command: Command = buildSetupProjectCommand(
        deps,
        cap.io,
      ).exitOverride();

      await command.parseAsync(
        ["--answers", answersPath, "--non-interactive"],
        {
          from: "user",
        },
      );

      assert.equal(
        cap.code(),
        0,
        `expected exit 0; stderr: ${cap.err.join("")}`,
      );
      assert.equal(
        createProjectCalls.length,
        1,
        "createProject must be called once",
      );
      assert.equal(
        createProjectCalls[0]!.name,
        "demo",
        "the project name must come from the answers file the --answers path names",
      );
      assert.equal(
        addResourceCalls.length,
        1,
        "addResource must be called once (repository only)",
      );
      assert.equal(addResourceCalls[0]!["path"], "/srv/mirror");
      assert.equal(
        loginCalls.length,
        1,
        "the oauth route calls loginProvider once",
      );
      assert.equal(loginCalls[0]!["method"], "browser");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--answers <path in a sibling directory> --non-interactive computes baseDir as that file's own directory, not process.cwd()", async () => {
    const root = await mkdtemp(join(tmpdir(), "kanthord-setup-project-"));
    try {
      // A path deliberately NOT under process.cwd() — proves the leaf
      // resolves relative fields (repository.path here) against the
      // answers file's own directory (AUTO_REVIEW B4 / EPIC 015 gate
      // bullet: "repository.path is always absolute").
      const sibling = join(root, "sibling");
      await mkdir(sibling, { recursive: true });
      const answersPath = join(sibling, "setup.answers");
      await writeFile(answersPath, answersText("./mirror"), "utf8");

      const cap = capture();
      const { deps, addResourceCalls } = buildFakeDeps();
      const command: Command = buildSetupProjectCommand(
        deps,
        cap.io,
      ).exitOverride();

      await command.parseAsync(
        ["--answers", answersPath, "--non-interactive"],
        {
          from: "user",
        },
      );

      assert.equal(
        cap.code(),
        0,
        `expected exit 0; stderr: ${cap.err.join("")}`,
      );
      assert.equal(addResourceCalls.length, 1);
      const path = addResourceCalls[0]!["path"];
      assert.equal(
        path,
        resolve(sibling, "mirror"),
        `repository.path must resolve against the answers file's own directory; got: ${String(path)}`,
      );
      assert.notEqual(
        path,
        resolve(process.cwd(), "mirror"),
        "baseDir must not silently fall back to process.cwd() when --answers is given",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a malformed answers file sets the captured exit code to 1 and writes the parse error to stderr", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-setup-project-"));
    try {
      const answersPath = join(dir, "setup.answers");
      // Missing repository.branch (and everything after it) — a guaranteed
      // preflight parse failure, asserted before any use case is touched.
      await writeFile(
        answersPath,
        "project.name=demo\nrepository.name=home\nrepository.remoteUrl=file:///srv/home.git\n",
        "utf8",
      );

      const cap = capture();
      const { deps, createProjectCalls } = buildFakeDeps();
      const command: Command = buildSetupProjectCommand(deps, cap.io);

      await command.parseAsync(
        ["--answers", answersPath, "--non-interactive"],
        {
          from: "user",
        },
      );

      assert.equal(cap.code(), 1, "captured exit code must be 1");
      assert.ok(
        cap.err.some((l) => l.includes("repository.branch")),
        `stderr must name the missing key; got: ${cap.err.join("")}`,
      );
      assert.equal(
        createProjectCalls.length,
        0,
        "no use case runs before the preflight parse",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

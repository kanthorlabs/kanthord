// src/apps/cli/setup/run-setup.interactive.test.ts — EPIC 015 Story 5
// Hermetic, in-process tests for the interactive-prompt seam of the setup
// wizard. Story 4 wired the structural `prompt?: SetupPrompt` field on
// `RunSetupDeps`; Story 5 owns the merge logic, the mode guards, the
// re-prompt-on-invalid behaviour, and the per-answer validation loop.
//
// A scripted `SetupPrompt` (an array of queued answers + a recorded list of
// asked messages) replaces the real readline block. No real TTY, no
// `process.stdin` — `stdinIsTty` is passed in by the test as a boolean.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runSetup } from "./run-setup.ts";
import type { ObservedFacts } from "../../../app/project/setup-plan.ts";
import type { GraphPackage } from "../../../app/graph/graph-package.ts";
import type { ReadinessReport } from "../../../app/project/project-readiness.ts";
import type { CheckProjectInput } from "../../../app/project/check-project.ts";
import type { RunSetupDeps } from "./run-setup.ts";

/**
 * Local mirror of the new `SetupPrompt` interface that Story 5 ships in
 * `src/apps/cli/setup/prompt.ts`. Kept inline so the test stays
 * type-checkable while the placeholder `SetupPrompt` on `RunSetupDeps`
 * (declared in Story 4 with the 4-method shape) is in flight.
 */
interface SetupPrompt {
  /** Resolves `undefined` on EOF / Ctrl-C. */
  ask(message: string): Promise<string | undefined>;
}

// ─── Stable test ids ─────────────────────────────────────────────────────────

const PROJ_ID = "0000000000000000000000PRJ01";
const CRED_ID = "0000000000000000000000CRD01";
const REPO_ID = "0000000000000000000000REP01";
const AIP_ID = "0000000000000000000000AIP01";
const INIT_ID = "0000000000000000000000INI01";

const ULID = (suffix: string): string =>
  `01JTESTULID00000000000${suffix.padStart(6, "0")}A`.slice(0, 26);

const NEW_PROJECT_ID = ULID("PROJ01");
const NEW_CRED_ID = ULID("CRED01");
const NEW_REPO_ID = ULID("REPO01");
const NEW_AIP_ID = ULID("AIP001");
const NEW_INIT_ID = ULID("INIT01");
const NEW_PKG_ID = ULID("PKG001");

// ─── Scripted SetupPrompt ────────────────────────────────────────────────────

class ScriptedPrompt implements SetupPrompt {
  readonly asks: string[] = [];
  /** Queued answers; one per `ask()` call. `undefined` simulates EOF / Ctrl-C. */
  private readonly queue: Array<string | undefined>;
  private idx = 0;

  constructor(answers: Array<string | undefined>) {
    this.queue = answers;
  }

  async ask(message: string): Promise<string | undefined> {
    this.asks.push(message);
    const v = this.idx < this.queue.length ? this.queue[this.idx] : undefined;
    this.idx++;
    return v;
  }
}

// ─── Fake use cases (same shape as run-setup.test.ts) ────────────────────────

class FakeCreateProject {
  calls: Array<{ name: string }> = [];
  async execute(input: { name: string }): Promise<string> {
    this.calls.push(input);
    return NEW_PROJECT_ID;
  }
}

class FakeAddResource {
  calls: Array<Record<string, unknown>> = [];
  nextCredentialId: string = NEW_CRED_ID;
  nextRepositoryId: string = NEW_REPO_ID;
  /**
   * Mirrors real production: `addResource`'s write is committed before the
   * graph step runs, so a bare (un-bridged) `findResourcesByName`/
   * `getResource` lookup already sees this run's own newly-created
   * resource. Set by `makeInteractiveDeps()` after both fakes exist.
   */
  onCreated?: (input: Record<string, unknown>, id: string) => void;
  async execute(input: Record<string, unknown>): Promise<string> {
    this.calls.push(input);
    const id =
      input["type"] === "credential"
        ? this.nextCredentialId
        : this.nextRepositoryId;
    this.onCreated?.(input, id);
    return id;
  }
}

class FakeRegisterAiProvider {
  calls: Array<Record<string, unknown>> = [];
  execute(): string {
    this.calls.push({});
    return NEW_AIP_ID;
  }
}

class FakeAssignAiProvider {
  calls: Array<{ projectId: string; providerId: string }> = [];
  execute(input: { projectId: string; providerId: string }): void {
    this.calls.push(input);
  }
}

class FakeLoginProvider {
  calls: Array<Record<string, unknown>> = [];
  async execute(): Promise<string> {
    this.calls.push({});
    return NEW_AIP_ID;
  }
}

class FakeCreateGraph {
  calls: Array<Record<string, unknown>> = [];
  async execute(): Promise<{ initiativeId: string }> {
    this.calls.push({});
    return { initiativeId: NEW_INIT_ID };
  }
}

class FakeCheckProject {
  calls: CheckProjectInput[] = [];
  report: ReadinessReport = {
    projectId: PROJ_ID,
    configured: true,
    verified: null,
    operational: true,
    ready: true,
    checks: [],
    next: null,
  };
  async execute(input: CheckProjectInput): Promise<ReadinessReport> {
    this.calls.push(input);
    return this.report;
  }
}

class FakeRepositoryProbe {
  calls: Array<Record<string, unknown>> = [];
  result: { status: "ok" | "failed"; detail: string } = {
    status: "ok",
    detail: "ok",
  };
  async probe(): Promise<{ status: "ok" | "failed"; detail: string }> {
    return this.result;
  }
}

class FakeProviderProbe {
  calls: string[] = [];
  result: { resourceId: string; status: "ok"; detail: string } = {
    resourceId: NEW_AIP_ID,
    status: "ok",
    detail: "ok",
  };
  async execute(): Promise<{
    resourceId: string;
    status: "ok" | "failed";
    detail: string;
  }> {
    this.calls.push("called");
    return this.result;
  }
}

class FakeObserveSetupFacts {
  facts: ObservedFacts;
  constructor(facts: ObservedFacts) {
    this.facts = facts;
  }
  execute(): ObservedFacts {
    return this.facts;
  }
}

class FakeReadTextFile {
  responses = new Map<string, string>();
  defaultText: string | undefined;
  calls: string[] = [];
  async readTextFile(path: string): Promise<string> {
    this.calls.push(path);
    const v = this.responses.get(path) ?? this.defaultText;
    if (v === undefined)
      throw new Error(`readTextFile: no fixture for ${path}`);
    return v;
  }
}

class FakeReadSecretFile {
  defaultValue: string | undefined;
  async readSecretFile(): Promise<string> {
    if (this.defaultValue === undefined) throw new Error("no default");
    return this.defaultValue;
  }
}

class FakeReadGraphPackage {
  pkg: GraphPackage;
  constructor(pkg: GraphPackage) {
    this.pkg = pkg;
  }
  async readGraphPackage(): Promise<GraphPackage> {
    return this.pkg;
  }
}

class FakeFindResourcesByName {
  map = new Map<string, Array<{ id: string }>>();
  async findResourcesByName(
    projectId: string,
    name: string,
    type: string,
  ): Promise<Array<{ id: string }>> {
    return this.map.get(`${projectId}|${name}|${type}`) ?? [];
  }
}

class FakeGetResource {
  map = new Map<string, { type: string }>();
  async getResource(id: string): Promise<{ type: string } | undefined> {
    return this.map.get(id);
  }
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const emptyFacts: ObservedFacts = {
  projectsByName: [],
  credentialsByName: [],
  repositoriesByName: [],
  providersByName: [],
  initiatives: [],
};

const factWithProject = (): ObservedFacts => ({
  ...emptyFacts,
  projectsByName: [{ id: PROJ_ID, name: "demo" }],
});

function happyGraphPkg(): GraphPackage {
  return {
    packageId: NEW_PKG_ID,
    formatVersion: 1,
    initiative: {
      ref: "todo",
      name: "TODO application API",
      sourcePath: "todo.md",
      bindings: { source: "repository" },
    },
    objectives: [],
    tasks: [],
  };
}

const ANSWERS_PATH = "/tmp/answers";

function makeInteractiveDeps(
  opts: {
    prompt: SetupPrompt;
    stdinIsTty?: boolean;
    facts?: ObservedFacts;
    answersText?: string;
    answersFilePath?: string;
  } = { prompt: new ScriptedPrompt([]) },
): {
  deps: RunSetupDeps;
  fakes: {
    addResource: FakeAddResource;
    createProject: FakeCreateProject;
    registerAiProvider: FakeRegisterAiProvider;
    assignAiProvider: FakeAssignAiProvider;
    loginProvider: FakeLoginProvider;
    createGraph: FakeCreateGraph;
    checkProject: FakeCheckProject;
    repositoryProbe: FakeRepositoryProbe;
    providerProbe: FakeProviderProbe;
    observeSetupFacts: FakeObserveSetupFacts;
    readTextFile: FakeReadTextFile;
    readSecretFile: FakeReadSecretFile;
    readGraphPackage: FakeReadGraphPackage;
    findResourcesByName: FakeFindResourcesByName;
    getResource: FakeGetResource;
  };
} {
  const addResource = new FakeAddResource();
  const createProject = new FakeCreateProject();
  const registerAiProvider = new FakeRegisterAiProvider();
  const assignAiProvider = new FakeAssignAiProvider();
  const loginProvider = new FakeLoginProvider();
  const createGraph = new FakeCreateGraph();
  const checkProject = new FakeCheckProject();
  const repositoryProbe = new FakeRepositoryProbe();
  const providerProbe = new FakeProviderProbe();
  const observeSetupFacts = new FakeObserveSetupFacts(
    opts.facts ?? factWithProject(),
  );
  const readTextFile = new FakeReadTextFile();
  if (opts.answersText !== undefined) {
    readTextFile.responses.set(
      opts.answersFilePath ?? ANSWERS_PATH,
      opts.answersText,
    );
  }
  const readSecretFile = new FakeReadSecretFile();
  readSecretFile.defaultValue = "super-secret-value";
  const readGraphPackage = new FakeReadGraphPackage(happyGraphPkg());
  const findResourcesByName = new FakeFindResourcesByName();
  const getResource = new FakeGetResource();
  // Mirrors production: `addResource`'s write is committed before the graph
  // step runs, so the real (bare, un-bridged) `findResourcesByName`/
  // `getResource` already resolves a resource this same run just created.
  addResource.onCreated = (input, id) => {
    findResourcesByName.map.set(
      `${input["projectId"]}|${input["name"]}|${input["type"]}`,
      [{ id }],
    );
    getResource.map.set(id, { type: input["type"] as string });
  };

  const deps: RunSetupDeps = {
    observeSetupFacts,
    createProject,
    addResource,
    registerAiProvider,
    assignAiProvider,
    login: { loginProvider, io: { print: () => {}, prompt: async () => "" } },
    createGraph,
    checkProject,
    repositoryProbe,
    providerProbe,
    newId: () => NEW_PKG_ID,
    readTextFile: readTextFile.readTextFile.bind(readTextFile),
    readSecretFile: readSecretFile.readSecretFile.bind(readSecretFile),
    readGraphPackage: readGraphPackage.readGraphPackage.bind(readGraphPackage),
    findResourcesByName:
      findResourcesByName.findResourcesByName.bind(findResourcesByName),
    getResource: getResource.getResource.bind(getResource),
    prompt: opts.prompt as unknown as RunSetupDeps["prompt"],
    stdinIsTty: opts.stdinIsTty ?? false,
  };
  return {
    deps,
    fakes: {
      addResource,
      createProject,
      registerAiProvider,
      assignAiProvider,
      loginProvider,
      createGraph,
      checkProject,
      repositoryProbe,
      providerProbe,
      observeSetupFacts,
      readTextFile,
      readSecretFile,
      readGraphPackage,
      findResourcesByName,
      getResource,
    },
  };
}

// ─── --non-interactive with no --answers ────────────────────────────────────

describe("runSetup interactive — mode guards", () => {
  test("--non-interactive with no --answers → exit 1, stderr names the flag, zero calls on every fake", async () => {
    const { deps, fakes } = makeInteractiveDeps({
      prompt: new ScriptedPrompt([]),
    });
    const result = await runSetup(
      { nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => /--non-interactive requires --answers/.test(l)),
      `stderr must name the flag; got: ${result.stderr.join("\n")}`,
    );
    assert.equal(fakes.addResource.calls.length, 0);
    assert.equal(fakes.createProject.calls.length, 0);
    assert.equal(fakes.registerAiProvider.calls.length, 0);
    assert.equal(fakes.createGraph.calls.length, 0);
  });

  test("no --answers, not --non-interactive, stdinIsTty:false → exit 1, stderr matches /not a TTY/, prompt records zero asks", async () => {
    const prompt = new ScriptedPrompt([
      "demo",
      "home",
      "u",
      "main",
      "/p",
      "ambient",
    ]);
    const { deps } = makeInteractiveDeps({ prompt, stdinIsTty: false });
    const result = await runSetup(
      { nonInteractive: false, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => /not a TTY/.test(l)),
      `stderr must say 'not a TTY'; got: ${result.stderr.join("\n")}`,
    );
    assert.equal(prompt.asks.length, 0, "no asks when stdin is not a TTY");
  });

  test("--answers <file>, not --non-interactive, deps.prompt undefined → exit 1, stderr matches /not a TTY/, never throws, and the answers file is never read", async () => {
    // Regression for AUTO_REVIEW B8: the mode guard at the top of runSetup
    // only checked `deps.prompt === undefined` when `args.answersPath` was
    // ALSO undefined, so an `--answers <file>` run with no prompt seam fell
    // through to `collectInteractiveAnswers(answersText, deps.prompt!)` and
    // threw a TypeError on `undefined.ask(...)` instead of returning a
    // HandlerResult.
    const { deps, fakes } = makeInteractiveDeps({
      prompt: new ScriptedPrompt([]),
      stdinIsTty: true,
      answersFilePath: ANSWERS_PATH,
      answersText: "project.name=demo\n", // content is irrelevant — the
      // guard must fire before the file is ever read.
    });
    const depsNoPrompt: RunSetupDeps = { ...deps, prompt: undefined };

    let result:
      { exitCode: number; stdout: string[]; stderr: string[] } | undefined;
    await assert.doesNotReject(async () => {
      result = await runSetup(
        { nonInteractive: false, answersPath: ANSWERS_PATH, baseDir: "/tmp" },
        depsNoPrompt,
      );
    }, "runSetup must return a HandlerResult, not throw/reject, when --answers is given but deps.prompt is undefined");

    assert.ok(result !== undefined);
    assert.notEqual(result!.exitCode, 0);
    assert.ok(
      result!.stderr.some((l) => /not a TTY/.test(l)),
      `stderr must say 'not a TTY'; got: ${result!.stderr.join("\n")}`,
    );
    assert.equal(
      fakes.readTextFile.calls.length,
      0,
      "the guard must fire before the answers file is ever read",
    );
  });
});

// ─── Interactive happy path ─────────────────────────────────────────────────

describe("runSetup interactive — happy path", () => {
  test("fully interactive happy path: ask order deep-equals the pinned key order for https-token + apiKey + graph.skip=false", async () => {
    const prompt = new ScriptedPrompt([
      "demo", // project.name
      "home", // repository.name
      "file:///srv/home.git", // repository.remoteUrl
      "main", // repository.branch
      "/srv/mirror", // repository.path
      "https-token", // repository.auth
      "gh", // credential.name
      "github", // credential.provider
      "/srv/token", // credential.valueFile
      "apiKey", // provider.route
      "e2e", // provider.name
      "openai-codex", // provider.provider
      "gpt-5.6-sol", // provider.model
      "/srv/pkey", // provider.valueFile
      "true", // provider.confirmCost
      "false", // graph.skip
      "/srv/g", // graph.packagePath
    ]);
    // `graph.bind.<alias>` is never prompted (per the spec), so the one
    // binding the fixture's package declares (`source`) must arrive via a
    // (minimal) answers file; every other key is still collected
    // interactively, matching the Story 4 happy-path answers-file pattern.
    const { deps } = makeInteractiveDeps({
      prompt,
      stdinIsTty: true,
      answersFilePath: ANSWERS_PATH,
      answersText: "graph.bind.source=home\n",
    });
    const result = await runSetup(
      { nonInteractive: false, answersPath: ANSWERS_PATH, baseDir: "/tmp" },
      deps,
    );

    assert.equal(
      result.exitCode,
      0,
      `expected exit 0; stderr: ${result.stderr.join("\n")}`,
    );
    const expectedOrder = [
      "project.name",
      "repository.name",
      "repository.remoteUrl",
      "repository.branch",
      "repository.path",
      "repository.auth",
      "credential.name",
      "credential.provider",
      // `*.valueFile` keys carry the path hint suffix (see formatAskMessage).
      "credential.valueFile (path to a file containing the secret)",
      "provider.route",
      "provider.name",
      "provider.provider",
      "provider.model",
      "provider.valueFile (path to a file containing the secret)",
      "provider.confirmCost",
      "graph.skip",
      "graph.packagePath",
    ];
    assert.deepEqual(
      prompt.asks,
      expectedOrder,
      `ask order must match the pinned sequence; got: ${prompt.asks.join(", ")}`,
    );
  });

  test("answers-file precedence: with project.name and repository.name present in the file, neither key appears in the recorded asks", async () => {
    const answersText =
      [
        "project.name=demo",
        "repository.name=home",
        "repository.remoteUrl=u",
        "repository.branch=main",
        "repository.path=/p",
        "repository.auth=ambient",
        "provider.route=oauth",
        "provider.name=p",
        "provider.provider=openai-codex",
        "provider.model=m",
        "provider.oauthMethod=browser",
        "graph.skip=true",
      ].join("\n") + "\n";
    const prompt = new ScriptedPrompt([
      "openai-codex", // would be provider.name if asked
    ]);
    const { deps } = makeInteractiveDeps({
      prompt,
      stdinIsTty: true,
      facts: factWithProject(),
      answersText,
    });
    const result = await runSetup(
      { nonInteractive: false, answersPath: ANSWERS_PATH, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    assert.ok(
      !prompt.asks.includes("project.name"),
      `project.name must not be re-prompted; asks: ${prompt.asks.join(", ")}`,
    );
    assert.ok(
      !prompt.asks.includes("repository.name"),
      `repository.name must not be re-prompted; asks: ${prompt.asks.join(", ")}`,
    );
  });
});

// ─── Relevance ──────────────────────────────────────────────────────────────

describe("runSetup interactive — relevance", () => {
  test("repository.auth=ambient: no credential.* key is asked", async () => {
    const prompt = new ScriptedPrompt([
      "demo",
      "home",
      "u",
      "main",
      "/p",
      "ambient",
      // no credential.* answers
      "apiKey",
      "e2e",
      "openai-codex",
      "gpt-5.6-sol",
      "/srv/pkey",
      "true",
      "true",
    ]);
    const { deps } = makeInteractiveDeps({ prompt, stdinIsTty: true });
    const result = await runSetup(
      { nonInteractive: false, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    for (const key of prompt.asks) {
      assert.ok(
        !key.startsWith("credential."),
        `credential.* must not be asked when auth=ambient; got: ${key}`,
      );
    }
  });

  test("provider.route=oauth: provider.oauthMethod is asked, valueFile/confirmCost/baseUrl/api are not", async () => {
    const prompt = new ScriptedPrompt([
      "demo",
      "home",
      "u",
      "main",
      "/p",
      "ambient",
      "oauth",
      "e2e",
      "openai-codex",
      "gpt-5.6-sol",
      "browser",
      "true",
    ]);
    const { deps } = makeInteractiveDeps({ prompt, stdinIsTty: true });
    const result = await runSetup(
      { nonInteractive: false, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    assert.ok(
      prompt.asks.includes("provider.oauthMethod"),
      "provider.oauthMethod must be asked for oauth route",
    );
    for (const skipped of [
      "provider.valueFile",
      "provider.confirmCost",
      "provider.baseUrl",
      "provider.api",
    ]) {
      assert.ok(
        !prompt.asks.includes(skipped),
        `${skipped} must NOT be asked for oauth route`,
      );
    }
  });

  test("graph.skip=true: graph.packagePath is not asked", async () => {
    const prompt = new ScriptedPrompt([
      "demo",
      "home",
      "u",
      "main",
      "/p",
      "ambient",
      "oauth",
      "e2e",
      "openai-codex",
      "gpt-5.6-sol",
      "browser",
      "true",
    ]);
    const { deps } = makeInteractiveDeps({ prompt, stdinIsTty: true });
    await runSetup({ nonInteractive: false, baseDir: "/tmp" }, deps);

    assert.ok(
      !prompt.asks.includes("graph.packagePath"),
      `graph.packagePath must not be asked when graph.skip=true; asks: ${prompt.asks.join(", ")}`,
    );
  });
});

// ─── Re-prompt and abort ────────────────────────────────────────────────────

describe("runSetup interactive — re-prompt and abort", () => {
  test("invalid repository.auth then valid → asks twice, prints one error line, run succeeds", async () => {
    const prompt = new ScriptedPrompt([
      "demo",
      "home",
      "u",
      "main",
      "/p",
      "wrong-value", // invalid
      "ambient", // valid
      "apiKey",
      "e2e",
      "openai-codex",
      "gpt-5.6-sol",
      "/srv/pkey",
      "true",
      "true",
    ]);
    const { deps } = makeInteractiveDeps({ prompt, stdinIsTty: true });
    const result = await runSetup(
      { nonInteractive: false, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    const authAsks = prompt.asks.filter((a) => a === "repository.auth");
    assert.equal(
      authAsks.length,
      2,
      `repository.auth asked twice; got ${authAsks.length}`,
    );
    const errorLines = result.stderr.filter((l) => /^error:/.test(l));
    assert.ok(
      errorLines.length >= 1,
      `at least one error: line; got: ${result.stderr.join("\n")}`,
    );
  });

  test("three invalid answers for one key → exit 1, stderr matches /too many invalid answers/, zero write calls", async () => {
    const prompt = new ScriptedPrompt([
      "demo",
      "home",
      "u",
      "main",
      "/p",
      "wrong1",
      "wrong2",
      "wrong3",
    ]);
    const { deps, fakes } = makeInteractiveDeps({ prompt, stdinIsTty: true });
    const result = await runSetup(
      { nonInteractive: false, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => /too many invalid answers/.test(l)),
      `stderr must say 'too many invalid answers'; got: ${result.stderr.join("\n")}`,
    );
    assert.equal(fakes.createProject.calls.length, 0);
    assert.equal(fakes.addResource.calls.length, 0);
    assert.equal(fakes.registerAiProvider.calls.length, 0);
    assert.equal(fakes.createGraph.calls.length, 0);
  });

  test("ask returning undefined mid-sequence → exit 1, stderr 'error: aborted', zero write calls", async () => {
    const prompt = new ScriptedPrompt([
      "demo",
      "home",
      "u",
      "main",
      "/p",
      undefined, // EOF on repository.auth
    ]);
    const { deps, fakes } = makeInteractiveDeps({ prompt, stdinIsTty: true });
    const result = await runSetup(
      { nonInteractive: false, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => /^error: aborted$/.test(l)),
      `stderr must say 'error: aborted'; got: ${result.stderr.join("\n")}`,
    );
    assert.equal(fakes.createProject.calls.length, 0);
    assert.equal(fakes.addResource.calls.length, 0);
    assert.equal(fakes.registerAiProvider.calls.length, 0);
  });

  test("ask message for credential.valueFile mentions 'path'; recorded messages contain no secret", async () => {
    const prompt = new ScriptedPrompt([
      "demo",
      "home",
      "u",
      "main",
      "/p",
      "https-token",
      "gh",
      "github",
      "/srv/token", // path, never echoed
    ]);
    const { deps } = makeInteractiveDeps({ prompt, stdinIsTty: true });
    await runSetup({ nonInteractive: false, baseDir: "/tmp" }, deps);

    // The valueFile ask message must be path-shaped.
    const vfAsk = prompt.asks.find((a) => a.startsWith("credential.valueFile"));
    assert.ok(vfAsk, "credential.valueFile must be asked");
    assert.ok(
      /path/i.test(vfAsk!),
      `ask message for credential.valueFile must mention 'path'; got: ${vfAsk}`,
    );
    // No recorded message should include the value.
    for (const m of prompt.asks) {
      assert.ok(
        !m.includes("super-secret-value"),
        `no recorded ask may include a secret; got: ${m}`,
      );
    }
  });

  test("--non-interactive with a complete answers file records zero asks", async () => {
    const answersText =
      [
        "project.name=demo",
        "repository.name=home",
        "repository.remoteUrl=u",
        "repository.branch=main",
        "repository.path=/p",
        "repository.auth=ambient",
        "provider.route=oauth",
        "provider.name=p",
        "provider.provider=openai-codex",
        "provider.model=m",
        "provider.oauthMethod=browser",
        "graph.skip=true",
      ].join("\n") + "\n";
    const prompt = new ScriptedPrompt(["would-error-if-asked"]);
    const { deps } = makeInteractiveDeps({
      prompt,
      facts: factWithProject(),
      answersText,
    });
    const result = await runSetup(
      { nonInteractive: true, answersPath: ANSWERS_PATH, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    assert.equal(prompt.asks.length, 0, "no asks in --non-interactive mode");
  });
});

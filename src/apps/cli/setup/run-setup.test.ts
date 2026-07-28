// src/apps/cli/setup/run-setup.test.ts — EPIC 015 Story 4
// Hermetic, in-process tests for the setup orchestrator `runSetup`. Every
// dependency is an inline fake; no real sqlite, no git, no network, no
// TTY, no clock. The orchestrator is the single point that turns the
// reconciliation plan (Story 1) + the preflight answer (Story 2) into
// concrete database writes; the Proof's Phases E–J are the live witness.
//
// Every test assembles a `RunSetupDeps` bundle with fakes that record
// calls. Step order, call counts, and the exact stdout/stderr line shapes
// are the executable contract — the orchestrator is the only place that
// decides when to probe, when to verify, and when to short-circuit.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runSetup } from "./run-setup.ts";
import type {
  ObservedFacts,
  SetupAnswers,
} from "../../../app/project/setup-plan.ts";
import type { GraphPackage } from "../../../app/graph/graph-package.ts";
import type { CheckProjectDeps } from "../../../app/project/check-project.ts";
import type { CheckProject } from "../../../app/project/check-project.ts";
import type { ReadinessReport } from "../../../app/project/project-readiness.ts";
import type { AddResourceInput } from "../../../app/resource/add-resource.ts";
import type { RegisterAiProviderInput } from "../../../app/ai-provider/register-ai-provider.ts";
import type { AssignAiProviderInput } from "../../../app/ai-provider/assign-ai-provider.ts";
import type { LoginProviderInput } from "../../../app/auth/login-provider.ts";
import type { CreateGraphInput } from "../../../app/graph/create-graph.ts";
import type { ObserveSetupFactsInput } from "../../../app/project/observe-setup-facts.ts";
import { DuplicateNameError, UnknownModelError } from "../../../app/errors.ts";
import { DuplicateAssignmentError } from "../../../app/ai-provider/errors.ts";
import { NonOAuthProviderError } from "../../../app/ai-provider/errors.ts";
import { ImportValidationError } from "../../../app/resource/import-resources.ts";

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

// ─── Fake use cases ──────────────────────────────────────────────────────────

class FakeCreateProject {
  calls: Array<{ name: string }> = [];
  nextId: string = NEW_PROJECT_ID;
  throwWith: Error | undefined;

  async execute(input: { name: string }): Promise<string> {
    this.calls.push(input);
    if (this.throwWith) throw this.throwWith;
    return this.nextId;
  }
}

class FakeAddResource {
  calls: AddResourceInput[] = [];
  /** id returned for the NEXT credential call. */
  nextCredentialId: string = NEW_CRED_ID;
  /** id returned for the NEXT repository call. */
  nextRepositoryId: string = NEW_REPO_ID;
  /** When set, `execute` throws this instead of returning an id. */
  throwWith: Error | undefined;
  /**
   * Mirrors real production: `addResource`'s write is committed before the
   * graph step runs, so a bare (un-bridged) `findResourcesByName`/
   * `getResource` lookup already sees this run's own newly-created
   * resource. Set by `makeDeps()` after both fakes exist.
   */
  onCreated?: (input: AddResourceInput, id: string) => void;

  async execute(input: AddResourceInput): Promise<string> {
    this.calls.push(input);
    if (this.throwWith) throw this.throwWith;
    const type = (input as Record<string, unknown>)["type"];
    let id: string;
    if (type === "credential") {
      id = this.nextCredentialId;
    } else if (type === "repository") {
      id = this.nextRepositoryId;
    } else {
      // Unknown types are not expected; fall through to the credential id
      // so a stray call is observable but does not mask a bug.
      id = this.nextCredentialId;
    }
    this.onCreated?.(input, id);
    return id;
  }
}

class FakeRegisterAiProvider {
  calls: RegisterAiProviderInput[] = [];
  nextId: string = NEW_AIP_ID;
  throwWith: Error | undefined;

  execute(input: RegisterAiProviderInput): string {
    this.calls.push(input);
    if (this.throwWith) throw this.throwWith;
    return this.nextId;
  }
}

class FakeAssignAiProvider {
  calls: AssignAiProviderInput[] = [];
  throwWith: Error | undefined;

  execute(input: AssignAiProviderInput): void {
    this.calls.push(input);
    if (this.throwWith) throw this.throwWith;
  }
}

class FakeLoginProvider {
  calls: LoginProviderInput[] = [];
  presenterStrings: string[] = [];
  nextId: string = NEW_AIP_ID;
  throwWith: Error | undefined;

  async execute(input: LoginProviderInput): Promise<string> {
    this.calls.push(input);
    if (this.throwWith) throw this.throwWith;
    // Capture every string the presenter saw so the "no presenter output in
    // stdout/stderr" test can assert that none of them leak.
    const presenter = input.presenter as unknown as
      | {
          showAuthUrl?: (url: string, instructions?: string) => void;
          showDeviceCode?: (info: {
            userCode: string;
            verificationUri: string;
          }) => void;
          progress?: (m: string) => void;
          promptCode?: (m: string) => Promise<string>;
        }
      | undefined;
    if (presenter) {
      if (presenter.showAuthUrl) {
        const url = "https://auth.example/abc-secret-token-12345";
        this.presenterStrings.push(url);
        presenter.showAuthUrl(url, "open in browser");
        this.presenterStrings.push("open in browser");
      }
      if (presenter.showDeviceCode) {
        this.presenterStrings.push("DEVICE-CODE-LEAK-99");
        presenter.showDeviceCode({
          userCode: "DEVICE-CODE-LEAK-99",
          verificationUri: "https://auth.example/device",
        });
        this.presenterStrings.push("https://auth.example/device");
      }
      if (presenter.progress) {
        const m = "PROGRESS-LEAK-77";
        this.presenterStrings.push(m);
        presenter.progress(m);
      }
      if (presenter.promptCode) {
        await presenter.promptCode("paste the code");
      }
    }
    return this.nextId;
  }
}

class FakeCreateGraph {
  calls: CreateGraphInput[] = [];
  throwWith: Error | undefined;

  async execute(input: CreateGraphInput): Promise<{ initiativeId: string }> {
    this.calls.push(input);
    if (this.throwWith) throw this.throwWith;
    return { initiativeId: NEW_INIT_ID };
  }
}

class FakeCheckProject {
  calls: Array<{
    id: string;
    probeRepositories: boolean;
    probeProvider: boolean;
  }> = [];
  report: ReadinessReport | Error = {
    projectId: PROJ_ID,
    configured: true,
    verified: null,
    operational: true,
    ready: true,
    checks: [],
    next: null,
  };

  async execute(input: {
    id: string;
    probeRepositories: boolean;
    probeProvider: boolean;
  }): Promise<ReadinessReport> {
    this.calls.push(input);
    if (this.report instanceof Error) throw this.report;
    return this.report;
  }
}

class FakeRepositoryProbe {
  calls: Array<Record<string, unknown>> = [];
  result: { status: "ok" | "failed"; detail: string } = {
    status: "ok",
    detail: "ok",
  };

  async probe(input: Record<string, unknown>): Promise<{
    status: "ok" | "failed";
    detail: string;
  }> {
    this.calls.push(input);
    return this.result;
  }
}

class FakeProviderProbe {
  calls: string[] = [];
  result:
    | { resourceId: string; status: "ok"; detail: string }
    | { resourceId: string; status: "failed"; detail: string } = {
    resourceId: NEW_AIP_ID,
    status: "ok",
    detail: "provider answered the probe prompt",
  };

  async execute(providerId: string): Promise<{
    resourceId: string;
    status: "ok" | "failed";
    detail: string;
  }> {
    this.calls.push(providerId);
    return this.result;
  }
}

class FakeObserveSetupFacts {
  calls: ObserveSetupFactsInput[] = [];
  facts: ObservedFacts;
  throwWith: Error | undefined;

  constructor(facts: ObservedFacts) {
    this.facts = facts;
  }

  execute(input: ObserveSetupFactsInput): ObservedFacts {
    this.calls.push(input);
    if (this.throwWith) throw this.throwWith;
    return this.facts;
  }
}

class FakeReadTextFile {
  responses = new Map<string, string>();
  defaultText: string | undefined;
  throwWith: Error | undefined;
  calls: string[] = [];

  set(path: string, text: string): void {
    this.responses.set(path, text);
  }

  async readTextFile(path: string): Promise<string> {
    this.calls.push(path);
    if (this.throwWith) throw this.throwWith;
    const v = this.responses.get(path) ?? this.defaultText;
    if (v === undefined)
      throw new Error(`readTextFile: no fixture for ${path}`);
    return v;
  }
}

class FakeReadSecretFile {
  responses = new Map<string, string>();
  defaultValue: string | undefined;
  throwWith: Error | undefined;
  calls: string[] = [];

  set(path: string, value: string): void {
    this.responses.set(path, value);
  }

  async readSecretFile(path: string): Promise<string> {
    this.calls.push(path);
    if (this.throwWith) throw this.throwWith;
    const v = this.responses.get(path) ?? this.defaultValue;
    if (v === undefined)
      throw new Error(`readSecretFile: no fixture for ${path}`);
    return v;
  }
}

class FakeReadGraphPackage {
  calls: string[] = [];
  pkg: GraphPackage;
  throwWith: Error | undefined;
  /** When true, return a deeply frozen package (proves nothing can mutate it). */
  freeze = false;

  constructor(pkg: GraphPackage) {
    this.pkg = pkg;
  }

  async readGraphPackage(dir: string): Promise<GraphPackage> {
    this.calls.push(dir);
    if (this.throwWith) throw this.throwWith;
    if (this.freeze) return deepFreeze(this.pkg) as GraphPackage;
    return this.pkg;
  }
}

function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (Object.isFrozen(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>)) {
    out[k] = deepFreeze((v as Record<string, unknown>)[k]);
  }
  return Object.freeze(out) as T;
}

class FakeFindResourcesByName {
  calls: Array<{ projectId: string; name: string; type: string }> = [];
  map = new Map<string, Array<{ id: string }>>();

  set(key: string, ids: Array<{ id: string }>): void {
    this.map.set(key, ids);
  }

  async findResourcesByName(
    projectId: string,
    name: string,
    type: string,
  ): Promise<Array<{ id: string }>> {
    this.calls.push({ projectId, name, type });
    return this.map.get(`${projectId}|${name}|${type}`) ?? [];
  }
}

class FakeGetResource {
  calls: string[] = [];
  map = new Map<string, { type: string; provider?: string }>();

  set(id: string, r: { type: string; provider?: string }): void {
    this.map.set(id, r);
  }

  async getResource(
    id: string,
  ): Promise<{ type: string; provider?: string } | undefined> {
    this.calls.push(id);
    return this.map.get(id);
  }
}

// ─── Defaults — empty observed state, all the fakes wired up ────────────────

const emptyFacts: ObservedFacts = {
  projectsByName: [],
  credentialsByName: [],
  repositoriesByName: [],
  providersByName: [],
  initiatives: [],
};

function fullAnswersText(
  overrides: {
    remoteUrl?: string;
    branch?: string;
    path?: string;
    auth?: "ambient" | "https-token" | "ssh-agent";
    providerRoute?: "oauth" | "apiKey" | "custom";
    graphSkip?: boolean;
    baseUrl?: string;
    api?: "openai-completions" | "openai-responses";
    includeGraphBind?: boolean;
  } = {},
): string {
  const auth = overrides.auth ?? "https-token";
  const route = overrides.providerRoute ?? "apiKey";
  const graphSkip = overrides.graphSkip ?? false;
  const remoteUrl = overrides.remoteUrl ?? "file:///srv/home.git";
  const branch = overrides.branch ?? "main";
  const path = overrides.path ?? "/srv/mirror";
  const valueFile = "/srv/token";
  const packagePath = "/srv/g";
  const baseUrl = overrides.baseUrl;
  const api = overrides.api;

  const lines: string[] = [
    "project.name=demo",
    "repository.name=home",
    `repository.remoteUrl=${remoteUrl}`,
    `repository.branch=${branch}`,
    `repository.path=${path}`,
    `repository.auth=${auth}`,
  ];
  if (auth === "https-token") {
    lines.push(
      "credential.name=gh",
      "credential.provider=github",
      `credential.valueFile=${valueFile}`,
    );
  }
  lines.push(
    `provider.route=${route}`,
    "provider.name=e2e",
    "provider.provider=openai-codex",
    "provider.model=gpt-5.6-sol",
  );
  if (route === "apiKey" || route === "custom") {
    lines.push(`provider.valueFile=${valueFile}`, "provider.confirmCost=true");
  }
  if (route === "custom") {
    lines.push(
      `provider.baseUrl=${baseUrl ?? "https://api.example/v1"}`,
      `provider.api=${api ?? "openai-completions"}`,
    );
  }
  if (route === "oauth") {
    lines.push("provider.oauthMethod=browser");
  }
  if (graphSkip) {
    lines.push("graph.skip=true");
  } else {
    lines.push(`graph.packagePath=${packagePath}`);
    if (overrides.includeGraphBind !== false) {
      lines.push("graph.bind.source=home");
    }
  }
  return lines.join("\n") + "\n";
}

const ANSWERS_PATH = "/tmp/answers";

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

function makeDeps(
  overrides: {
    facts?: ObservedFacts;
    answersText?: string;
    graphPkg?: GraphPackage;
    graphThrows?: Error;
    providerProbeResult?:
      | { resourceId: string; status: "ok"; detail: string }
      | { resourceId: string; status: "failed"; detail: string };
    repositoryProbeResult?: { status: "ok" | "failed"; detail: string };
    checkProjectReport?: ReadinessReport | Error;
    newId?: () => string;
    newRepoId?: string;
    newCredId?: string;
    newAipId?: string;
  } = {},
) {
  const createProject = new FakeCreateProject();
  const addResource = new FakeAddResource();
  if (overrides.newRepoId !== undefined)
    addResource.nextRepositoryId = overrides.newRepoId;
  if (overrides.newCredId !== undefined)
    addResource.nextCredentialId = overrides.newCredId;
  const registerAiProvider = new FakeRegisterAiProvider();
  registerAiProvider.nextId = overrides.newAipId ?? NEW_AIP_ID;
  const assignAiProvider = new FakeAssignAiProvider();
  const loginProvider = new FakeLoginProvider();
  const createGraph = new FakeCreateGraph();
  const checkProject = new FakeCheckProject();
  if (overrides.checkProjectReport !== undefined) {
    checkProject.report = overrides.checkProjectReport;
  }
  const repositoryProbe = new FakeRepositoryProbe();
  if (overrides.repositoryProbeResult !== undefined) {
    repositoryProbe.result = overrides.repositoryProbeResult;
  }
  const providerProbe = new FakeProviderProbe();
  if (overrides.providerProbeResult !== undefined) {
    providerProbe.result = overrides.providerProbeResult;
  }
  const observeSetupFacts = new FakeObserveSetupFacts(
    overrides.facts ?? emptyFacts,
  );
  const readTextFile = new FakeReadTextFile();
  readTextFile.defaultText = overrides.answersText ?? fullAnswersText();
  readTextFile.set(ANSWERS_PATH, readTextFile.defaultText);
  const readSecretFile = new FakeReadSecretFile();
  readSecretFile.defaultValue = "super-secret-value";
  const readGraphPackage = new FakeReadGraphPackage(
    overrides.graphPkg ?? happyGraphPkg(),
  );
  if (overrides.graphThrows) {
    readGraphPackage.throwWith = overrides.graphThrows;
  }
  const findResourcesByName = new FakeFindResourcesByName();
  const getResource = new FakeGetResource();
  // Mirrors production: `addResource`'s write is committed before the graph
  // step runs, so the real (bare, un-bridged) `findResourcesByName`/
  // `getResource` already resolves a resource this same run just created —
  // no bridge is needed, only this fixture-level realism.
  addResource.onCreated = (input, id) => {
    findResourcesByName.set(`${input.projectId}|${input.name}|${input.type}`, [
      { id },
    ]);
    getResource.set(id, { type: input.type });
  };

  const deps = {
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
    newId: overrides.newId ?? (() => NEW_PKG_ID),
    stdinIsTty: true,
    readTextFile: readTextFile.readTextFile.bind(readTextFile),
    readSecretFile: readSecretFile.readSecretFile.bind(readSecretFile),
    readGraphPackage: readGraphPackage.readGraphPackage.bind(readGraphPackage),
    findResourcesByName:
      findResourcesByName.findResourcesByName.bind(findResourcesByName),
    getResource: getResource.getResource.bind(getResource),
  };

  return {
    deps,
    fakes: {
      createProject,
      addResource,
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

const factsWithEverything = (
  overrides: Partial<ObservedFacts> = {},
): ObservedFacts => ({
  projectsByName: [{ id: PROJ_ID, name: "demo" }],
  credentialsByName: [{ id: CRED_ID, name: "gh", provider: "github" }],
  repositoriesByName: [
    {
      id: REPO_ID,
      name: "home",
      remoteUrl: "file:///srv/home.git",
      branch: "main",
      path: "/srv/mirror",
      auth: { kind: "https-token", credentialId: CRED_ID },
    },
  ],
  providersByName: [
    {
      id: AIP_ID,
      name: "e2e",
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      baseUrl: null,
      api: null,
      state: "active",
      assignedToProject: true,
    },
  ],
  initiatives: [{ id: INIT_ID, name: "TODO application API" }],
  ...overrides,
});

// ─── happy first run ────────────────────────────────────────────────────────

describe("runSetup — happy first run (everything creates)", () => {
  test("stdout has exactly five step lines in the order project/credential/repository/provider/graph; exit 0", async () => {
    const { deps } = makeDeps();
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(
      result.exitCode,
      0,
      `expected exit 0; stderr: ${result.stderr.join("\n")}`,
    );
    // Story 5 appends a four-line closing block (project id / readiness /
    // state / next) after the graph step succeeds; this test only pins the
    // five *step* lines, so it checks a prefix rather than the whole array.
    assert.deepEqual(result.stdout.slice(0, 5), [
      `project: created ${NEW_PROJECT_ID}`,
      `credential: created ${NEW_CRED_ID}`,
      `repository: created ${NEW_REPO_ID}`,
      `provider: created ${NEW_AIP_ID} — assigned — verified`,
      `graph: created initiative ${NEW_INIT_ID}`,
    ]);
  });
});

// ─── rerun is a no-op ───────────────────────────────────────────────────────

describe("runSetup — rerun", () => {
  test("with an equivalent project/credential/repository/provider/initiative, every step reports 'already satisfied' and the write fakes + probes record zero calls", async () => {
    // Rerun: graph.skip=true so the graph step short-circuits before
    // touching the package directory — readGraphPackage must record 0
    // calls. The facts include the matching initiative so the "rerun is
    // a no-op" contract covers every step.
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything(),
      answersText: fullAnswersText({ graphSkip: true }),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(
      result.exitCode,
      0,
      `expected exit 0; stderr: ${result.stderr.join("\n")}`,
    );
    // Story 5's four-line closing block is appended after the five step
    // lines on any successful run; this test only pins the step lines.
    const stepLines = result.stdout.slice(0, 5);
    assert.equal(stepLines.length, 5, "five step lines");
    for (const line of stepLines) {
      assert.match(
        line,
        /already satisfied/,
        `every step line must say 'already satisfied' on rerun; got: ${line}`,
      );
    }
    assert.deepEqual(
      result.stderr,
      [],
      `no stderr on rerun; got: ${result.stderr.join("\n")}`,
    );

    assert.equal(
      fakes.createProject.calls.length,
      0,
      "createProject must NOT be called on rerun",
    );
    assert.equal(
      fakes.addResource.calls.length,
      0,
      "addResource must NOT be called on rerun",
    );
    assert.equal(
      fakes.registerAiProvider.calls.length,
      0,
      "registerAiProvider must NOT be called on rerun",
    );
    assert.equal(
      fakes.assignAiProvider.calls.length,
      0,
      "assignAiProvider must NOT be called on rerun",
    );
    assert.equal(
      fakes.createGraph.calls.length,
      0,
      "createGraph must NOT be called on rerun",
    );
    assert.equal(
      fakes.repositoryProbe.calls.length,
      0,
      "repositoryProbe.probe must NOT be called on rerun",
    );
    assert.equal(
      fakes.providerProbe.calls.length,
      0,
      "providerProbe.execute must NOT be called on rerun",
    );
    assert.equal(
      fakes.readGraphPackage.calls.length,
      0,
      "readGraphPackage must NOT be called when the graph step is a no-op rerun (graph.skip=true here means no package read either)",
    );
  });
});

// ─── drift aborts first ─────────────────────────────────────────────────────

describe("runSetup — drift aborts first", () => {
  test("repository remoteUrl drift → exit 1, stderr contains 'drift', and zero write/probe calls", async () => {
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything({
        repositoriesByName: [
          {
            id: REPO_ID,
            name: "home",
            remoteUrl: "file:///srv/old-home.git", // drifted
            branch: "main",
            path: "/srv/mirror",
            auth: { kind: "https-token", credentialId: CRED_ID },
          },
        ],
      }),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0, "drift must exit non-zero");
    assert.ok(
      result.stderr.some((l) => l.includes("drift")),
      `stderr must contain 'drift'; got: ${result.stderr.join("\n")}`,
    );
    assert.equal(
      fakes.createProject.calls.length,
      0,
      "createProject must NOT be called on drift",
    );
    assert.equal(
      fakes.addResource.calls.length,
      0,
      "addResource must NOT be called on drift",
    );
    assert.equal(
      fakes.registerAiProvider.calls.length,
      0,
      "registerAiProvider must NOT be called on drift",
    );
    assert.equal(
      fakes.assignAiProvider.calls.length,
      0,
      "assignAiProvider must NOT be called on drift",
    );
    assert.equal(
      fakes.createGraph.calls.length,
      0,
      "createGraph must NOT be called on drift",
    );
    assert.equal(
      fakes.repositoryProbe.calls.length,
      0,
      "repositoryProbe must NOT run when drift is the first failure",
    );
    assert.equal(
      fakes.readGraphPackage.calls.length,
      0,
      "readGraphPackage must NOT be called on drift",
    );
  });
});

// ─── ambiguous project ──────────────────────────────────────────────────────

describe("runSetup — ambiguous project", () => {
  test("two projects sharing the name → exit 1 and zero write calls", async () => {
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything({
        projectsByName: [
          { id: PROJ_ID, name: "demo" },
          { id: "0000000000000000000000PRJ02", name: "demo" },
        ],
      }),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => /ambiguous/i.test(l)),
      `stderr must mention ambiguity; got: ${result.stderr.join("\n")}`,
    );
    assert.equal(fakes.createProject.calls.length, 0);
    assert.equal(fakes.addResource.calls.length, 0);
    assert.equal(fakes.registerAiProvider.calls.length, 0);
    assert.equal(fakes.assignAiProvider.calls.length, 0);
    assert.equal(fakes.createGraph.calls.length, 0);
  });
});

// ─── preflight failure writes nothing ───────────────────────────────────────

describe("runSetup — preflight failure writes nothing", () => {
  test("an answers text missing repository.branch → exit 1, zero calls on observeSetupFacts and every write fake", async () => {
    const text =
      [
        "project.name=demo",
        "repository.name=home",
        "repository.remoteUrl=file:///srv/home.git",
        // repository.branch missing
        "repository.path=/srv/mirror",
        "repository.auth=ambient",
        "provider.route=oauth",
        "provider.name=e2e",
        "provider.provider=openai-codex",
        "provider.model=gpt-5.6-sol",
        "provider.oauthMethod=browser",
        "graph.skip=true",
      ].join("\n") + "\n";

    const { deps, fakes } = makeDeps({ answersText: text });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => l.includes("repository.branch")),
      `stderr must name the missing key; got: ${result.stderr.join("\n")}`,
    );
    assert.equal(
      fakes.observeSetupFacts.calls.length,
      0,
      "observeSetupFacts must NOT be called on preflight failure",
    );
    assert.equal(fakes.createProject.calls.length, 0);
    assert.equal(fakes.addResource.calls.length, 0);
    assert.equal(fakes.registerAiProvider.calls.length, 0);
    assert.equal(fakes.assignAiProvider.calls.length, 0);
    assert.equal(fakes.createGraph.calls.length, 0);
  });
});

// ─── probe failure ──────────────────────────────────────────────────────────

describe("runSetup — repository probe", () => {
  test("probe failed → exit 1, single stderr line beginning with 'error: repository: remote probe failed:' and containing the detail verbatim; createProject called once, addResource called once (the credential) and never with type=repository", async () => {
    const { deps, fakes } = makeDeps({
      repositoryProbeResult: {
        status: "failed",
        detail: "'does-not-exist.git' does not appear to be a git repository",
      },
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.equal(
      result.stderr.length,
      1,
      `expected exactly one stderr line; got: ${result.stderr.join("\n")}`,
    );
    assert.match(
      result.stderr[0]!,
      /^error: repository: remote probe failed: /,
      `first stderr line must begin with 'error: repository: remote probe failed:'; got: ${result.stderr[0]}`,
    );
    assert.ok(
      result.stderr[0]!.includes(
        "'does-not-exist.git' does not appear to be a git repository",
      ),
      `stderr must carry the redacted detail verbatim; got: ${result.stderr[0]}`,
    );
    assert.equal(
      fakes.createProject.calls.length,
      1,
      "createProject called once (project step)",
    );
    assert.equal(
      fakes.addResource.calls.length,
      1,
      "addResource called once (credential step)",
    );
    const repoCall = fakes.addResource.calls.find(
      (c) => c["type"] === "repository",
    );
    assert.equal(
      repoCall,
      undefined,
      "addResource must NOT be called for type=repository",
    );
    assert.equal(
      fakes.repositoryProbe.calls.length,
      1,
      "probe runs once before addResource (for repository) is rejected",
    );
  });

  test("a 'branch not found' detail passes through unchanged — setup does not parse or rewrite 014's detail", async () => {
    const { deps, fakes } = makeDeps({
      repositoryProbeResult: {
        status: "failed",
        detail: 'branch "nope" not found on remote',
      },
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) =>
        l.includes('branch "nope" not found on remote'),
      ),
      `stderr must carry the branch-missing detail verbatim; got: ${result.stderr.join("\n")}`,
    );
  });

  test("probe receives the auth value deep-equal to { kind: 'https-token', credentialId: <credential step id> }, and no timeoutMs key", async () => {
    const { deps, fakes } = makeDeps();
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(
      result.exitCode,
      0,
      `expected exit 0; stderr: ${result.stderr.join("\n")}`,
    );
    assert.equal(fakes.repositoryProbe.calls.length, 1);
    const probeInput = fakes.repositoryProbe.calls[0]!;
    assert.equal(
      Object.prototype.hasOwnProperty.call(probeInput, "timeoutMs"),
      false,
    );
    assert.deepEqual(probeInput["auth"], {
      kind: "https-token",
      credentialId: NEW_CRED_ID,
    });
  });

  test("with auth=ambient the probe receives { kind: 'ambient' } and no credential call is made", async () => {
    const { deps, fakes } = makeDeps({
      answersText: fullAnswersText({ auth: "ambient" }),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0);
    assert.equal(fakes.repositoryProbe.calls.length, 1);
    assert.deepEqual(fakes.repositoryProbe.calls[0]!["auth"], {
      kind: "ambient",
    });
    const credCall = fakes.addResource.calls.find(
      (c) => c["type"] === "credential",
    );
    assert.equal(credCall, undefined, "no credential call when auth=ambient");
  });
});

// ─── repository auth + path ─────────────────────────────────────────────────

describe("runSetup — repository step", () => {
  test("addResource receives the absolute answers path verbatim", async () => {
    const { deps, fakes } = makeDeps();
    await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    const repoCall = fakes.addResource.calls.find(
      (c) => c["type"] === "repository",
    )!;
    assert.equal(
      repoCall["path"],
      "/srv/mirror",
      "absolute path is forwarded verbatim",
    );
    assert.equal(
      String(repoCall["path"]).startsWith("/"),
      true,
      "the path forwarded to addResource must be absolute",
    );
  });

  test("an https-token run calls addResource with auth = { kind: 'https-token', credentialId: <step id> }", async () => {
    const { deps, fakes } = makeDeps();
    await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    const repoCall = fakes.addResource.calls.find(
      (c) => c["type"] === "repository",
    )!;
    assert.deepEqual(repoCall["auth"], {
      kind: "https-token",
      credentialId: NEW_CRED_ID,
    });
  });

  test("an ambient run passes auth = { kind: 'ambient' }, no credential call, and the plan's credential slot is undefined (verified by zero addResource calls for type=credential)", async () => {
    const { deps, fakes } = makeDeps({
      answersText: fullAnswersText({ auth: "ambient" }),
    });
    await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    const repoCall = fakes.addResource.calls.find(
      (c) => c["type"] === "repository",
    )!;
    assert.deepEqual(repoCall["auth"], { kind: "ambient" });
    const credCall = fakes.addResource.calls.find(
      (c) => c["type"] === "credential",
    );
    assert.equal(
      credCall,
      undefined,
      "no credential call when auth is ambient",
    );
  });
});

// ─── provider verification ──────────────────────────────────────────────────

describe("runSetup — provider verification on create", () => {
  test("providerProbe.execute is called exactly once with the newly registered provider id; setup passes no prompt", async () => {
    const { deps, fakes } = makeDeps();
    await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(fakes.providerProbe.calls.length, 1);
    assert.deepEqual(fakes.providerProbe.calls, [NEW_AIP_ID]);
  });

  test("verification passes on status:'ok' → exit 0 and the provider line ends with ' — verified'", async () => {
    const { deps } = makeDeps({
      providerProbeResult: {
        resourceId: NEW_AIP_ID,
        status: "ok",
        detail: "provider answered the probe prompt",
      },
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(result.exitCode, 0);
    const providerLine = result.stdout.find((l) => l.startsWith("provider:"));
    assert.ok(
      providerLine,
      `must have a provider line; got: ${result.stdout.join("\n")}`,
    );
    assert.ok(
      providerLine!.endsWith("— verified"),
      `provider line must end with '— verified'; got: ${providerLine}`,
    );
  });

  test("verification failure → exit 1, stderr matches /registered but unverified/, first stderr line contains the failure detail verbatim, provider line still on stdout", async () => {
    const { deps } = makeDeps({
      providerProbeResult: {
        resourceId: NEW_AIP_ID,
        status: "failed",
        detail: "401 unauthorized",
      },
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => /registered but unverified/.test(l)),
      `stderr must mention 'registered but unverified'; got: ${result.stderr.join("\n")}`,
    );
    assert.ok(
      result.stderr[0]!.includes("401 unauthorized"),
      `first stderr line must carry the redacted detail verbatim; got: ${result.stderr[0]}`,
    );
    const providerLine = result.stdout.find((l) => l.startsWith("provider:"));
    assert.ok(providerLine, "provider line must still be on stdout");
  });

  test("a 'failed' detail that already contains [redacted] reaches stderr byte-identical (no re-redaction)", async () => {
    const { deps } = makeDeps({
      providerProbeResult: {
        resourceId: NEW_AIP_ID,
        status: "failed",
        detail: "the key [redacted] is no longer valid",
      },
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => l.includes("[redacted]")),
      `stderr must carry the redaction marker byte-identical; got: ${result.stderr.join("\n")}`,
    );
  });

  test("verification does not re-run on a no-op rerun", async () => {
    const { deps, fakes } = makeDeps({ facts: factsWithEverything() });
    await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(fakes.providerProbe.calls.length, 0);
  });

  test("a logged-out equivalent provider triggers re-register and re-verify (reactivation)", async () => {
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything({
        providersByName: [
          {
            id: AIP_ID,
            name: "e2e",
            provider: "openai-codex",
            model: "gpt-5.6-sol",
            baseUrl: null,
            api: null,
            state: "logged_out",
            assignedToProject: true,
          },
        ],
      }),
    });
    await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(
      fakes.registerAiProvider.calls.length,
      1,
      "re-register on logged_out",
    );
    assert.equal(
      fakes.providerProbe.calls.length,
      1,
      "re-verify on logged_out",
    );
  });
});

// ─── oauth route ────────────────────────────────────────────────────────────

describe("runSetup — oauth route", () => {
  test("loginProvider.execute is called once with the answers' method and model; registerAiProvider and providerProbe are NOT called; no presenter string leaks to stdout/stderr", async () => {
    const { deps, fakes } = makeDeps({
      answersText: fullAnswersText({ providerRoute: "oauth" }),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(
      result.exitCode,
      0,
      `expected exit 0; stderr: ${result.stderr.join("\n")}`,
    );
    assert.equal(fakes.loginProvider.calls.length, 1);
    assert.equal(fakes.loginProvider.calls[0]!["method"], "browser");
    assert.equal(fakes.loginProvider.calls[0]!["model"], "gpt-5.6-sol");
    assert.equal(
      fakes.registerAiProvider.calls.length,
      0,
      "no registerAiProvider for oauth",
    );
    assert.equal(
      fakes.providerProbe.calls.length,
      0,
      "no providerProbe for oauth",
    );

    const allOut = [...result.stdout, ...result.stderr].join("\n");
    for (const leak of fakes.loginProvider.presenterStrings) {
      assert.ok(
        !allOut.includes(leak),
        `presenter output '${leak}' must NOT reach stdout or stderr; got: ${allOut}`,
      );
    }
  });
});

// ─── custom route ───────────────────────────────────────────────────────────

describe("runSetup — custom route", () => {
  test("registerAiProvider receives api, baseUrl and customProviderId === answers.provider.provider", async () => {
    const { deps, fakes } = makeDeps({
      answersText: fullAnswersText({
        providerRoute: "custom",
        baseUrl: "https://api.example/v1",
        api: "openai-responses",
      }),
    });
    await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(fakes.registerAiProvider.calls.length, 1);
    const call = fakes.registerAiProvider.calls[0]!;
    assert.equal(call["api"], "openai-responses");
    assert.equal(call["baseUrl"], "https://api.example/v1");
    assert.equal(call["customProviderId"], "openai-codex");
  });
});

// ─── assignment only when needed ───────────────────────────────────────────

describe("runSetup — provider assignment only when needed", () => {
  test("equivalent active provider that is not assigned → assignAiProvider called once, registerAiProvider = 0, providerProbe = 0", async () => {
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything({
        providersByName: [
          {
            id: AIP_ID,
            name: "e2e",
            provider: "openai-codex",
            model: "gpt-5.6-sol",
            baseUrl: null,
            api: null,
            state: "active",
            assignedToProject: false, // equivalent but not assigned
          },
        ],
      }),
    });
    await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(fakes.registerAiProvider.calls.length, 0);
    assert.equal(fakes.assignAiProvider.calls.length, 1);
    assert.equal(fakes.providerProbe.calls.length, 0);
  });
});

// ─── graph skip ─────────────────────────────────────────────────────────────

describe("runSetup — graph step", () => {
  test("graph.skip=true → readGraphPackage call count 0, createGraph call count 0, line 'graph: already satisfied (graph.skip=true)'", async () => {
    const { deps, fakes } = makeDeps({
      answersText: fullAnswersText({ graphSkip: true }),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(
      result.exitCode,
      0,
      `expected exit 0; stderr: ${result.stderr.join("\n")}`,
    );
    assert.equal(fakes.readGraphPackage.calls.length, 0);
    assert.equal(fakes.createGraph.calls.length, 0);
    assert.ok(
      result.stdout.some(
        (l) => l === "graph: already satisfied (graph.skip=true)",
      ),
      `stdout must contain 'graph: already satisfied (graph.skip=true)'; got: ${result.stdout.join("\n")}`,
    );
  });

  test("a rejecting readGraphPackage → exit 1, stderr matches /cannot read package directory/, earlier steps applied (lines on stdout, write fakes called)", async () => {
    const enoent = Object.assign(new Error("ENOENT: no such file"), {
      code: "ENOENT",
    });
    const { deps, fakes } = makeDeps({ graphThrows: enoent });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => /cannot read package directory/.test(l)),
      `stderr must match /cannot read package directory/; got: ${result.stderr.join("\n")}`,
    );
    // Earlier steps applied — the credential step AND the repository
    // step both call addResource (the repository call is the one that
    // gates on the probe, so the probe runs and then the readGraphPackage
    // rejection fires). The addResource count is therefore 2.
    assert.equal(fakes.createProject.calls.length, 1);
    assert.equal(fakes.addResource.calls.length, 2);
    assert.equal(fakes.registerAiProvider.calls.length, 1);
    assert.equal(fakes.assignAiProvider.calls.length, 1);
    assert.equal(
      fakes.createGraph.calls.length,
      0,
      "createGraph must NOT be called when read fails",
    );
    // The four earlier step lines must be on stdout
    const stepHeads = ["project:", "credential:", "repository:", "provider:"];
    for (const head of stepHeads) {
      assert.ok(
        result.stdout.some((l) => l.startsWith(head)),
        `stdout must contain a '${head}' line; got: ${result.stdout.join("\n")}`,
      );
    }
  });

  test("RunSetupDeps has no write function: the fake readGraphPackage returns a frozen package and the test asserts the structural guarantee", async () => {
    const { deps, fakes } = makeDeps({
      // The default happy graph package, frozen on read.
      graphPkg: happyGraphPkg(),
    });
    // The structural assertion: enumerate the keys the module actually
    // depends on by introspecting the deps object. Anything not here cannot
    // be called.
    fakes.readGraphPackage.freeze = true;
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(result.exitCode, 0);
    // The frozen object identity is exactly the one we returned — no
    // substitution happened. (The test does not assert Object.isFrozen on
    // every nested value because runSetup only reads fields, but the
    // test of "no write function" is the structural `Object.keys(deps)`
    // check below.)
    const providedKeys = Object.keys(deps);
    // The structural guarantee: the deps bundle does not carry a
    // "write" / "mutate" / "persist" / "save" function the orchestrator
    // can call. `createProject` and `createGraph` are use-case names,
    // not writer keys, so the regex must match a writer only when the
    // key starts with `write`/`mutate`/`persist`/`save` (or is exactly
    // one of those).
    assert.ok(
      !providedKeys.some((k) =>
        /^(write|mutate|persist|save)($|[A-Z_])/.test(k),
      ),
      `RunSetupDeps must not carry a writer; got: ${providedKeys.join(",")}`,
    );
  });

  test("createGraph receives bindings deep-equal { source: <resolved repository id> } and packageId equal to the newId() return", async () => {
    const { deps, fakes } = makeDeps();
    // In production, `addResource`'s repository write is awaited (and thus
    // committed) before the graph step runs, so the real `findResourcesByName`
    // / `getResource` already see this same run's own write — no bridge is
    // needed. Pre-populate the fake with the id `addResource` will mint for
    // the repository step (NEW_REPO_ID, under the project id `createProject`
    // will mint, NEW_PROJECT_ID) to mirror that, and run `runSetup` once.
    fakes.findResourcesByName.set(`${NEW_PROJECT_ID}|home|repository`, [
      { id: NEW_REPO_ID },
    ]);
    fakes.getResource.set(NEW_REPO_ID, { type: "repository" });

    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(
      result.exitCode,
      0,
      `expected exit 0; stderr: ${result.stderr.join("\n")}`,
    );
    assert.equal(fakes.createGraph.calls.length, 1);
    const call = fakes.createGraph.calls[0]!;
    assert.deepEqual(call.bindings, { source: NEW_REPO_ID });
    assert.equal(call.packageId, NEW_PKG_ID);
  });

  test("graph drift (initiative name mismatch) → exit 1, stderr contains 'graph.packagePath', createGraph call count 0", async () => {
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything({
        // Project already has an initiative named "Other" — package declares "TODO application API"
        // (the default fixture's name), so the graph step must drift.
        initiatives: [{ id: INIT_ID, name: "Other" }],
      }),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.some((l) => /graph\.packagePath/.test(l)),
      `stderr must contain 'graph.packagePath'; got: ${result.stderr.join("\n")}`,
    );
    assert.equal(fakes.createGraph.calls.length, 0);
  });
});

// ─── no secret anywhere ─────────────────────────────────────────────────────

describe("runSetup — secret hygiene", () => {
  test("JSON.stringify(result) does NOT contain the secret value in the happy run", async () => {
    const { deps } = makeDeps();
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(
      JSON.stringify(result).includes("super-secret-value"),
      false,
      `result must not contain the secret; got: ${JSON.stringify(result)}`,
    );
  });

  test("JSON.stringify(result) does NOT contain the secret when the provider verification rejects with a message embedding the secret", async () => {
    const { deps } = makeDeps({
      providerProbeResult: {
        resourceId: NEW_AIP_ID,
        status: "failed",
        detail: "rejected: super-secret-value is not valid",
      },
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(
      JSON.stringify(result).includes("super-secret-value"),
      false,
      `result must not echo the secret; got: ${JSON.stringify(result)}`,
    );
  });

  test("JSON.stringify(result) does NOT contain the secret when the repository probe fails", async () => {
    const { deps } = makeDeps({
      repositoryProbeResult: {
        status: "failed",
        detail: "auth using super-secret-value failed",
      },
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(
      JSON.stringify(result).includes("super-secret-value"),
      false,
      `result must not echo the secret; got: ${JSON.stringify(result)}`,
    );
  });

  test("JSON.stringify(result) does NOT contain the secret when the graph step fails", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const { deps } = makeDeps({ graphThrows: enoent });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(
      JSON.stringify(result).includes("super-secret-value"),
      false,
      `result must not echo the secret; got: ${JSON.stringify(result)}`,
    );
  });
});

// ─── no events, no daemon ───────────────────────────────────────────────────

describe("runSetup — starts no daemon, writes no events", () => {
  test("RunSetupDeps has no buildDaemon key and no event-writer key", async () => {
    const { deps } = makeDeps();
    const providedKeys = Object.keys(deps);
    assert.ok(
      !providedKeys.includes("buildDaemon"),
      `RunSetupDeps must not carry a 'buildDaemon' key; got: ${providedKeys.join(",")}`,
    );
    for (const k of providedKeys) {
      assert.ok(
        !/event|publish|append/i.test(k),
        `RunSetupDeps must not carry an event-writer key '${k}'`,
      );
    }
  });

  test("runSetup accepts a deps bundle without buildDaemon, runs the happy path, and exits 0", async () => {
    const { deps } = makeDeps();
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );
    assert.equal(
      result.exitCode,
      0,
      `expected exit 0; stderr: ${result.stderr.join("\n")}`,
    );
  });
});

// ─── review blocker R-B1: a throwing use case must never escape runSetup ────
//
// Story 4 (04-step-execution.md:283-284, :136-138): "Return HandlerResult;
// never throw" and "On any step failure, return exitCode: 1 immediately
// with the lines produced so far on stdout and the failure on stderr". Every
// step below is made to throw with a real, `toResult`-mapped error and the
// test asserts the call resolves (never rejects), `exitCode: 1`, every
// earlier step's stdout line is still present, and the mapped
// `error: <message>` line lands on stderr.

describe("runSetup — a throwing use case per step maps to exitCode 1, never escapes as a rejection", () => {
  test("createProject throws → exitCode 1, stderr carries the mapped error, stdout empty (no earlier step)", async () => {
    const { deps, fakes } = makeDeps();
    fakes.createProject.throwWith = new DuplicateNameError(
      "project",
      "global",
      "demo",
    );

    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.stdout, []);
    assert.ok(
      result.stderr.some(
        (l) => l === `error: ${fakes.createProject.throwWith!.message}`,
      ),
      `stderr must carry the mapped error; got: ${result.stderr.join("\n")}`,
    );
  });

  test("addResource throws on the credential step → exitCode 1, the 'project:' line survives on stdout, mapped error on stderr", async () => {
    const { deps, fakes } = makeDeps();
    fakes.addResource.throwWith = new DuplicateNameError(
      "credential",
      "project",
      "gh",
    );

    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stdout.some((l) => l.startsWith("project:")),
      `the already-committed 'project:' line must survive; got: ${result.stdout.join("\n")}`,
    );
    assert.ok(
      result.stdout.every((l) => !l.startsWith("credential:")),
      `no 'credential:' line should appear when the step itself throws`,
    );
    assert.ok(
      result.stderr.some(
        (l) => l === `error: ${fakes.addResource.throwWith!.message}`,
      ),
      `stderr must carry the mapped error; got: ${result.stderr.join("\n")}`,
    );
  });

  test("addResource throws on the repository step → exitCode 1, 'project:' and 'credential:' lines survive on stdout, mapped error on stderr", async () => {
    // Credential is observed already (skip), so the first and only
    // `addResource` call this run makes is the repository one.
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything({
        repositoriesByName: [],
        providersByName: [],
        initiatives: [],
      }),
    });
    fakes.addResource.throwWith = new DuplicateNameError(
      "repository",
      "project",
      "home",
    );

    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.some((l) => l.startsWith("project:")));
    assert.ok(result.stdout.some((l) => l.startsWith("credential:")));
    assert.ok(
      result.stdout.every((l) => !l.startsWith("repository:")),
      `no 'repository:' line should appear when the step itself throws`,
    );
    assert.ok(
      result.stderr.some(
        (l) => l === `error: ${fakes.addResource.throwWith!.message}`,
      ),
      `stderr must carry the mapped error; got: ${result.stderr.join("\n")}`,
    );
  });

  test("registerAiProvider throws (apiKey route) → exitCode 1, project/credential/repository lines survive, mapped UnknownModelError on stderr", async () => {
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything({ providersByName: [], initiatives: [] }),
    });
    fakes.registerAiProvider.throwWith = new UnknownModelError(
      "openai-codex",
      "not-a-real-model",
    );

    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.some((l) => l.startsWith("project:")));
    assert.ok(result.stdout.some((l) => l.startsWith("credential:")));
    assert.ok(result.stdout.some((l) => l.startsWith("repository:")));
    assert.ok(
      result.stdout.every((l) => !l.startsWith("provider:")),
      `no 'provider:' line should appear when registration itself throws`,
    );
    assert.ok(
      result.stderr.some(
        (l) => l === `error: ${fakes.registerAiProvider.throwWith!.message}`,
      ),
      `stderr must carry the mapped error; got: ${result.stderr.join("\n")}`,
    );
  });

  test("login.loginProvider throws (oauth route) → exitCode 1, mapped NonOAuthProviderError on stderr, no unhandled rejection", async () => {
    const { deps, fakes } = makeDeps({
      answersText: fullAnswersText({ providerRoute: "oauth" }),
      facts: factsWithEverything({ providersByName: [], initiatives: [] }),
    });
    fakes.loginProvider.throwWith = new NonOAuthProviderError("openai-codex");

    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.some((l) => l.startsWith("project:")));
    assert.ok(result.stdout.some((l) => l.startsWith("credential:")));
    assert.ok(result.stdout.some((l) => l.startsWith("repository:")));
    assert.ok(result.stdout.every((l) => !l.startsWith("provider:")));
    assert.ok(
      result.stderr.some(
        (l) => l === `error: ${fakes.loginProvider.throwWith!.message}`,
      ),
      `stderr must carry the mapped error; got: ${result.stderr.join("\n")}`,
    );
  });

  test("assignAiProvider throws → exitCode 1, mapped DuplicateAssignmentError on stderr, no 'provider:' line yet", async () => {
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything({ providersByName: [], initiatives: [] }),
    });
    fakes.assignAiProvider.throwWith = new DuplicateAssignmentError(
      PROJ_ID,
      NEW_AIP_ID,
    );

    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.some((l) => l.startsWith("project:")));
    assert.ok(result.stdout.some((l) => l.startsWith("credential:")));
    assert.ok(result.stdout.some((l) => l.startsWith("repository:")));
    assert.ok(
      result.stdout.every((l) => !l.startsWith("provider:")),
      `no 'provider:' line should appear when assignment itself throws`,
    );
    assert.ok(
      result.stderr.some(
        (l) => l === `error: ${fakes.assignAiProvider.throwWith!.message}`,
      ),
      `stderr must carry the mapped error; got: ${result.stderr.join("\n")}`,
    );
    // registerAiProvider must have already run and committed (the provider
    // is registered even though the assignment step is what failed).
    assert.equal(fakes.registerAiProvider.calls.length, 1);
  });

  test("createGraph throws → exitCode 1, all four earlier step lines survive, mapped ImportValidationError on stderr", async () => {
    const { deps, fakes } = makeDeps({
      facts: factsWithEverything({ initiatives: [] }),
    });
    // The repository this run reuses (REPO_ID, under PROJ_ID) must already
    // resolve through the bare `findResourcesByName`/`getResource` lookup —
    // production commits `addResource` before the graph step, and here the
    // repository step is a `skip` (already observed), so nothing populates
    // the fake automatically.
    fakes.findResourcesByName.set(`${PROJ_ID}|home|repository`, [
      { id: REPO_ID },
    ]);
    fakes.getResource.set(REPO_ID, { type: "repository" });
    fakes.createGraph.throwWith = new ImportValidationError(
      0,
      "todo",
      "bad entry",
    );

    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 1);
    for (const head of [
      "project:",
      "credential:",
      "repository:",
      "provider:",
    ]) {
      assert.ok(
        result.stdout.some((l) => l.startsWith(head)),
        `stdout must contain a '${head}' line; got: ${result.stdout.join("\n")}`,
      );
    }
    assert.ok(
      result.stdout.every((l) => !l.startsWith("graph:")),
      `no 'graph:' line should appear when createGraph itself throws`,
    );
    assert.ok(
      result.stderr.some(
        (l) => l === `error: ${fakes.createGraph.throwWith!.message}`,
      ),
      `stderr must carry the mapped error; got: ${result.stderr.join("\n")}`,
    );
  });
});

// ─── AUTO_REVIEW F-B1 — a PLAIN, UNMAPPED throw inside a guarded step still
// escapes via `stepFailure` ──────────────────────────────────────────────────
//
// Every R-B1 test above throws a `toResult`-MAPPED domain error (e.g.
// `DuplicateNameError`), which is exactly why the real gap survived: per
// `error-map.ts:152`, `toResult` RETHROWS any error not in its `instanceof`
// list. `stepFailure` (run-setup.ts) calls `toResult(err)` bare, with no
// fallback, so a step that throws a plain infrastructure `Error` (e.g. the
// human's real repro: a missing `provider.valueFile` throwing a raw ENOENT
// deeper inside a step) still re-escapes `runSetup` as an unhandled
// rejection.

describe("runSetup — AUTO_REVIEW F-B1: a plain, unmapped Error thrown inside a guarded step must not escape", () => {
  test("addResource throws a plain unmapped Error on the credential step → runSetup resolves (never rejects), exitCode 1, earlier stdout kept, one mapped error line, no stack trace", async () => {
    const { deps, fakes } = makeDeps();
    fakes.addResource.throwWith = new Error("boom");

    let result:
      { exitCode: number; stdout: string[]; stderr: string[] } | undefined;
    await assert.doesNotReject(async () => {
      result = await runSetup(
        { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
        deps,
      );
    }, "runSetup must return a HandlerResult, not throw/reject, when a step throws a plain unmapped Error");

    assert.ok(result !== undefined);
    assert.equal(result!.exitCode, 1);
    assert.ok(
      result!.stdout.some((l) => l.startsWith("project:")),
      `the already-committed 'project:' line must survive; got: ${result!.stdout.join("\n")}`,
    );
    assert.ok(
      result!.stdout.every((l) => !l.startsWith("credential:")),
      `no 'credential:' line should appear when the step itself throws`,
    );
    assert.deepEqual(
      result!.stderr,
      ["error: boom"],
      `stderr must be exactly one mapped line, no stack trace; got: ${result!.stderr.join("\n")}`,
    );
    assert.ok(
      result!.stderr.every(
        (l) => !l.includes("at ") && !l.includes("Node.js v"),
      ),
      `stderr must never carry a raw stack trace or Node.js version trailer; got: ${result!.stderr.join("\n")}`,
    );
  });
});

// ─── AUTO_REVIEW F-B2 — the credential secret read sits OUTSIDE the step's
// try, so a rejecting `readSecretFile` escapes unguarded ──────────────────

describe("runSetup — AUTO_REVIEW F-B2: a rejecting readSecretFile on the credential step must not escape", () => {
  test("readSecretFile rejects (ENOENT-shaped) → runSetup resolves (never rejects), exitCode 1, 'project:' line kept, one mapped error line, no credential write attempted", async () => {
    const { deps, fakes } = makeDeps();
    const enoent = Object.assign(
      new Error("ENOENT: no such file or directory, open '/srv/token'"),
      { code: "ENOENT" },
    );
    fakes.readSecretFile.throwWith = enoent;

    let result:
      { exitCode: number; stdout: string[]; stderr: string[] } | undefined;
    await assert.doesNotReject(async () => {
      result = await runSetup(
        { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
        deps,
      );
    }, "runSetup must return a HandlerResult, not throw/reject, when readSecretFile rejects on the credential step");

    assert.ok(result !== undefined);
    assert.equal(result!.exitCode, 1);
    assert.ok(
      result!.stdout.some((l) => l.startsWith("project:")),
      `the already-committed 'project:' line must survive; got: ${result!.stdout.join("\n")}`,
    );
    assert.ok(
      result!.stdout.every((l) => !l.startsWith("credential:")),
      `no 'credential:' line should appear when readSecretFile itself rejects`,
    );
    assert.equal(
      fakes.addResource.calls.length,
      0,
      "addResource must never be called when the secret read that feeds it rejects first",
    );
    assert.equal(
      result!.stderr.length,
      1,
      `stderr must carry exactly one mapped line; got: ${result!.stderr.join("\n")}`,
    );
    assert.ok(
      result!.stderr.every(
        (l) => !l.includes("at ") && !l.includes("Node.js v"),
      ),
      `stderr must never carry a raw stack trace or Node.js version trailer; got: ${result!.stderr.join("\n")}`,
    );
  });
});

// ─── HUMAN_REVIEW H-B1 — the two use-case calls outside the step loop ───────
//
// Story 4 (`04-step-execution.md:283-284`): "Return HandlerResult; never
// throw" is a whole-orchestrator contract, not just the five numbered
// steps. `deps.observeSetupFacts.execute` (run-setup.ts:378) sits between
// the answers parse and the plan, with NO try/catch — a throw there
// (e.g. a repository lookup against an unmigrated database, reproduced by
// the human against the real CLI: "Error: no such table: projects ... at
// runSetup (run-setup.ts:378:40)" followed by a raw Node stack trace and
// process exit) escapes `runSetup` as an unhandled rejection instead of
// resolving with `{ exitCode: 1, ... }`.

describe("runSetup — HUMAN_REVIEW H-B1: the two use-case calls outside the step loop never let a throw escape", () => {
  test("observeSetupFacts throws → runSetup resolves (never rejects) with exitCode 1, empty stdout, and no stack trace on stderr", async () => {
    const { deps, fakes } = makeDeps();
    fakes.observeSetupFacts.throwWith = new Error("no such table: projects");

    let result:
      { exitCode: number; stdout: string[]; stderr: string[] } | undefined;
    await assert.doesNotReject(async () => {
      result = await runSetup(
        { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
        deps,
      );
    }, "runSetup must return a HandlerResult, not throw/reject, when observeSetupFacts throws");

    assert.ok(result !== undefined);
    assert.equal(result!.exitCode, 1);
    assert.deepEqual(
      result!.stdout,
      [],
      "no step has run yet, so stdout must be empty",
    );
    assert.ok(
      result!.stderr.every((l) => !l.includes("at ") && !l.includes("\n")),
      `stderr must never carry a raw stack trace; got: ${result!.stderr.join("\n")}`,
    );
    assert.ok(
      result!.stderr.some((l) => l === "error: no such table: projects"),
      `stderr must carry the mapped error; got: ${result!.stderr.join("\n")}`,
    );
  });

  test("checkProject throws (the closing readiness check) → the already-produced step lines survive on stdout", async () => {
    const { deps } = makeDeps({
      checkProjectReport: new Error("readiness probe exploded"),
    });

    let result:
      { exitCode: number; stdout: string[]; stderr: string[] } | undefined;
    await assert.doesNotReject(async () => {
      result = await runSetup(
        { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
        deps,
      );
    }, "runSetup must return a HandlerResult, not throw/reject, when checkProject throws");

    assert.ok(result !== undefined);
    for (const head of [
      "project:",
      "credential:",
      "repository:",
      "provider:",
      "graph:",
    ]) {
      assert.ok(
        result!.stdout.some((l) => l.startsWith(head)),
        `the already-produced '${head}' line must survive; got: ${result!.stdout.join("\n")}`,
      );
    }
    assert.ok(
      result!.stderr.every((l) => !l.includes("at ") && !l.includes("\n")),
      `stderr must never carry a raw stack trace; got: ${result!.stderr.join("\n")}`,
    );
  });
});

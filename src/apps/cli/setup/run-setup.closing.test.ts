// src/apps/cli/setup/run-setup.closing.test.ts — EPIC 015 Story 5
// Hermetic, in-process tests for the closing output of `runSetup`:
// the four-line block (project id / readiness / state / next) that the
// wizard appends after the graph step succeeds. The contract is
// the EPIC's "two terminal successes" claim:
//   - `configured-with-work` when a graph was imported (or matched)
//   - `configured-no-work` otherwise; the next line names `import graph`

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runSetup } from "./run-setup.ts";
import type { ObservedFacts } from "../../../app/project/setup-plan.ts";
import type { GraphPackage } from "../../../app/graph/graph-package.ts";
import type { ReadinessReport } from "../../../app/project/project-readiness.ts";
import type { CheckProjectInput } from "../../../app/project/check-project.ts";
import type { RunSetupDeps } from "./run-setup.ts";

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

// ─── Fake use cases ─────────────────────────────────────────────────────────

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
   * resource. Set by `makeClosingDeps()` after both fakes exist.
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
  defaultText: string | undefined;
  async readTextFile(): Promise<string> {
    if (this.defaultText === undefined) throw new Error("no default");
    return this.defaultText;
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
  set(key: string, ids: Array<{ id: string }>): void {
    this.map.set(key, ids);
  }
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
  set(id: string, r: { type: string }): void {
    this.map.set(id, r);
  }
  async getResource(id: string): Promise<{ type: string } | undefined> {
    return this.map.get(id);
  }
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const emptyFacts: ObservedFacts = {
  projectsByName: [],
  credentialsByName: [],
  repositoriesByName: [],
  providersByName: [],
  initiatives: [],
};

function happyGraphPkg(name: string = "TODO application API"): GraphPackage {
  return {
    packageId: NEW_PKG_ID,
    formatVersion: 1,
    initiative: {
      ref: "todo",
      name,
      sourcePath: "todo.md",
      bindings: { source: "repository" },
    },
    objectives: [],
    tasks: [],
  };
}

const fullAnswersText = (overrides: { graphSkip?: boolean } = {}): string => {
  const lines = [
    "project.name=demo",
    "repository.name=home",
    "repository.remoteUrl=file:///srv/home.git",
    "repository.branch=main",
    "repository.path=/srv/mirror",
    "repository.auth=https-token",
    "credential.name=gh",
    "credential.provider=github",
    "credential.valueFile=/srv/token",
    "provider.route=apiKey",
    "provider.name=e2e",
    "provider.provider=openai-codex",
    "provider.model=gpt-5.6-sol",
    "provider.valueFile=/srv/pkey",
    "provider.confirmCost=true",
  ];
  if (overrides.graphSkip ?? false) {
    lines.push("graph.skip=true");
  } else {
    lines.push("graph.packagePath=/srv/g", "graph.bind.source=home");
  }
  return lines.join("\n") + "\n";
};

const ANSWERS_PATH = "/tmp/answers";

function makeClosingDeps(
  opts: {
    facts?: ObservedFacts;
    answersText?: string;
    graphPkg?: GraphPackage;
    checkProjectReport?: ReadinessReport;
    checkProjectThrows?: Error;
    providersByName?: ObservedFacts["providersByName"];
  } = {},
) {
  const addResource = new FakeAddResource();
  const createProject = new FakeCreateProject();
  const registerAiProvider = new FakeRegisterAiProvider();
  const assignAiProvider = new FakeAssignAiProvider();
  const loginProvider = new FakeLoginProvider();
  const createGraph = new FakeCreateGraph();
  const checkProject = new FakeCheckProject();
  if (opts.checkProjectReport !== undefined)
    checkProject.report = opts.checkProjectReport;
  const repositoryProbe = new FakeRepositoryProbe();
  const providerProbe = new FakeProviderProbe();
  const readTextFile = new FakeReadTextFile();
  readTextFile.defaultText = opts.answersText ?? fullAnswersText();
  const readSecretFile = new FakeReadSecretFile();
  readSecretFile.defaultValue = "super-secret-value";
  const readGraphPackage = new FakeReadGraphPackage(
    opts.graphPkg ?? happyGraphPkg(),
  );
  const findResourcesByName = new FakeFindResourcesByName();
  const getResource = new FakeGetResource();
  // Mirrors production: `addResource`'s write is committed before the graph
  // step runs, so the real (bare, un-bridged) `findResourcesByName`/
  // `getResource` already resolves a resource this same run just created.
  addResource.onCreated = (input, id) => {
    findResourcesByName.set(
      `${input["projectId"]}|${input["name"]}|${input["type"]}`,
      [{ id }],
    );
    getResource.set(id, { type: input["type"] as string });
  };

  const facts: ObservedFacts = opts.facts ?? {
    ...emptyFacts,
    projectsByName: [{ id: PROJ_ID, name: "demo" }],
    providersByName: opts.providersByName ?? [
      {
        id: AIP_ID,
        name: "e2e",
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        baseUrl: null,
        api: null,
        state: "logged_out",
        assignedToProject: false,
      },
    ],
  };
  const observeSetupFacts = new FakeObserveSetupFacts(facts);

  const deps: RunSetupDeps = {
    observeSetupFacts,
    createProject,
    addResource,
    registerAiProvider,
    assignAiProvider,
    login: { loginProvider, io: { print: () => {}, prompt: async () => "" } },
    createGraph,
    checkProject: {
      execute: async (input: CheckProjectInput) => {
        if (opts.checkProjectThrows) throw opts.checkProjectThrows;
        checkProject.calls.push(input);
        return checkProject.report;
      },
    },
    repositoryProbe,
    providerProbe,
    newId: () => NEW_PKG_ID,
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
      checkProject,
      addResource,
      createGraph,
      createProject,
      readGraphPackage,
    },
  };
}

// ─── with-work: configured-with-work, next is run daemon ───────────────────

describe("runSetup closing — with-work", () => {
  test("with-work: stdout ends with project id, readiness, state, next (configured-with-work → run daemon)", async () => {
    const { deps } = makeClosingDeps();
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    const out = result.stdout.join("\n");
    assert.match(out, /project id: \S+/, "project id line must appear");
    assert.match(
      out,
      /readiness: configured=true verified=null operational=true ready=true/,
      `readiness line must carry the four booleans; got: ${out}`,
    );
    assert.match(
      out,
      /state: configured-with-work/,
      "state line must say configured-with-work",
    );
    assert.match(
      out,
      /next: kanthord run daemon/,
      "next line must say `kanthord run daemon`",
    );
  });

  test("with-work where the graph step was a name-matching skip still reports configured-with-work", async () => {
    // The project's initiative matches the package's initiative name → skip.
    const facts: ObservedFacts = {
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
    };
    const { deps } = makeClosingDeps({ facts });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    assert.match(
      result.stdout.join("\n"),
      /state: configured-with-work/,
      `state must say configured-with-work on a name-matching skip; got: ${result.stdout.join("\n")}`,
    );
  });

  test("a rerun with graph.skip=true on a project that already has an initiative reports configured-with-work, not configured-no-work", async () => {
    // Every step is a `skip` (project/credential/repository/provider all
    // already exist and match) and the user explicitly passed
    // `graph.skip=true` this run — but the project already has an
    // initiative from a PRIOR run. `withWork` must be derived from the
    // observed state (facts.initiatives), not from `!answers.graph.skip`,
    // or the wizard falsely tells the user there is no work when work
    // already exists.
    const facts: ObservedFacts = {
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
    };
    const { deps } = makeClosingDeps({
      facts,
      answersText: fullAnswersText({ graphSkip: true }),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    assert.match(
      result.stdout.join("\n"),
      /state: configured-with-work/,
      `state must say configured-with-work when the project already has an initiative, even with graph.skip=true this run; got: ${result.stdout.join("\n")}`,
    );
  });
});

// ─── no-work: configured-no-work, next is import graph ─────────────────────

describe("runSetup closing — no-work", () => {
  test("no-work (graph.skip=true, no initiatives): state: configured-no-work, next names 'import graph', no line contains 'run daemon'", async () => {
    const { deps } = makeClosingDeps({
      answersText: fullAnswersText({ graphSkip: true }),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    const allLines = [...result.stdout, ...result.stderr].join("\n");
    assert.match(
      allLines,
      /state: configured-no-work/,
      "must say configured-no-work",
    );
    assert.match(allLines, /import graph/, "next must name 'import graph'");
    assert.ok(
      !allLines.includes("run daemon"),
      `no line of stdout/stderr may contain 'run daemon' in the no-work case; got: ${allLines}`,
    );
  });

  test("a check report whose next.command and check detail name the daemon still produces no 'run daemon' line in no-work output", async () => {
    // Build a fake report that names 'kanthord run daemon' in two places.
    const report: ReadinessReport = {
      projectId: PROJ_ID,
      configured: false,
      verified: null,
      operational: false,
      ready: false,
      checks: [
        {
          name: "initiative",
          status: "missing",
          blocking: true,
          detail: "missing: run daemon cannot start without a graph",
        },
      ],
      next: {
        check: "initiative",
        action: "import a graph",
        requiresInput: [],
        command: "kanthord run daemon",
      },
    };
    const { deps } = makeClosingDeps({
      answersText: fullAnswersText({ graphSkip: true }),
      checkProjectReport: report,
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    const allLines = [...result.stdout, ...result.stderr].join("\n");
    assert.ok(
      !allLines.includes("run daemon"),
      `only the four booleans are printed; no 'run daemon' anywhere; got: ${allLines}`,
    );
  });
});

// ─── checkProject input contract ───────────────────────────────────────────

describe("runSetup closing — checkProject input contract", () => {
  test("checkProject input deep-equals { id, probeRepositories: false, probeProvider: false }; verified=null renders `verified=null`", async () => {
    const { deps, fakes } = makeClosingDeps();
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    assert.equal(fakes.checkProject.calls.length, 1);
    const call = fakes.checkProject.calls[0]!;
    assert.deepEqual(call, {
      // makeClosingDeps() pre-seeds a "demo" project (PROJ_ID) matching the
      // answers file's project.name, so planSetup resolves this as a
      // reconciliation `skip` against the observed project, not a `create`.
      id: PROJ_ID,
      probeRepositories: false,
      probeProvider: false,
    });
    // The default report has `verified: null` → must render as the string `null`.
    assert.match(
      result.stdout.join("\n"),
      /verified=null/,
      `verified=null must render; got: ${result.stdout.join("\n")}`,
    );
  });

  test("a rejecting checkProject yields 'readiness: unavailable' and exitCode 0", async () => {
    const { deps } = makeClosingDeps({
      checkProjectThrows: new Error("db locked"),
    });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
    assert.match(
      result.stdout.join("\n"),
      /readiness: unavailable/,
      `readiness must say 'unavailable' on rejection; got: ${result.stdout.join("\n")}`,
    );
  });

  test("configured: false still yields exitCode 0", async () => {
    const report: ReadinessReport = {
      projectId: PROJ_ID,
      configured: false,
      verified: null,
      operational: false,
      ready: false,
      checks: [],
      next: null,
    };
    const { deps } = makeClosingDeps({ checkProjectReport: report });
    const result = await runSetup(
      { answersPath: ANSWERS_PATH, nonInteractive: true, baseDir: "/tmp" },
      deps,
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join("\n")}`);
  });
});

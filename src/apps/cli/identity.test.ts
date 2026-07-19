/**
 * S08-T2 — Identity discipline regression.
 *
 * Table-driven: every `create *` and `find *` handler must emit exactly one
 * Crockford ULID on stdout (exit 0). All human-readable text must go to stderr.
 * This is a characterization test locking the contract across all create/find
 * handlers; it is expected to pass on first run if Stories 03–05 + S08-T1 have
 * been implemented correctly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { runCreateProject } from "./project.ts";
import { runCreateInitiative } from "./initiative.ts";
import { runCreateObjective } from "./objective.ts";
import {
  runCreateRepository,
  runCreateCredential,
  runCreateNotification,
  runCreateAiProvider,
  runCreateFilesystem,
} from "./resource.ts";
import { runCreateTask } from "./task.ts";
import {
  runFindProject,
  runFindInitiative,
  runFindObjective,
  runFindResource,
} from "./find.ts";
import type {
  ProjectRepository,
  InitiativeRepository,
  TaskRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import { CreateProject } from "../../app/project/create-project.ts";
import { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import { CreateObjective } from "../../app/objective/create-objective.ts";
import { AddResource } from "../../app/resource/add-resource.ts";
import { FakeModelCatalog } from "../../model-catalog/fake.ts";
import { CreateTask } from "../../app/task/create-task.ts";
import { FindProject } from "../../app/project/find-project.ts";
import { FindInitiative } from "../../app/initiative/find-initiative.ts";
import { FindObjective } from "../../app/objective/find-objective.ts";
import { FindResource } from "../../app/resource/find-resource.ts";

/** Strict Crockford base-32 ULID: 26 chars, no I / L / O / U. */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** A valid Crockford ULID returned by find-* fakes. */
const FOUND_ID = "01JXTEST00000000000000000P";

// Opaque scope identifiers — these are only passed through as resolver inputs.
const PROJECT_SCOPE = "proj-scope";
const INITIATIVE_SCOPE = "init-scope";
const OBJECTIVE_SCOPE = "obj-scope";

// ---------------------------------------------------------------------------
// Minimal fakes — only the methods each handler chain actually calls
// ---------------------------------------------------------------------------

/** ProjectRepository that lets create succeed (no existing resources/projects). */
const fakeProjectRepoCreate = {
  resolveProjectByName: (_name: string): string[] => [],
  resolveResourceByName: (_pid: string, _name: string): string[] => [],
  save: () => {},
  get: (_id: string) => undefined,
  addResource: () => {},
  getResource: (_id: string) => undefined,
  listResources: (_pid: string) => [],
  listProjects: () => [],
} as unknown as ProjectRepository;

/** ProjectRepository that lets find succeed — resolves to FOUND_ID. */
const fakeProjectRepoFind = {
  resolveProjectByName: (_name: string): string[] => [FOUND_ID],
  resolveResourceByName: (_pid: string, _name: string): string[] => [FOUND_ID],
} as unknown as ProjectRepository;

/** InitiativeRepository that lets create succeed (no existing initiatives/objectives). */
const fakeInitiativeRepoCreate = {
  resolveInitiativeByName: (_pid: string, _name: string): string[] => [],
  resolveObjectiveByName: (_iid: string, _name: string): string[] => [],
  save: () => {},
  saveObjective: () => {},
  get: (_id: string) => undefined,
  getObjective: (_id: string) => undefined,
  listObjectives: (_iid: string) => [],
  listInitiatives: (_pid: string) => [],
} as unknown as InitiativeRepository;

/** InitiativeRepository that lets find succeed — resolves to FOUND_ID. */
const fakeInitiativeRepoFind = {
  resolveInitiativeByName: (_pid: string, _name: string): string[] => [
    FOUND_ID,
  ],
  resolveObjectiveByName: (_iid: string, _name: string): string[] => [FOUND_ID],
} as unknown as InitiativeRepository;

/**
 * InitiativeRepository for create-task: supplies the objective and its
 * parent initiative so CreateTask can look up the projectId.
 */
const fakeInitiativeRepoForTask = {
  getObjective: (_id: string) => ({
    id: OBJECTIVE_SCOPE,
    initiativeId: INITIATIVE_SCOPE,
    name: "obj",
  }),
  get: (_id: string) => ({
    id: INITIATIVE_SCOPE,
    projectId: PROJECT_SCOPE,
    name: "init",
  }),
} as unknown as InitiativeRepository;

const fakeTaskRepo = {
  save: () => {},
  saveTaskContext: () => {},
} as unknown as TaskRepository;

const fakeProjectRepoForTask = {
  getResource: (_id: string) => undefined,
  listResources: (_pid: string) => [],
} as unknown as ProjectRepository;

const resolverForProject = {
  resolveKind: (_id: string) => "project" as const,
} as unknown as ReferenceResolver;

const resolverForInitiative = {
  resolveKind: (_id: string) => "initiative" as const,
} as unknown as ReferenceResolver;

const resolverForObjective = {
  resolveKind: (_id: string) => "objective" as const,
} as unknown as ReferenceResolver;

// ---------------------------------------------------------------------------
// Table of (label, handler invocation) pairs
// ---------------------------------------------------------------------------

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

const cases: Array<{ label: string; fn: () => Promise<HandlerResult> }> = [
  {
    label: "create project",
    fn: () =>
      runCreateProject(
        { name: "demo" },
        new CreateProject(fakeProjectRepoCreate),
      ),
  },
  {
    label: "create initiative",
    fn: () =>
      runCreateInitiative(
        { project: PROJECT_SCOPE, name: "oauth" },
        new CreateInitiative(fakeInitiativeRepoCreate, resolverForProject),
      ),
  },
  {
    label: "create objective",
    fn: () =>
      runCreateObjective(
        { initiative: INITIATIVE_SCOPE, name: "backend" },
        new CreateObjective(fakeInitiativeRepoCreate, resolverForInitiative),
      ),
  },
  {
    label: "create repository",
    fn: () =>
      runCreateRepository(
        {
          project: PROJECT_SCOPE,
          name: "api",
          "remote-url": "https://github.com/acme/api.git",
          branch: "main",
        },
        new AddResource(
          fakeProjectRepoCreate,
          resolverForProject,
          new FakeModelCatalog(),
        ),
      ),
  },
  {
    label: "create credential",
    fn: () => {
      // D4: --value is removed; use --value-file - with injected stdin for hermetic testing
      const stdinMock = new PassThrough();
      stdinMock.end("secret\n");
      return runCreateCredential(
        {
          project: PROJECT_SCOPE,
          name: "token",
          provider: "github",
          "value-file": "-",
        },
        new AddResource(
          fakeProjectRepoCreate,
          resolverForProject,
          new FakeModelCatalog(),
        ),
        { stdin: stdinMock, timeoutMs: 5000 },
      );
    },
  },
  {
    label: "create notification",
    fn: () =>
      runCreateNotification(
        {
          project: PROJECT_SCOPE,
          name: "alert",
          provider: "slack",
          destination: "#ops",
        },
        new AddResource(
          fakeProjectRepoCreate,
          resolverForProject,
          new FakeModelCatalog(),
        ),
      ),
  },
  {
    label: "create ai-provider",
    fn: () =>
      runCreateAiProvider(
        {
          project: PROJECT_SCOPE,
          name: "claude",
          provider: "anthropic",
          model: "claude-3",
        },
        new AddResource(
          fakeProjectRepoCreate,
          resolverForProject,
          new FakeModelCatalog([{ provider: "anthropic", model: "claude-3" }]),
        ),
      ),
  },
  {
    label: "create filesystem",
    fn: () =>
      runCreateFilesystem(
        { project: PROJECT_SCOPE, name: "src", path: "/code" },
        new AddResource(
          fakeProjectRepoCreate,
          resolverForProject,
          new FakeModelCatalog(),
        ),
      ),
  },
  {
    label: "create task",
    fn: () =>
      runCreateTask(
        {
          objective: OBJECTIVE_SCOPE,
          title: "implement api",
          instructions: "Implement the API",
          ac: "API implemented",
        },
        new CreateTask(
          fakeTaskRepo,
          fakeInitiativeRepoForTask,
          fakeProjectRepoForTask,
          resolverForObjective,
        ),
      ),
  },
  {
    label: "find project",
    fn: () =>
      runFindProject({ name: "demo" }, new FindProject(fakeProjectRepoFind)),
  },
  {
    label: "find initiative",
    fn: () =>
      runFindInitiative(
        { project: PROJECT_SCOPE, name: "oauth" },
        new FindInitiative(fakeInitiativeRepoFind),
      ),
  },
  {
    label: "find objective",
    fn: () =>
      runFindObjective(
        { initiative: INITIATIVE_SCOPE, name: "backend" },
        new FindObjective(fakeInitiativeRepoFind),
      ),
  },
  {
    label: "find resource",
    fn: () =>
      runFindResource(
        { project: PROJECT_SCOPE, name: "api" },
        new FindResource(fakeProjectRepoFind),
      ),
  },
];

// ---------------------------------------------------------------------------
// One test per case — table driven
// ---------------------------------------------------------------------------

for (const c of cases) {
  test(`identity contract: ${c.label} stdout is exactly one Crockford ULID`, async () => {
    const result = await c.fn();
    assert.equal(
      result.exitCode,
      0,
      `${c.label}: expected exitCode 0, got ${result.exitCode} (stderr: ${result.stderr.join("; ")})`,
    );
    assert.equal(
      result.stdout.length,
      1,
      `${c.label}: expected exactly 1 stdout line, got ${result.stdout.length}: [${result.stdout.join(", ")}]`,
    );
    assert.match(
      result.stdout[0]!,
      ULID_RE,
      `${c.label}: stdout[0] "${result.stdout[0]}" is not a Crockford ULID`,
    );
  });
}

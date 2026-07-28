// src/app/project/check-project.ts — EPIC 014 Story 6
// The fact collector behind `kanthord check project`. It does every read and
// every clock read, then hands the assembled facts to the pure
// `buildProjectReadiness` (Story 1+2) for the report shape. The narrow
// structural deps (not the whole storage ports) keep the test hermetic and
// align with the "no god bag" rule (AGENTS.md: one capability per seam).
//
// Provider resolution mirrors the DAEMON exactly: `chain` returns
// `ResolveProjectChain.execute(projectId)` (assigned + appended active
// global default), and `source` is derived from `assignedIds` membership —
// never from `isDefault`, which is true for a default that IS also assigned.
// Bypassing the default fallback to make "unassigned" reportable would make
// the report stricter than the daemon (the dishonesty this epic exists to
// prevent — Story 1 verify list, item "Provider resolution matches the
// daemon exactly").

import type { Initiative } from "../../domain/initiative.ts";
import type {
  Repository,
  RepositoryAuth,
  Resource,
} from "../../domain/resource.ts";
import type { Task, TaskStatus } from "../../domain/task.ts";
import { UnknownReferenceError } from "../errors.ts";
import { buildProjectReadiness } from "./project-readiness.ts";
import type {
  InitiativeFact,
  ProbeRecord,
  ReadinessFacts,
  ReadinessReport,
  RepositoryFact,
  ResolvedProviderFact,
} from "./project-readiness.ts";
import type { ProviderProbeOutcome } from "./probe-ai-provider.ts";
import type { RepositoryProbe } from "../../repository-probe/port.ts";

export interface CheckProjectInput {
  id: string;
  probeRepositories: boolean;
  probeProvider: boolean;
}

export interface CheckProjectDeps {
  projects: {
    get(id: string): { id: string } | undefined;
    listResources(projectId: string): Resource[];
    getResource(id: string): Resource | undefined;
  };
  initiatives: {
    listInitiatives(projectId: string): Initiative[];
    listAllInitiatives(): Array<{ id: string; paused: boolean }>;
  };
  tasks: { listByInitiative(initiativeId: string): Task[] };
  providers: {
    /** The daemon's resolved chain, in order, including the appended active global default. */
    chain(projectId: string): Array<{ id: string; name: string }>;
    /** Ids of the explicit project assignments, whatever their state. */
    assignedIds(projectId: string): string[];
  };
  status: { schemaVersion(): number };
  expectedSchemaVersion: number;
  heartbeat: {
    staleMs: number;
    instances(): Array<{ instanceId: string; ageMs: number }>;
  };
  repositoryProbe: RepositoryProbe;
  providerProbe: { execute(providerId: string): Promise<ProviderProbeOutcome> };
}

const INCOMPLETE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "pending",
  "running",
  "failed",
  "awaiting_confirmation",
]);

function ascById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

interface RepositoryRow {
  repo: Repository;
  credentialId: string | null;
}

function isRepositoryResource(r: Resource): r is Repository {
  return r.type === "repository";
}

export class CheckProject {
  readonly #deps: CheckProjectDeps;

  constructor(deps: CheckProjectDeps) {
    this.#deps = deps;
  }

  async execute(input: CheckProjectInput): Promise<ReadinessReport> {
    // 1. Unknown project id is the only dep touched on the error path.
    if (this.#deps.projects.get(input.id) === undefined) {
      throw new UnknownReferenceError("project", input.id);
    }

    // 2. Repository facts (with credential resolution for https-token rows).
    const repoRows: RepositoryRow[] = this.#deps.projects
      .listResources(input.id)
      .filter(isRepositoryResource)
      .map((repo) => ({
        repo,
        credentialId:
          repo.auth.kind === "https-token" ? repo.auth.credentialId : null,
      }))
      .sort((a, b) =>
        a.repo.id < b.repo.id ? -1 : a.repo.id > b.repo.id ? 1 : 0,
      );
    const repositoryFacts: RepositoryFact[] = repoRows.map((row) => {
      if (row.credentialId === null) {
        return {
          id: row.repo.id,
          name: row.repo.name,
          branch: row.repo.branch,
          auth: row.repo.auth.kind,
          credentialId: null,
          credentialExists: false,
          credentialIsCredentialType: false,
        };
      }
      const c = this.#deps.projects.getResource(row.credentialId);
      return {
        id: row.repo.id,
        name: row.repo.name,
        branch: row.repo.branch,
        auth: row.repo.auth.kind,
        credentialId: row.credentialId,
        credentialExists: c !== undefined,
        credentialIsCredentialType: c?.type === "credential",
      };
    });

    // 3. Initiative facts (paused is from listAllInitiatives — the initiative
    //    row itself does not carry a paused field; the side map is built once).
    const pausedMap = new Map<string, boolean>(
      this.#deps.initiatives
        .listAllInitiatives()
        .map((row) => [row.id, row.paused] as const),
    );
    const initiativeFacts: InitiativeFact[] = ascById(
      this.#deps.initiatives.listInitiatives(input.id),
    ).map((i) => {
      const incomplete = this.#deps.tasks
        .listByInitiative(i.id)
        .filter((t) => INCOMPLETE_TASK_STATUSES.has(t.status)).length;
      return {
        id: i.id,
        name: i.name,
        status: i.status ?? "building",
        paused: pausedMap.get(i.id) ?? false,
        incompleteTaskCount: incomplete,
      };
    });

    // 4. AI provider — daemon-exact chain; source is derived from
    //    `assignedIds` membership (NEVER `isDefault`).
    const assignedIds = new Set(this.#deps.providers.assignedIds(input.id));
    const resolved: ResolvedProviderFact[] = this.#deps.providers
      .chain(input.id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        source: assignedIds.has(p.id)
          ? ("assigned" as const)
          : ("default" as const),
      }));
    const aiProvider = { resolved, assignedCount: assignedIds.size };

    // 5. Database status.
    const database = {
      schemaVersion: this.#deps.status.schemaVersion(),
      expectedSchemaVersion: this.#deps.expectedSchemaVersion,
    };

    // 6. Daemon heartbeat observations.
    const daemon = {
      instances: this.#deps.heartbeat.instances(),
      staleMs: this.#deps.heartbeat.staleMs,
    };

    // 7. Probes — build the `probes` object so a key is ABSENT unless the
    //    corresponding flag was passed. `--probe-provider` is never implied by
    //    `--probe-repositories` (and vice versa). Repository probes run
    //    sequentially in ascending id order, so the array is deterministic.
    const probes: { repositories?: ProbeRecord[]; provider?: ProbeRecord[] } =
      {};
    if (input.probeRepositories) {
      const repositoryProbes: ProbeRecord[] = [];
      for (const f of repositoryFacts) {
        const row = repoRows.find((r) => r.repo.id === f.id);
        if (row === undefined) continue;
        const auth: RepositoryAuth = row.repo.auth;
        const result = await this.#deps.repositoryProbe.probe({
          remoteUrl: row.repo.remoteUrl,
          branch: row.repo.branch,
          auth,
        });
        repositoryProbes.push({
          resourceId: f.id,
          status: result.status,
          detail: result.detail,
        });
      }
      probes.repositories = repositoryProbes;
    }
    if (input.probeProvider) {
      const providerProbes: ProbeRecord[] = [];
      const first = resolved[0];
      if (first !== undefined) {
        const outcome = await this.#deps.providerProbe.execute(first.id);
        providerProbes.push({
          resourceId: outcome.resourceId,
          status: outcome.status,
          detail: outcome.detail,
        });
      }
      probes.provider = providerProbes;
    }

    const facts: ReadinessFacts = {
      projectId: input.id,
      database,
      repositories: repositoryFacts,
      aiProvider,
      initiatives: initiativeFacts,
      daemon,
      probes,
    };
    return buildProjectReadiness(facts);
  }
}

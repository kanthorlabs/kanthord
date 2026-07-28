// src/app/project/observe-setup-facts.ts — EPIC 015 Story 1
// The fact collector behind the guided setup wizard. Synchronous because every
// seam it touches (ProjectRepository, InitiativeRepository, AiProviderRegistry)
// is backed by `node:sqlite`, and the wizard is interactive in the same
// process.
//
// The single contract the wizard depends on: `execute(input)` returns the
// `ObservedFacts` value the pure `SetupPlan` decides against. Secrets never
// leave the collector — `ObservedProvider` carries no `value`, and the
// credential's secret is not copied either. The list-`value` keys in the
// test fakes are deliberate: they prove the collector never reads them.

import type { Initiative } from "../../domain/initiative.ts";
import {
  isCredential,
  isRepository,
  type Resource,
} from "../../domain/resource.ts";
import type {
  AiProviderRegistry,
  InitiativeRepository,
  ProjectRepository,
} from "../../storage/port.ts";
import type { ObservedFacts } from "./setup-plan.ts";

export interface ObserveSetupFactsInput {
  projectName: string;
  repositoryName: string;
  providerName: string;
  /** Omitted when `repository.auth !== "https-token"`. */
  credentialName?: string;
}

export class ObserveSetupFacts {
  readonly #projects: ProjectRepository;
  readonly #initiatives: InitiativeRepository;
  readonly #registry: AiProviderRegistry;

  constructor(
    projects: ProjectRepository,
    initiatives: InitiativeRepository,
    registry: AiProviderRegistry,
  ) {
    this.#projects = projects;
    this.#initiatives = initiatives;
    this.#registry = registry;
  }

  execute(input: ObserveSetupFactsInput): ObservedFacts {
    // 1. projectsByName — every project whose name matches, sorted by id.
    // An id that resolves to undefined (race with a concurrent delete, or a
    // partial migration) is dropped so the plan never decides on a ghost.
    const projectIds = this.#projects
      .resolveProjectByName(input.projectName)
      .slice()
      .sort();
    const projectsByName = projectIds
      .map((id) => {
        const p = this.#projects.get(id);
        return p ? { id: p.id, name: p.name } : undefined;
      })
      .filter((p): p is { id: string; name: string } => p !== undefined)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // 2. The four other lists are scoped to projectsByName[0]; a mismatch
    // (zero or multiple) means we cannot decide safely, so we hand back
    // empty lists and let the plan surface the ambiguity.
    if (projectsByName.length !== 1) {
      return {
        projectsByName,
        credentialsByName: [],
        repositoriesByName: [],
        providersByName: [],
        initiatives: [],
      };
    }
    const projectId = projectsByName[0]!.id;

    // 3. Resources — through `listResources`, the unconditional port method.
    // `listResourcesByProject?` is intentionally not consumed: keeping a
    // single code path through `listResources` means the test fake's
    // throwing trap is the only authoritative proof we never reach for
    // the optional method.
    const resources: Resource[] = this.#projects.listResources(projectId);

    const credentialsByName =
      input.credentialName !== undefined
        ? resources
            .filter(isCredential)
            .filter((c) => c.name === input.credentialName)
            .map((c) => ({
              id: c.id,
              name: c.name,
              provider: c.provider,
            }))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        : [];

    const repositoriesByName = resources
      .filter(isRepository)
      .filter((r) => r.name === input.repositoryName)
      .map((r) => ({
        id: r.id,
        name: r.name,
        remoteUrl: r.remoteUrl,
        branch: r.branch,
        path: r.path,
        auth: r.auth,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // 4. Providers — `listAssigned` is the only authority for the project
    // assignment flag. A global default that has not been assigned to this
    // project is intentionally `assignedToProject: false`; the plan treats
    // that case as a `create` (assign step), not a `skip`.
    const assignedIds = new Set(
      this.#registry.listAssigned(projectId).map((p) => p.id),
    );
    const providersByName = this.#registry
      .list()
      .filter((p) => p.name === input.providerName)
      .map((p) => ({
        id: p.id,
        name: p.name,
        provider: p.provider,
        model: p.model,
        baseUrl: p.baseUrl,
        api: p.api,
        state: p.state,
        assignedToProject: assignedIds.has(p.id),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // 5. Initiatives — name is the only field the plan needs for graph
    // reconciliation. `i.projectId` is implicit in the list filter.
    const initiatives: { id: string; name: string }[] = this.#initiatives
      .listInitiatives(projectId)
      .map((i: Initiative) => ({ id: i.id, name: i.name }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    return {
      projectsByName,
      credentialsByName,
      repositoriesByName,
      providersByName,
      initiatives,
    };
  }
}

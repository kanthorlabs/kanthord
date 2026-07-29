// src/app/project/get-decision-queue.ts — Story 6 (EPIC 017).
// Cross-project decision queue: one ranked list across every project, built
// from the pure `projectDecisions`/`rankDecisions` projection (Story 5). No
// use case calls another use case — this iterates `listProjects()` itself and
// re-uses only the domain projection. Read-only: no `UnitOfWork`, no event
// append, no `save*`. Declares its own structural sources so this `app/`
// module honors the architecture boundary (mirrors `src/app/task/get-task.ts`
// and `src/app/project/get-project-overview.ts`).

import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import type {
  TaskResultRow,
  PublicationStateName,
} from "../../storage/port.ts";
import type { CommitPresence } from "../../commit-presence/port.ts";
import {
  projectDecisions,
  rankDecisions,
  type DecisionItem,
  type QueueEvidenceInput,
  type QueueInitiativeInput,
  type QueueObjectiveInput,
  type QueueProjectInput,
  type QueueTaskInput,
} from "../../domain/decision-queue.ts";

// ---------------------------------------------------------------------------
// Structural sources, in the exact constructor argument order pinned by
// Story 6 §A.2.
// ---------------------------------------------------------------------------

interface QueueProjectSource {
  listProjects(): Array<{ id: string; name: string }>;
}

interface QueueInitiativeSource {
  listInitiatives(projectId: string): Initiative[];
  listObjectives(initiativeId: string): Objective[];
}

interface QueueTaskSource {
  listByInitiative(initiativeId: string): Task[];
}

interface QueuePublicationSource {
  getLatestPublication(
    repoId: string,
  ): { state: PublicationStateName; remoteOID: string | null } | undefined;
}

interface QueueActivitySource {
  /** Latest actionable-event id per element id. */
  latestActionableEventIds(elementIds: readonly string[]): Map<string, string>;
}

interface QueueEvidenceSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
  resolveHomeDir(repoId: string): string;
  resolveInitiativeRepository(initiativeId: string): string | undefined;
}

interface QueueCandidateSource {
  /** Tasks with a persisted landing candidate — the `cause` discriminator. */
  getCandidateByTask(taskId: string): { id: string } | undefined;
}

type QueueCommitPresenceSource = CommitPresence;

/** One hex-looking OID awaiting a batched presence answer (review S3-batch). */
interface PendingPresenceCheck {
  entry: QueueEvidenceInput;
  field: "baseOid" | "headOid";
  homeDir: string;
  oid: string;
}

// ---------------------------------------------------------------------------
// Output type.
// ---------------------------------------------------------------------------

export interface GetDecisionQueueOutput {
  items: DecisionItem[];
  counts: { total: number; byKind: Record<string, number> };
  truncated: boolean;
  /**
   * Review R3-S3 — non-fatal degradation notices, one per homeDir whose
   * `hasCommits` probe rejected. The use case is read-only and must not
   * print; the CLI (`src/apps/cli/queue.ts`) writes these to stderr.
   */
  warnings: string[];
}

const DEFAULT_LIMIT = 50;
const HEX_OID = /^[0-9a-f]{7,64}$/;

// ---------------------------------------------------------------------------
// Use case.
// ---------------------------------------------------------------------------

export class GetDecisionQueue {
  readonly #projects: QueueProjectSource;
  readonly #initiatives: QueueInitiativeSource;
  readonly #tasks: QueueTaskSource;
  readonly #publications: QueuePublicationSource;
  readonly #activity: QueueActivitySource;
  readonly #evidence: QueueEvidenceSource;
  readonly #candidates: QueueCandidateSource;
  readonly #commitPresence: QueueCommitPresenceSource;

  constructor(
    projects: QueueProjectSource,
    initiatives: QueueInitiativeSource,
    tasks: QueueTaskSource,
    publications: QueuePublicationSource,
    activity: QueueActivitySource,
    evidence: QueueEvidenceSource,
    candidates: QueueCandidateSource,
    commitPresence: QueueCommitPresenceSource,
  ) {
    this.#projects = projects;
    this.#initiatives = initiatives;
    this.#tasks = tasks;
    this.#publications = publications;
    this.#activity = activity;
    this.#evidence = evidence;
    this.#candidates = candidates;
    this.#commitPresence = commitPresence;
  }

  /**
   * `inspect` must be `null` not only for a missing/malformed OID but also
   * for a well-formed OID absent from the named home (epic:543-544). The
   * pure `decision-queue.ts` projection only format-checks; this builds the
   * evidence entry and, for every hex-looking OID, registers it in `pending`
   * so `#resolvePresence` can null it out after ONE batched probe call per
   * distinct homeDir (review S3-batch) — never one call per OID here.
   */
  #rawEvidence(
    input: QueueEvidenceInput,
    pending: PendingPresenceCheck[],
  ): QueueEvidenceInput {
    const entry: QueueEvidenceInput = { ...input };
    const { homeDir, baseOid, headOid } = entry;
    if (homeDir === null) return entry;

    if (baseOid !== null && HEX_OID.test(baseOid)) {
      pending.push({ entry, field: "baseOid", homeDir, oid: baseOid });
    }
    if (headOid !== null && HEX_OID.test(headOid)) {
      pending.push({ entry, field: "headOid", homeDir, oid: headOid });
    }

    return entry;
  }

  /**
   * Groups every pending presence check by distinct homeDir and issues ONE
   * `hasCommits` call per home, carrying every OID that home needs across
   * every initiative that resolves to it (review S3-batch-d). Homes are
   * probed one at a time (deliberate sequencing) rather than through an
   * unbounded `Promise.all` — a queue spanning many managed repositories can
   * approach one home per initiative.
   *
   * Review R3-S3 (HUMAN DECISION) — the adapter still throws on an
   * operational fault (not a repository, git missing, timeout, …); a single
   * failing home must not hide every other project's items. A rejected
   * `hasCommits` for one home is caught here, treats only that home's OIDs
   * as absent (nulling `inspect` for its pending entries), and is surfaced
   * as one warning string — the use case stays read-only and never prints,
   * `runQueueList` writes the warning to stderr.
   */
  async #resolvePresence(pending: PendingPresenceCheck[]): Promise<string[]> {
    const oidsByHome = new Map<string, Set<string>>();
    for (const check of pending) {
      let oids = oidsByHome.get(check.homeDir);
      if (oids === undefined) {
        oids = new Set();
        oidsByHome.set(check.homeDir, oids);
      }
      oids.add(check.oid);
    }

    const warnings: string[] = [];
    const absentByHome = new Map<string, Set<string>>();
    for (const [homeDir, oidSet] of oidsByHome) {
      const oids = [...oidSet];
      let present: readonly boolean[];
      try {
        present = await this.#commitPresence.hasCommits(homeDir, oids);
      } catch (err) {
        const checksForHome = pending.filter(
          (check) => check.homeDir === homeDir,
        );
        const affectedEntries = new Set<QueueEvidenceInput>();
        for (const check of checksForHome) {
          check.entry[check.field] = null;
          affectedEntries.add(check.entry);
        }
        warnings.push(
          // review R4 — the count is of affected ELEMENTS, not of rendered
          // page items: presence is resolved before ranking and truncation,
          // so some of these may fall outside the page. "element(s)" states
          // exactly what was counted rather than implying a page count.
          `warning: commit probe failed for ${homeDir} (${err instanceof Error ? err.message : String(err)}); inspect omitted for ${String(affectedEntries.size)} affected element(s)`,
        );
        continue;
      }
      const absent = new Set<string>();
      oids.forEach((oid, i) => {
        if (!present[i]) absent.add(oid);
      });
      absentByHome.set(homeDir, absent);
    }

    for (const check of pending) {
      if (absentByHome.get(check.homeDir)?.has(check.oid)) {
        check.entry[check.field] = null;
      }
    }

    return warnings;
  }

  async execute(input: { limit?: number }): Promise<GetDecisionQueueOutput> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const projects = this.#projects.listProjects();

    const projectInputs: QueueProjectInput[] = [];
    const actionableIds = new Set<string>();
    const pendingPresence: PendingPresenceCheck[] = [];

    for (const p of projects) {
      const initiatives = this.#initiatives.listInitiatives(p.id);
      const queueTasks: QueueTaskInput[] = [];
      const queueObjectives: QueueObjectiveInput[] = [];
      const queueInitiatives: QueueInitiativeInput[] = [];
      const evidence = new Map<string, QueueEvidenceInput>();
      const candidateTaskIds = new Set<string>();

      for (const init of initiatives) {
        const objectives = this.#initiatives.listObjectives(init.id);
        const tasks = this.#tasks.listByInitiative(init.id);

        const repoId = this.#evidence.resolveInitiativeRepository(init.id);
        const homeDir =
          repoId !== undefined ? this.#evidence.resolveHomeDir(repoId) : null;

        let publication: QueueInitiativeInput["publication"] = null;
        if (repoId !== undefined) {
          const record = this.#publications.getLatestPublication(repoId);
          if (record !== undefined) {
            publication = {
              repositoryId: repoId,
              branch: `kanthord/init/${init.id}`,
              state: record.state,
            };
          }
        }

        const initiativeInput: QueueInitiativeInput = {
          id: init.id,
          name: init.name,
          projectId: p.id,
          paused: init.paused,
          publication,
        };
        if (init.status !== undefined) initiativeInput.status = init.status;
        queueInitiatives.push(initiativeInput);

        if (init.status === "landed") {
          actionableIds.add(init.id);
        }

        for (const t of tasks) {
          queueTasks.push({
            id: t.id,
            title: t.title,
            objectiveId: t.objectiveId,
            status: t.status,
            dependencies: t.dependencies,
          });

          if (t.status === "failed" || t.status === "awaiting_confirmation") {
            actionableIds.add(t.id);
            const result = this.#evidence.getTaskResult(t.id);
            evidence.set(
              t.id,
              this.#rawEvidence(
                {
                  homeDir,
                  baseOid: result?.baseCommit ?? null,
                  headOid: result?.commitSha ?? result?.proposalCommit ?? null,
                },
                pendingPresence,
              ),
            );

            if (t.status === "awaiting_confirmation") {
              const candidate = this.#candidates.getCandidateByTask(t.id);
              if (candidate !== undefined) candidateTaskIds.add(t.id);
            }
          }
        }

        for (const o of objectives) {
          const objectiveInput: QueueObjectiveInput = {
            id: o.id,
            name: o.name,
            initiativeId: init.id,
          };
          if (o.status !== undefined) objectiveInput.status = o.status;
          if (o.commitOid !== undefined) objectiveInput.commitOid = o.commitOid;
          queueObjectives.push(objectiveInput);

          if (o.status === "conflict" || o.status === "awaiting_confirmation") {
            actionableIds.add(o.id);
            evidence.set(
              o.id,
              this.#rawEvidence(
                {
                  homeDir,
                  baseOid: o.parentOid ?? null,
                  headOid: o.commitOid ?? null,
                },
                pendingPresence,
              ),
            );
          }
        }
      }

      projectInputs.push({
        projectId: p.id,
        projectName: p.name,
        tasks: queueTasks,
        objectives: queueObjectives,
        initiatives: queueInitiatives,
        actionableEventIds: new Map(),
        evidence,
        candidateTaskIds,
      });
    }

    // Review S3-batch: one hasCommits call per distinct homeDir, not one per
    // OID/initiative — resolves after every project's evidence has been
    // collected so every home's OIDs are asked about together.
    const warnings = await this.#resolvePresence(pendingPresence);

    // Rule: collect every candidate element id first, then make ONE call.
    const actionableEventIds = this.#activity.latestActionableEventIds([
      ...actionableIds,
    ]);
    for (const projectInput of projectInputs) {
      projectInput.actionableEventIds = actionableEventIds;
    }

    let items: DecisionItem[] = [];
    for (const projectInput of projectInputs) {
      items = items.concat(projectDecisions(projectInput));
    }
    const ranked = rankDecisions(items);

    const counts = {
      total: ranked.length,
      byKind: {} as Record<string, number>,
    };
    for (const item of ranked) {
      counts.byKind[item.kindLabel] = (counts.byKind[item.kindLabel] ?? 0) + 1;
    }

    const pageItems = ranked.slice(0, limit);
    const truncated = pageItems.length < counts.total;

    return { items: pageItems, counts, truncated, warnings };
  }
}

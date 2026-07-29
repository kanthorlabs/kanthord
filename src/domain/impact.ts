import type { TaskStatus } from "./task.ts";
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";
import { dependentClosure, type GraphNode } from "./graph.ts";
import { sha256Hex } from "./sha.ts";

export type DiscardTarget =
  { type: "task"; id: string } | { type: "objective"; id: string };

export interface ImpactTask {
  id: string;
  title: string;
  objectiveId: string;
  status: TaskStatus;
  dependencies: string[];
}

export interface ImpactObjective {
  id: string;
  name: string;
  initiativeId: string;
  status?: ObjectiveStatus;
  /** Sequencing predecessors: objective ids this objective must follow. */
  after: string[];
}

export interface ImpactInitiative {
  id: string;
  name: string;
  status?: InitiativeStatus;
  /** Sequencing predecessors: initiative ids this initiative must follow. */
  after: string[];
}

export interface ImpactInput {
  target: DiscardTarget;
  tasks: ImpactTask[];
  objectives: ImpactObjective[];
  initiatives: ImpactInitiative[];
}

export type DamageEffect =
  "discarded-by-cascade" | "permanently-unsatisfiable" | "left-blocked";

export interface Damage {
  target: {
    type: "task" | "objective" | "initiative";
    id: string;
    name: string;
  };
  effect: DamageEffect;
}

export interface DiscardPreview {
  damage: Damage[];
  counts: Record<DamageEffect, number>;
  /** Stable hash over the sorted `damage` array. */
  digest: string;
}

/** Lower number = higher precedence (more severe, dominant effect). */
const EFFECT_PRECEDENCE: Record<DamageEffect, number> = {
  "discarded-by-cascade": 0,
  "permanently-unsatisfiable": 1,
  "left-blocked": 2,
};

interface RecordedEffect {
  type: "task" | "objective" | "initiative";
  name: string;
  effect: DamageEffect;
}

/**
 * Pure preview of what a `reject task` / `reject objective` discard would
 * damage, without mutating anything. See epic 017 Decision 4 / Story 2.
 */
export function previewDiscard(input: ImpactInput): DiscardPreview {
  const { target, tasks, objectives, initiatives } = input;

  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const objectivesById = new Map(objectives.map((o) => [o.id, o]));
  const initiativesById = new Map(initiatives.map((i) => [i.id, i]));

  const effects = new Map<string, RecordedEffect>();

  function record(
    type: "task" | "objective" | "initiative",
    id: string,
    name: string | undefined,
    effect: DamageEffect,
  ): void {
    if (name === undefined) return; // no matching record: never guess a name
    const existing = effects.get(id);
    if (
      existing !== undefined &&
      EFFECT_PRECEDENCE[existing.effect] <= EFFECT_PRECEDENCE[effect]
    ) {
      return; // keep the already-recorded, equal-or-more-severe effect
    }
    effects.set(id, { type, name, effect });
  }

  // Objective/initiative ids newly rolled to "discarded" by this call (never
  // includes ids that were already discarded before it). Used both to decide
  // what to report and as the trigger set for permanently-unsatisfiable.
  const discardedObjectiveIds = new Set<string>();
  const discardedInitiativeIds = new Set<string>();

  if (target.type === "task") {
    const nodes: GraphNode[] = tasks.map((t) => ({
      id: t.id,
      status: t.status,
      dependencies: t.dependencies,
    }));
    const closure = dependentClosure(nodes, target.id);

    // Cascade-discarded dependents only — the target itself is never in
    // `damage` (dependentClosure already excludes the root), but it counts
    // as discarded for the objective rollup below, mirroring reject-task.ts's
    // statusOverride (the target's own future transition).
    const cascadedDiscarded = new Set<string>();
    for (const id of closure) {
      const t = tasksById.get(id);
      if (t === undefined) continue;
      if (t.status === "pending") {
        record("task", id, t.title, "discarded-by-cascade");
        cascadedDiscarded.add(id);
      } else {
        record("task", id, t.title, "left-blocked");
      }
    }

    const currentStatus = (t: ImpactTask): TaskStatus =>
      t.id === target.id || cascadedDiscarded.has(t.id)
        ? "discarded"
        : t.status;

    const targetTask = tasksById.get(target.id);
    const touchedObjectiveIds = new Set<string>();
    if (targetTask !== undefined) {
      touchedObjectiveIds.add(targetTask.objectiveId);
    }
    for (const id of cascadedDiscarded) {
      const t = tasksById.get(id);
      if (t !== undefined) touchedObjectiveIds.add(t.objectiveId);
    }

    const touchedInitiativeIds = new Set<string>();
    for (const objectiveId of touchedObjectiveIds) {
      const objective = objectivesById.get(objectiveId);
      if (objective === undefined || objective.status === "discarded") {
        continue;
      }
      touchedInitiativeIds.add(objective.initiativeId);

      const objectiveTasks = tasks.filter((t) => t.objectiveId === objectiveId);
      const allTerminal = objectiveTasks.every((t) => {
        const s = currentStatus(t);
        return s === "completed" || s === "discarded";
      });
      const anyDiscarded = objectiveTasks.some(
        (t) => currentStatus(t) === "discarded",
      );
      if (allTerminal && anyDiscarded) {
        discardedObjectiveIds.add(objectiveId);
        record(
          "objective",
          objectiveId,
          objective.name,
          "discarded-by-cascade",
        );
      }
    }

    for (const initiativeId of touchedInitiativeIds) {
      const initiative = initiativesById.get(initiativeId);
      if (initiative === undefined || initiative.status === "discarded") {
        continue;
      }
      const siblings = objectives.filter(
        (o) => o.initiativeId === initiativeId,
      );
      const effectiveObjectiveStatus = (
        o: ImpactObjective,
      ): ObjectiveStatus | undefined =>
        discardedObjectiveIds.has(o.id) ? "discarded" : o.status;
      const allTerminal = siblings.every((o) => {
        const s = effectiveObjectiveStatus(o);
        return s === "integrated" || s === "discarded";
      });
      const anyDiscarded = siblings.some(
        (o) => effectiveObjectiveStatus(o) === "discarded",
      );
      if (allTerminal && anyDiscarded) {
        discardedInitiativeIds.add(initiativeId);
        record(
          "initiative",
          initiativeId,
          initiative.name,
          "discarded-by-cascade",
        );
      }
    }
  } else {
    const objectiveTasks = tasks.filter(
      (t) =>
        t.objectiveId === target.id &&
        (t.status === "pending" || t.status === "failed"),
    );
    for (const t of objectiveTasks) {
      record("task", t.id, t.title, "discarded-by-cascade");
    }

    // The target objective itself is never in `damage`, but is the trigger
    // for permanently-unsatisfiable downstream objectives.
    discardedObjectiveIds.add(target.id);

    const targetObjective = objectivesById.get(target.id);
    if (targetObjective !== undefined) {
      const initiative = initiativesById.get(targetObjective.initiativeId);
      if (initiative !== undefined && initiative.status !== "discarded") {
        const siblings = objectives.filter(
          (o) => o.initiativeId === targetObjective.initiativeId,
        );
        const effectiveObjectiveStatus = (
          o: ImpactObjective,
        ): ObjectiveStatus | undefined =>
          o.id === target.id ? "discarded" : o.status;
        const allTerminal = siblings.every((o) => {
          const s = effectiveObjectiveStatus(o);
          return s === "integrated" || s === "discarded";
        });
        const anyDiscarded = siblings.some(
          (o) => effectiveObjectiveStatus(o) === "discarded",
        );
        if (allTerminal && anyDiscarded) {
          discardedInitiativeIds.add(targetObjective.initiativeId);
          record(
            "initiative",
            targetObjective.initiativeId,
            initiative.name,
            "discarded-by-cascade",
          );
        }
      }
    }
  }

  // permanently-unsatisfiable objectives, computed to a fixpoint: an
  // objective made permanently unsatisfiable is itself a trigger for its own
  // dependents.
  const objectiveTrigger = new Set<string>(discardedObjectiveIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of objectives) {
      if (o.status === "discarded") continue;
      if (objectiveTrigger.has(o.id)) continue;
      const blocked = o.after.some((id) => objectiveTrigger.has(id));
      if (blocked) {
        objectiveTrigger.add(o.id);
        record("objective", o.id, o.name, "permanently-unsatisfiable");
        changed = true;
      }
    }
  }

  // permanently-unsatisfiable initiatives: only from initiatives actually
  // rolled to "discarded" by this call — never merely because one of their
  // objectives was discarded.
  for (const i of initiatives) {
    if (i.status === "discarded") continue;
    if (discardedInitiativeIds.has(i.id)) continue;
    const blocked = i.after.some((id) => discardedInitiativeIds.has(id));
    if (blocked) {
      record("initiative", i.id, i.name, "permanently-unsatisfiable");
    }
  }

  const damage: Damage[] = [...effects.entries()]
    .map(([id, v]) => ({
      target: { type: v.type, id, name: v.name },
      effect: v.effect,
    }))
    .sort((a, b) => {
      const byPrecedence =
        EFFECT_PRECEDENCE[a.effect] - EFFECT_PRECEDENCE[b.effect];
      if (byPrecedence !== 0) return byPrecedence;
      return a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0;
    });

  const counts: Record<DamageEffect, number> = {
    "discarded-by-cascade": 0,
    "permanently-unsatisfiable": 0,
    "left-blocked": 0,
  };
  for (const d of damage) counts[d.effect]++;

  const digest = sha256Hex(JSON.stringify(damage));

  return { damage, counts, digest };
}

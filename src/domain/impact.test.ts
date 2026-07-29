import { test } from "node:test";
import assert from "node:assert/strict";

import {
  previewDiscard,
  type ImpactInput,
  type ImpactTask,
  type ImpactObjective,
  type ImpactInitiative,
} from "./impact.ts";

function task(
  id: string,
  status: ImpactTask["status"],
  objectiveId: string,
  dependencies: string[] = [],
): ImpactTask {
  return { id, title: `title-${id}`, objectiveId, status, dependencies };
}

function objective(
  id: string,
  initiativeId: string,
  after: string[] = [],
  status?: ImpactObjective["status"],
): ImpactObjective {
  return { id, name: `name-${id}`, initiativeId, after, status };
}

function initiative(
  id: string,
  after: string[] = [],
  status?: ImpactInitiative["status"],
): ImpactInitiative {
  return { id, name: `name-${id}`, after, status };
}

// ---------------------------------------------------------------------------
// (017-S2-task-mixed-closure)
// ---------------------------------------------------------------------------

test("(017-S2-task-mixed-closure) root with a pending dependent and a running dependent: pending is discarded-by-cascade, running is left-blocked", () => {
  const input: ImpactInput = {
    target: { type: "task", id: "root" },
    tasks: [
      task("root", "failed", "o1"),
      task("pendingDep", "pending", "o1", ["root"]),
      task("runningDep", "running", "o1", ["root"]),
    ],
    objectives: [objective("o1", "i1")],
    initiatives: [initiative("i1")],
  };

  const result = previewDiscard(input);

  assert.deepEqual(
    result.damage.map((d) => ({ id: d.target.id, effect: d.effect })),
    [
      { id: "pendingDep", effect: "discarded-by-cascade" },
      { id: "runningDep", effect: "left-blocked" },
    ],
  );
  assert.deepEqual(result.counts, {
    "discarded-by-cascade": 1,
    "permanently-unsatisfiable": 0,
    "left-blocked": 1,
  });
});

// ---------------------------------------------------------------------------
// (017-S2-task-transitive)
// ---------------------------------------------------------------------------

test("(017-S2-task-transitive) chain a->b->c, all pending, target a: b and c both discarded-by-cascade; a is the chain's only task in o1, so o1/i1 roll up too", () => {
  const input: ImpactInput = {
    target: { type: "task", id: "a" },
    tasks: [
      task("a", "pending", "o1"),
      task("b", "pending", "o1", ["a"]),
      task("c", "pending", "o1", ["b"]),
    ],
    objectives: [objective("o1", "i1")],
    initiatives: [initiative("i1")],
  };

  const result = previewDiscard(input);

  const taskIds = result.damage
    .filter(
      (d) => d.effect === "discarded-by-cascade" && d.target.type === "task",
    )
    .map((d) => d.target.id)
    .sort();
  assert.deepEqual(taskIds, ["b", "c"]);

  const rolledUpIds = result.damage
    .filter(
      (d) => d.effect === "discarded-by-cascade" && d.target.type !== "task",
    )
    .map((d) => d.target.id)
    .sort();
  assert.deepEqual(
    rolledUpIds,
    ["i1", "o1"],
    "a, b, and c are the whole of o1's tasks, so once all are discarded the objective and its sole initiative roll up too",
  );
});

// ---------------------------------------------------------------------------
// (017-S2-leaf)
// ---------------------------------------------------------------------------

test("(017-S2-leaf) a task with no dependents: no task-level damage, but is the sole task in o1 so o1/i1 roll up, non-empty 64-char hex digest", () => {
  const input: ImpactInput = {
    target: { type: "task", id: "solo" },
    tasks: [task("solo", "pending", "o1")],
    objectives: [objective("o1", "i1")],
    initiatives: [initiative("i1")],
  };

  const result = previewDiscard(input);

  assert.deepEqual(
    result.damage.filter((d) => d.target.type === "task"),
    [],
    "solo has no dependents, so no task-level cascade damage",
  );
  assert.deepEqual(
    result.damage
      .map((d) => ({ id: d.target.id, effect: d.effect }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "i1", effect: "discarded-by-cascade" },
      { id: "o1", effect: "discarded-by-cascade" },
    ],
    "solo is the only task in o1, so discarding it rolls o1 and its sole initiative up too",
  );
  assert.deepEqual(result.counts, {
    "discarded-by-cascade": 2,
    "permanently-unsatisfiable": 0,
    "left-blocked": 0,
  });
  assert.equal(typeof result.digest, "string");
  assert.match(result.digest, /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// (017-S2-objective-tasks)
// ---------------------------------------------------------------------------

test("(017-S2-objective-tasks) objective target with pending, failed, completed tasks: pending and failed discarded-by-cascade, completed absent", () => {
  const input: ImpactInput = {
    target: { type: "objective", id: "o1" },
    tasks: [
      task("t-pending", "pending", "o1"),
      task("t-failed", "failed", "o1"),
      task("t-completed", "completed", "o1"),
    ],
    objectives: [objective("o1", "i1")],
    initiatives: [initiative("i1")],
  };

  const result = previewDiscard(input);

  const ids = result.damage
    .filter(
      (d) => d.effect === "discarded-by-cascade" && d.target.type === "task",
    )
    .map((d) => d.target.id)
    .sort();
  assert.deepEqual(ids, ["t-failed", "t-pending"]);
  assert.equal(
    result.damage.some((d) => d.target.id === "t-completed"),
    false,
  );
});

// ---------------------------------------------------------------------------
// (017-S2-objective-downstream)
// ---------------------------------------------------------------------------

test("(017-S2-objective-downstream) O2.after = [O1], target O1: O2 is permanently-unsatisfiable", () => {
  const input: ImpactInput = {
    target: { type: "objective", id: "o1" },
    tasks: [],
    objectives: [objective("o1", "i1"), objective("o2", "i1", ["o1"])],
    initiatives: [initiative("i1")],
  };

  const result = previewDiscard(input);

  assert.deepEqual(
    result.damage.find((d) => d.target.id === "o2"),
    {
      target: { type: "objective", id: "o2", name: "name-o2" },
      effect: "permanently-unsatisfiable",
    },
  );
});

// ---------------------------------------------------------------------------
// (017-S2-objective-downstream-transitive)
// ---------------------------------------------------------------------------

test("(017-S2-objective-downstream-transitive) O3.after=[O2], O2.after=[O1], target O1: both O2 and O3 permanently-unsatisfiable", () => {
  const input: ImpactInput = {
    target: { type: "objective", id: "o1" },
    tasks: [],
    objectives: [
      objective("o1", "i1"),
      objective("o2", "i1", ["o1"]),
      objective("o3", "i1", ["o2"]),
    ],
    initiatives: [initiative("i1")],
  };

  const result = previewDiscard(input);

  const permanent = result.damage
    .filter((d) => d.effect === "permanently-unsatisfiable")
    .map((d) => d.target.id)
    .sort();
  assert.deepEqual(permanent, ["o2", "o3"]);
});

// ---------------------------------------------------------------------------
// (017-S2-initiative-cascades)
// ---------------------------------------------------------------------------

test("(017-S2-initiative-cascades) target is initiative's only non-terminal objective, sibling integrated: initiative discarded-by-cascade", () => {
  const input: ImpactInput = {
    target: { type: "objective", id: "o1" },
    tasks: [],
    objectives: [
      objective("o1", "i1", [], "building"),
      objective("o2", "i1", [], "integrated"),
    ],
    initiatives: [initiative("i1")],
  };

  const result = previewDiscard(input);

  assert.deepEqual(
    result.damage.find((d) => d.target.id === "i1"),
    {
      target: { type: "initiative", id: "i1", name: "name-i1" },
      effect: "discarded-by-cascade",
    },
  );
});

// ---------------------------------------------------------------------------
// (017-S2-initiative-survives)
// ---------------------------------------------------------------------------

test("(017-S2-initiative-survives) a sibling objective is building: initiative absent from damage, and an initiative naming it in after is also absent", () => {
  const input: ImpactInput = {
    target: { type: "objective", id: "o1" },
    tasks: [],
    objectives: [
      objective("o1", "i1", [], "building"),
      objective("o2", "i1", [], "building"),
    ],
    initiatives: [initiative("i1"), initiative("i2", ["i1"])],
  };

  const result = previewDiscard(input);

  assert.equal(
    result.damage.some((d) => d.target.id === "i1"),
    false,
  );
  assert.equal(
    result.damage.some((d) => d.target.id === "i2"),
    false,
  );
});

// ---------------------------------------------------------------------------
// (017-S2-initiative-downstream)
// ---------------------------------------------------------------------------

test("(017-S2-initiative-downstream) initiative cascades, another initiative has after:[thatInitiativeId]: permanently-unsatisfiable", () => {
  const input: ImpactInput = {
    target: { type: "objective", id: "o1" },
    tasks: [],
    objectives: [
      objective("o1", "i1", [], "building"),
      objective("o2", "i1", [], "integrated"),
    ],
    initiatives: [initiative("i1"), initiative("i2", ["i1"])],
  };

  const result = previewDiscard(input);

  assert.deepEqual(
    result.damage.find((d) => d.target.id === "i2"),
    {
      target: { type: "initiative", id: "i2", name: "name-i2" },
      effect: "permanently-unsatisfiable",
    },
  );
});

// ---------------------------------------------------------------------------
// (017-S2-precedence-dedup)
// ---------------------------------------------------------------------------

test("(017-S2-precedence-dedup) an initiative qualifying for both discarded-by-cascade (its own rollup) and permanently-unsatisfiable (an after-edge to another newly-discarded initiative) appears exactly once, under discarded-by-cascade", () => {
  // task target "root" is the sole task of objective o0/initiative i0: its
  // own discard rolls o0 then i0 to discarded (discarded-by-cascade).
  // dependent task "dep1" is the sole task of objective o1/initiative i1: the
  // cascade discards it too, rolling o1 then i1 to discarded
  // (discarded-by-cascade). i1.after = ["i0"] additionally makes i1 qualify
  // for permanently-unsatisfiable (i0 is newly discarded) -- but i1 must
  // appear exactly once, under its dominant effect, discarded-by-cascade.
  const input: ImpactInput = {
    target: { type: "task", id: "root" },
    tasks: [
      task("root", "pending", "o0"),
      task("dep1", "pending", "o1", ["root"]),
    ],
    objectives: [objective("o0", "i0"), objective("o1", "i1")],
    initiatives: [initiative("i0"), initiative("i1", ["i0"])],
  };

  const result = previewDiscard(input);
  const i1Entries = result.damage.filter((d) => d.target.id === "i1");
  assert.equal(i1Entries.length, 1);
  assert.equal(i1Entries[0]?.effect, "discarded-by-cascade");
});

// ---------------------------------------------------------------------------
// (017-S2-already-discarded-not-reported)
// ---------------------------------------------------------------------------

test("(017-S2-already-discarded-not-reported) an objective already discarded whose after names the target is absent from damage", () => {
  const input: ImpactInput = {
    target: { type: "objective", id: "o1" },
    tasks: [],
    objectives: [
      objective("o1", "i1"),
      objective("o2", "i1", ["o1"], "discarded"),
    ],
    initiatives: [initiative("i1")],
  };

  const result = previewDiscard(input);

  assert.equal(
    result.damage.some((d) => d.target.id === "o2"),
    false,
  );
});

// ---------------------------------------------------------------------------
// (017-S2-order-independent)
// ---------------------------------------------------------------------------

test("(017-S2-order-independent) shuffled tasks/objectives arrays yield byte-identical digest and deepEqual damage", () => {
  const base: ImpactInput = {
    target: { type: "task", id: "root" },
    tasks: [
      task("root", "pending", "o1"),
      task("z", "pending", "o1", ["root"]),
      task("a", "running", "o1", ["root"]),
    ],
    objectives: [objective("o1", "i1")],
    initiatives: [initiative("i1")],
  };
  const shuffled: ImpactInput = {
    target: { type: "task", id: "root" },
    tasks: [
      base.tasks[2] as ImpactTask,
      base.tasks[0] as ImpactTask,
      base.tasks[1] as ImpactTask,
    ],
    objectives: [...base.objectives],
    initiatives: [...base.initiatives],
  };

  const r1 = previewDiscard(base);
  const r2 = previewDiscard(shuffled);

  assert.equal(r1.digest, r2.digest);
  assert.deepEqual(r1.damage, r2.damage);
});

// ---------------------------------------------------------------------------
// (017-S2-digest-changes)
// ---------------------------------------------------------------------------

test("(017-S2-digest-changes) two graphs differing by one damaged node yield different digests", () => {
  const inputA: ImpactInput = {
    target: { type: "task", id: "root" },
    tasks: [
      task("root", "pending", "o1"),
      task("dep", "pending", "o1", ["root"]),
    ],
    objectives: [objective("o1", "i1")],
    initiatives: [initiative("i1")],
  };
  const inputB: ImpactInput = {
    target: { type: "task", id: "root" },
    tasks: [task("root", "pending", "o1")],
    objectives: [objective("o1", "i1")],
    initiatives: [initiative("i1")],
  };

  const r1 = previewDiscard(inputA);
  const r2 = previewDiscard(inputB);

  assert.notEqual(r1.digest, r2.digest);
});

// ---------------------------------------------------------------------------
// (017-S2-input-not-mutated)
// ---------------------------------------------------------------------------

test("(017-S2-input-not-mutated) input is not mutated by previewDiscard", () => {
  const input: ImpactInput = {
    target: { type: "task", id: "root" },
    tasks: [
      task("root", "pending", "o1"),
      task("dep", "pending", "o1", ["root"]),
    ],
    objectives: [objective("o1", "i1")],
    initiatives: [initiative("i1")],
  };
  const clone = structuredClone(input);

  previewDiscard(input);

  assert.deepEqual(input, clone);
});

// ---------------------------------------------------------------------------
// Review blocker B1 — a task-target discard must roll up the objective (and,
// transitively, the initiative) the SAME WAY `RejectTask#execute`'s own
// rollup does (`reject-task.ts:330-380`): it treats the target task itself as
// discarded, not merely absent. Mirrors `makeDiscardScenario()` in
// `src/app/task/reject-task.test.ts` — a failed root task (the target), a
// pending cascade-discarded dependent, and an already-completed dependent, in
// an objective whose only sibling objective is already `integrated`.
// ---------------------------------------------------------------------------

test("(017-S2-task-target-triggers-objective-and-initiative-rollup) a task-target discard whose objective becomes all-terminal (target itself counted as discarded) rolls up the objective, and — since its sibling is integrated — the initiative too", () => {
  const input: ImpactInput = {
    target: { type: "task", id: "root" },
    tasks: [
      task("root", "failed", "o1"),
      task("pendingDep", "pending", "o1", ["root"]),
      task("completedDep", "completed", "o1", ["root"]),
    ],
    objectives: [
      objective("o1", "i1", [], "building"),
      objective("o2", "i1", [], "integrated"),
    ],
    initiatives: [initiative("i1", [], "building")],
  };

  const result = previewDiscard(input);

  assert.deepEqual(
    result.damage.find((d) => d.target.id === "o1"),
    {
      target: { type: "objective", id: "o1", name: "name-o1" },
      effect: "discarded-by-cascade",
    },
    `the target's own objective must roll up to discarded-by-cascade once the target and its cascade-discarded dependent leave it all-terminal; got: ${JSON.stringify(result.damage)}`,
  );
  assert.deepEqual(
    result.damage.find((d) => d.target.id === "i1"),
    {
      target: { type: "initiative", id: "i1", name: "name-i1" },
      effect: "discarded-by-cascade",
    },
    `the initiative must roll up too, since its only other objective (o2) is already integrated; got: ${JSON.stringify(result.damage)}`,
  );
});

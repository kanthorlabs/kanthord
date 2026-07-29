/**
 * Story 7 (017) — `GetObjectiveConflict` use case.
 *
 * `GetObjectiveConflict.execute({ objectiveId })` returns
 * `ObjectiveConflictOutput` per epic 017 Decision 2 / Story 7 §A. Unknown id →
 * `UnknownReferenceError("objective", id)`. Non-conflict status →
 * `ObjectiveNotInConflictError` naming the actual status. `conflictCause` is
 * read from the persisted column, never inferred from `currentTip`. No
 * `files` key — an objective conflict is a ref-update failure, not a
 * file-level merge conflict.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GetObjectiveConflict,
  ObjectiveNotInConflictError,
} from "./get-objective-conflict.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Objective } from "../../domain/initiative.ts";

const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ1";
const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINIT1";
const HOME_DIR = "/home";

interface FakeObjectiveSource {
  getObjective(id: string): Objective | undefined;
}

function makeSource(objective: Objective | undefined): FakeObjectiveSource {
  return {
    getObjective: (id: string) => (id === OBJ_ID ? objective : undefined),
  };
}

function conflictObjective(overrides: Partial<Objective> = {}): Objective {
  return {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "O",
    status: "conflict",
    conflictCause: "non-single-commit",
    parentOid: "aaaaaaa",
    commitOid: "bbbbbbb",
    conflictReason: "gate failed",
    note: "resolve at the new tip",
    ...overrides,
  };
}

function noThrowBroker(currentTip: string): {
  currentTip(dir: string, ref: string): Promise<string>;
} {
  return { currentTip: async () => currentTip };
}

function resolver(): (initiativeId: string) => string {
  return () => HOME_DIR;
}

test("(017-S7-unknown) unknown id rejects with UnknownReferenceError", async () => {
  const uc = new GetObjectiveConflict(
    makeSource(undefined),
    noThrowBroker("aaaaaaa"),
    resolver(),
    presentProbe(),
  );
  await assert.rejects(
    () => uc.execute({ objectiveId: OBJ_ID }),
    UnknownReferenceError,
  );
});

test("(017-S7-not-conflict) each non-conflict status rejects with ObjectiveNotInConflictError naming the actual status", async () => {
  for (const status of [
    "building",
    "awaiting_confirmation",
    "integrated",
    "discarded",
  ] as const) {
    const objective = conflictObjective({ status });
    const uc = new GetObjectiveConflict(
      makeSource(objective),
      noThrowBroker("aaaaaaa"),
      resolver(),
      presentProbe(),
    );
    await assert.rejects(
      () => uc.execute({ objectiveId: OBJ_ID }),
      (err: unknown) => {
        if (!(err instanceof ObjectiveNotInConflictError)) {
          throw err;
        }
        assert.equal(err.status, status);
        return true;
      },
    );
  }
});

test("(017-S7-fields) a conflict objective with all columns set returns every field verbatim, and no files key", async () => {
  const objective = conflictObjective();
  const uc = new GetObjectiveConflict(
    makeSource(objective),
    noThrowBroker("aaaaaaa"),
    resolver(),
    presentProbe(),
  );
  const output = await uc.execute({ objectiveId: OBJ_ID });

  assert.equal(output.objectiveId, OBJ_ID);
  assert.equal(output.initiativeId, INIT_ID);
  assert.equal(output.status, "conflict");
  assert.equal(output.conflictCause, "non-single-commit");
  assert.equal(output.parentOid, "aaaaaaa");
  assert.equal(output.commitOid, "bbbbbbb");
  assert.equal(output.conflictReason, "gate failed");
  assert.equal(output.note, "resolve at the new tip");
  assert.equal("files" in output, false);
});

test("(017-S7-cause-not-inferred) conflictCause stays cas-mismatch and tipMovedSinceAnchor false when currentTip equals parentOid", async () => {
  const objective = conflictObjective({
    conflictCause: "cas-mismatch",
    observedTipOid: "ccccccc",
    parentOid: "aaaaaaa",
  });
  const uc = new GetObjectiveConflict(
    makeSource(objective),
    noThrowBroker("aaaaaaa"),
    resolver(),
    presentProbe(),
  );
  const output = await uc.execute({ objectiveId: OBJ_ID });
  assert.equal(output.conflictCause, "cas-mismatch");
  assert.equal(output.tipMovedSinceAnchor, false);
});

test("(017-S7-tip-moved) currentTip !== parentOid sets tipMovedSinceAnchor true", async () => {
  const objective = conflictObjective({ parentOid: "aaaaaaa" });
  const uc = new GetObjectiveConflict(
    makeSource(objective),
    noThrowBroker("ddddddd"),
    resolver(),
    presentProbe(),
  );
  const output = await uc.execute({ objectiveId: OBJ_ID });
  assert.equal(output.currentTip, "ddddddd");
  assert.equal(output.tipMovedSinceAnchor, true);
});

test("(017-S7-legacy-row) no persisted conflictCause reports null and still succeeds", async () => {
  const objective = conflictObjective({ conflictCause: undefined });
  const uc = new GetObjectiveConflict(
    makeSource(objective),
    noThrowBroker("aaaaaaa"),
    resolver(),
    presentProbe(),
  );
  const output = await uc.execute({ objectiveId: OBJ_ID });
  assert.equal(output.conflictCause, null);
});

test("(017-S7-broker-absent) a broker without currentTip, and one whose currentTip rejects, both yield currentTip:null and tipMovedSinceAnchor:false with no throw", async () => {
  const objective = conflictObjective();

  const ucNoMethod = new GetObjectiveConflict(
    makeSource(objective),
    {},
    resolver(),
    presentProbe(),
  );
  const outNoMethod = await ucNoMethod.execute({ objectiveId: OBJ_ID });
  assert.equal(outNoMethod.currentTip, null);
  assert.equal(outNoMethod.tipMovedSinceAnchor, false);

  const ucRejects = new GetObjectiveConflict(
    makeSource(objective),
    { currentTip: async () => Promise.reject(new Error("mirror unreadable")) },
    resolver(),
    presentProbe(),
  );
  const outRejects = await ucRejects.execute({ objectiveId: OBJ_ID });
  assert.equal(outRejects.currentTip, null);
  assert.equal(outRejects.tipMovedSinceAnchor, false);
});

test("(017-S7-inspect) valid OIDs build structured inspect.args; a missing commitOid or malformed OID yields inspect:null", async () => {
  const objective = conflictObjective({
    parentOid: "aaaaaaa",
    commitOid: "bbbbbbb",
  });
  const probe = presentProbe();
  const uc = new GetObjectiveConflict(
    makeSource(objective),
    noThrowBroker("aaaaaaa"),
    resolver(),
    probe,
  );
  const output = await uc.execute({ objectiveId: OBJ_ID });
  assert.deepEqual(output.evidence.inspect, {
    executable: "git",
    args: ["-C", HOME_DIR, "diff", "aaaaaaa..bbbbbbb"],
  });
  assert.equal(output.evidence.basis, "verification-and-summary");
  assert.equal(output.evidence.diffAvailable, false);
  assert.deepEqual(
    probe.calls,
    [
      [HOME_DIR, "aaaaaaa"],
      [HOME_DIR, "bbbbbbb"],
    ],
    "a runnable inspect on the happy path must genuinely depend on the injected presence probe reporting both OIDs present, not an unconditional default",
  );

  const missingCommit = conflictObjective({ commitOid: undefined });
  const ucMissing = new GetObjectiveConflict(
    makeSource(missingCommit),
    noThrowBroker("aaaaaaa"),
    resolver(),
    presentProbe(),
  );
  const outMissing = await ucMissing.execute({ objectiveId: OBJ_ID });
  assert.equal(outMissing.evidence.inspect, null);

  const malformed = conflictObjective({ commitOid: "not-hex!!" });
  const ucMalformed = new GetObjectiveConflict(
    makeSource(malformed),
    noThrowBroker("aaaaaaa"),
    resolver(),
    presentProbe(),
  );
  const outMalformed = await ucMalformed.execute({ objectiveId: OBJ_ID });
  assert.equal(outMalformed.evidence.inspect, null);
});

// ---------------------------------------------------------------------------
// Review blocker S3 — `inspect` must be `null` exactly when an OID is
// missing, malformed, OR absent from the named home (epic:543-544). Today
// `GetObjectiveConflict` only format-checks the OIDs (`HEX_OID.test`); it
// never asks whether the commit actually exists in `homeDir`, so a
// well-formed-but-absent OID wrongly builds a runnable-looking `inspect`.
//
// The seam this test wants: a fourth constructor dependency, a narrow
// structural port (e.g. `CommitPresenceSource`) with
// `hasCommits(homeDir: string, oids: readonly string[]): Promise<readonly boolean[]>`
// (batched per review blocker S3-batch — see below), backed by a new small
// capability port (`CommitPresence`, e.g. `src/commit-presence/port.ts` + a
// `GitCommitPresence` adapter) wired through the composition root — never
// inlined into the pure `src/domain/decision-queue.ts` projection.
// ---------------------------------------------------------------------------

interface FakeCommitPresenceSource {
  hasCommits(
    homeDir: string,
    oids: readonly string[],
  ): Promise<readonly boolean[]>;
}

function absentProbe(missingOids: Set<string>): FakeCommitPresenceSource {
  return {
    hasCommits: async (_dir: string, oids: readonly string[]) =>
      oids.map((oid) => !missingOids.has(oid)),
  };
}

/**
 * A probe that reports every OID present, and records each batched call so a
 * test can assert the use case actually consulted the probe on the happy
 * path — not merely that the probe's return value happened to agree with an
 * unconditional fallback.
 */
function presentProbe(): FakeCommitPresenceSource & {
  calls: Array<[string, string]>;
} {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    hasCommits: async (dir: string, oids: readonly string[]) => {
      for (const oid of oids) calls.push([dir, oid]);
      return oids.map(() => true);
    },
  };
}

test("(017-S3-inspect-absent-from-home) a well-formed commitOid absent from the named home yields inspect:null, not merely format-checked", async () => {
  const objective = conflictObjective({
    parentOid: "aaaaaaa",
    commitOid: "bbbbbbb",
  });
  const uc = new GetObjectiveConflict(
    makeSource(objective),
    noThrowBroker("aaaaaaa"),
    resolver(),
    absentProbe(new Set(["bbbbbbb"])),
  );
  const output = await uc.execute({ objectiveId: OBJ_ID });
  assert.equal(
    output.evidence.inspect,
    null,
    "commitOid 'bbbbbbb' is well-formed hex but absent from the home; inspect must still be null",
  );
});

test("(017-S7-no-writes) sources whose write methods throw resolve without ever calling them", async () => {
  const objective = conflictObjective();
  const source: FakeObjectiveSource & { saveObjective(): void } = {
    getObjective: (id: string) => (id === OBJ_ID ? objective : undefined),
    saveObjective: () => {
      throw new Error("must never write");
    },
  };
  const uc = new GetObjectiveConflict(
    source,
    noThrowBroker("aaaaaaa"),
    resolver(),
    presentProbe(),
  );
  await assert.doesNotReject(() => uc.execute({ objectiveId: OBJ_ID }));
});

// ---------------------------------------------------------------------------
// Review blocker S3-batch — the commit-presence port is widening to
// `hasCommits(homeDir, oids): Promise<readonly boolean[]>` (one batched call
// per homeDir, same-length same-order result — never a Set keyed on request
// strings). `GetObjectiveConflict` must keep working against that batched
// shape: it needs presence for exactly `[parentOid, commitOid]`, in ONE
// call, and the positional result must still gate `inspect` exactly as it
// does today against the scalar port.
// ---------------------------------------------------------------------------

interface FakeBatchedCommitPresenceSource {
  hasCommits(
    homeDir: string,
    oids: readonly string[],
  ): Promise<readonly boolean[]>;
}

function batchedProbe(
  absentOids: Set<string> = new Set(),
): FakeBatchedCommitPresenceSource & {
  calls: Array<{ homeDir: string; oids: readonly string[] }>;
} {
  const calls: Array<{ homeDir: string; oids: readonly string[] }> = [];
  return {
    calls,
    hasCommits: async (homeDir: string, oids: readonly string[]) => {
      calls.push({ homeDir, oids });
      return oids.map((oid) => !absentOids.has(oid));
    },
  };
}

test("(017-S3-batch-objective-conflict) GetObjectiveConflict still resolves a runnable inspect against the batched hasCommits port, in ONE call", async () => {
  const objective = conflictObjective({
    parentOid: "aaaaaaa",
    commitOid: "bbbbbbb",
  });
  const probe = batchedProbe();
  const uc = new GetObjectiveConflict(
    makeSource(objective),
    noThrowBroker("aaaaaaa"),
    resolver(),
    probe,
  );
  const output = await uc.execute({ objectiveId: OBJ_ID });
  assert.deepEqual(output.evidence.inspect, {
    executable: "git",
    args: ["-C", HOME_DIR, "diff", "aaaaaaa..bbbbbbb"],
  });
  assert.equal(
    probe.calls.length,
    1,
    "the two-OID presence check must be ONE batched hasCommits call, not two separate calls",
  );
  assert.deepEqual(probe.calls[0]!.oids, ["aaaaaaa", "bbbbbbb"]);
});

test("(017-S3-batch-objective-conflict-absent) a commitOid the batched probe reports absent still nulls inspect", async () => {
  const objective = conflictObjective({
    parentOid: "aaaaaaa",
    commitOid: "bbbbbbb",
  });
  const probe = batchedProbe(new Set(["bbbbbbb"]));
  const uc = new GetObjectiveConflict(
    makeSource(objective),
    noThrowBroker("aaaaaaa"),
    resolver(),
    probe,
  );
  const output = await uc.execute({ objectiveId: OBJ_ID });
  assert.equal(output.evidence.inspect, null);
});

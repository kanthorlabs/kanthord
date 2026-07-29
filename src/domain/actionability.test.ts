import { test } from "node:test";
import assert from "node:assert/strict";
import { TASK_STATUSES } from "./task.ts";
import { OBJECTIVE_STATUSES } from "./initiative.ts";
import {
  nodeAction,
  groupAction,
  initiativeAction,
  decisionActions,
  decisionKindLabel,
  type Action,
  type ActionKind,
  type NodeActionFacts,
  type GroupActionFacts,
  type InitiativeActionFacts,
  type DecisionContext,
  type DecisionKindLabel,
} from "./actionability.ts";

// ---------------------------------------------------------------------------
// nodeAction — exhaustive
// ---------------------------------------------------------------------------

test("nodeAction: exhaustive over all six TASK_STATUSES with objective building, blockedForever false, deadDependencyId null", () => {
  const expectedKind: Record<string, ActionKind | null> = {
    pending: null,
    running: null,
    completed: null,
    failed: "retry",
    awaiting_confirmation: "approve",
    discarded: null,
  };
  for (const status of TASK_STATUSES) {
    const facts: NodeActionFacts = {
      taskId: "task-1",
      status,
      objectiveId: "obj-1",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    };
    const action = nodeAction(facts);
    if (expectedKind[status] === null) {
      assert.equal(action, null, `nodeAction(${status}) must be null`);
    } else {
      assert.ok(action !== null, `nodeAction(${status}) must not be null`);
      assert.equal(
        action.kind,
        expectedKind[status],
        `nodeAction(${status}) must produce kind ${expectedKind[status]}`,
      );
      // For exhaustive cases the target must be the task itself
      assert.equal(action.target.type, "task");
      assert.equal(action.target.id, "task-1");
    }
  }
});

test("nodeAction: running is always null even when objective is awaiting_confirmation", () => {
  const facts: NodeActionFacts = {
    taskId: "task-1",
    status: "running",
    objectiveId: "obj-1",
    objectiveStatus: "awaiting_confirmation",
    blockedForever: false,
    deadDependencyId: null,
  };
  // rule 4 requires status === "completed"; running falls through to null
  assert.equal(nodeAction(facts), null);
});

test("nodeAction: discarded is always null even when blockedForever is true", () => {
  const facts: NodeActionFacts = {
    taskId: "task-1",
    status: "discarded",
    objectiveId: "obj-1",
    objectiveStatus: "building",
    blockedForever: true,
    deadDependencyId: "dep-1",
  };
  assert.equal(nodeAction(facts), null);
});

test("nodeAction: completed + objective awaiting_confirmation targets the objective, omits command, and requires expectedCommit", () => {
  const facts: NodeActionFacts = {
    taskId: "task-1",
    status: "completed",
    objectiveId: "obj-42",
    objectiveStatus: "awaiting_confirmation",
    blockedForever: false,
    deadDependencyId: null,
  };
  const action = nodeAction(facts);
  assert.ok(action !== null);
  assert.equal(action.kind, "approve");
  assert.equal(action.target.type, "objective");
  assert.equal(action.target.id, "obj-42");
  assert.deepEqual(action.requiresInput, ["expectedCommit"]);
  assert.equal(
    "command" in action,
    false,
    "approve objective requires --expected-commit, so command must be omitted until it is known",
  );
});

test("nodeAction: completed + objective conflict yields retry targeting the objective, with expectedCommit + note in requiresInput and no command (projection passes expectedCommit null)", () => {
  const facts: NodeActionFacts = {
    taskId: "task-1",
    status: "completed",
    objectiveId: "obj-42",
    objectiveStatus: "conflict",
    blockedForever: false,
    deadDependencyId: null,
  };
  const action = nodeAction(facts);
  assert.ok(action !== null);
  assert.equal(action.kind, "retry");
  assert.equal(action.target.type, "objective");
  assert.equal(action.target.id, "obj-42");
  assert.deepEqual(action.requiresInput, ["expectedCommit", "note"]);
  assert.equal(
    "command" in action,
    false,
    "command must be omitted entirely when expectedCommit is unknown",
  );
});

test("nodeAction: pending + blockedForever + deadDependencyId yields remove-dependency with the dead dep id and a runnable command", () => {
  const facts: NodeActionFacts = {
    taskId: "task-1",
    status: "pending",
    objectiveId: "obj-1",
    objectiveStatus: "building",
    blockedForever: true,
    deadDependencyId: "dep-1",
  };
  const action = nodeAction(facts);
  assert.ok(action !== null);
  assert.equal(action.kind, "remove-dependency");
  assert.equal(action.target.type, "task");
  assert.equal(action.target.id, "task-1");
  assert.equal(action.targetDependencyId, "dep-1");
  assert.deepEqual(action.requiresInput, []);
  assert.equal(
    action.command,
    "remove dependency --task task-1 --dependency dep-1",
  );
});

test("nodeAction: pending + blockedForever + deadDependencyId null falls through to null (cannot name operand)", () => {
  const facts: NodeActionFacts = {
    taskId: "task-1",
    status: "pending",
    objectiveId: "obj-1",
    objectiveStatus: "building",
    blockedForever: true,
    deadDependencyId: null,
  };
  assert.equal(nodeAction(facts), null);
});

test("nodeAction: pending + blockedForever is never kind: reject (reject-task refuses pending — reject-task.ts:86-92)", () => {
  // exhaustively check deadDependencyId non-null cases
  const facts: NodeActionFacts = {
    taskId: "task-1",
    status: "pending",
    objectiveId: "obj-1",
    objectiveStatus: "building",
    blockedForever: true,
    deadDependencyId: "dep-1",
  };
  const action = nodeAction(facts);
  assert.ok(action !== null);
  assert.notEqual(
    action.kind,
    "reject",
    "reject-task refuses pending tasks; offering it is a button that always errors",
  );
});

test("nodeAction: precedence — failed with blockedForever yields retry, not remove-dependency", () => {
  const facts: NodeActionFacts = {
    taskId: "task-1",
    status: "failed",
    objectiveId: "obj-1",
    objectiveStatus: "building",
    blockedForever: true,
    deadDependencyId: "dep-1",
  };
  const action = nodeAction(facts);
  assert.ok(action !== null);
  assert.equal(
    action.kind,
    "retry",
    "rule 1 (failed) outranks rule 3 (pending + blockedForever)",
  );
  assert.equal(action.target.type, "task");
  assert.equal(action.target.id, "task-1");
  assert.equal(action.command, "retry task --id task-1");
});

// ---------------------------------------------------------------------------
// groupAction — exhaustive + targeted
// ---------------------------------------------------------------------------

test("groupAction: exhaustive over all five OBJECTIVE_STATUSES plus undefined — only awaiting_confirmation and conflict are non-null", () => {
  const statuses: Array<GroupActionFacts["status"]> = [
    ...OBJECTIVE_STATUSES,
    undefined,
  ];
  const expectedKind: Record<string, ActionKind | null> = {
    building: null,
    awaiting_confirmation: "approve",
    conflict: "retry",
    integrated: null,
    discarded: null,
    // undefined falls through to the else row, yielding null
  };
  for (const status of statuses) {
    const facts: GroupActionFacts = {
      objectiveId: "obj-1",
      status,
    };
    const action = groupAction(facts);
    const want = expectedKind[status as string] ?? null;
    if (want === null) {
      assert.equal(action, null, `groupAction(${status}) must be null`);
    } else {
      assert.ok(action !== null);
      assert.equal(action.kind, want);
      assert.equal(action.target.type, "objective");
      assert.equal(action.target.id, "obj-1");
    }
  }
});

test("groupAction: awaiting_confirmation returns approve targeting the objective, command omitted through the projection", () => {
  const facts: GroupActionFacts = {
    objectiveId: "obj-1",
    status: "awaiting_confirmation",
  };
  const action = groupAction(facts);
  assert.ok(action !== null);
  assert.equal(action.kind, "approve");
  assert.equal(action.target.type, "objective");
  assert.equal(action.target.id, "obj-1");
  assert.equal(
    "command" in action,
    false,
    "projection passes expectedCommit null so command is omitted",
  );
});

test("groupAction: conflict returns retry targeting the objective, command omitted through the projection", () => {
  const facts: GroupActionFacts = {
    objectiveId: "obj-1",
    status: "conflict",
  };
  const action = groupAction(facts);
  assert.ok(action !== null);
  assert.equal(action.kind, "retry");
  assert.equal(action.target.type, "objective");
  assert.equal(action.target.id, "obj-1");
  assert.equal("command" in action, false);
});

// ---------------------------------------------------------------------------
// decisionActions — direct rule table tests
// ---------------------------------------------------------------------------

test("decisionActions: awaiting_confirmation group with expectedCommit abc yields exactly two actions, kinds [approve, reject], approve command is 'approve objective --id obj-1 --expected-commit abc'", () => {
  const ctx: DecisionContext = {
    node: null,
    group: { objectiveId: "obj-1", status: "awaiting_confirmation" },
    initiative: null,
    expectedCommit: "abc",
  };
  const actions = decisionActions(ctx);
  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.kind, "approve");
  assert.equal(actions[1]?.kind, "reject");
  assert.equal(
    actions[0]?.command,
    "approve objective --id obj-1 --expected-commit abc",
  );
});

test("decisionActions: conflict group with expectedCommit abc yields kinds [retry, reject], retry command is 'retry objective --id obj-1 --expected-commit abc'", () => {
  const ctx: DecisionContext = {
    node: null,
    group: { objectiveId: "obj-1", status: "conflict" },
    initiative: null,
    expectedCommit: "abc",
  };
  const actions = decisionActions(ctx);
  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.kind, "retry");
  assert.equal(actions[1]?.kind, "reject");
  assert.equal(
    actions[0]?.command,
    "retry objective --id obj-1 --expected-commit abc",
  );
});

test("decisionActions: awaiting_confirmation group with expectedCommit null — every action omits command and requiresInput[0] === 'expectedCommit'", () => {
  const ctx: DecisionContext = {
    node: null,
    group: { objectiveId: "obj-1", status: "awaiting_confirmation" },
    initiative: null,
    expectedCommit: null,
  };
  const actions = decisionActions(ctx);
  assert.equal(actions.length, 2);
  for (const a of actions) {
    assert.equal(
      "command" in a,
      false,
      "command must be absent when expectedCommit is unknown",
    );
    assert.equal(
      a.requiresInput[0],
      "expectedCommit",
      "first requiresInput must name the missing operand",
    );
  }
});

test("decisionActions: conflict group with expectedCommit null — every action omits command and requiresInput[0] === 'expectedCommit'", () => {
  const ctx: DecisionContext = {
    node: null,
    group: { objectiveId: "obj-1", status: "conflict" },
    initiative: null,
    expectedCommit: null,
  };
  const actions = decisionActions(ctx);
  assert.equal(actions.length, 2);
  for (const a of actions) {
    assert.equal("command" in a, false);
    assert.equal(a.requiresInput[0], "expectedCommit");
  }
});

// ---------------------------------------------------------------------------
// decisionActions — initiative row
// ---------------------------------------------------------------------------

test("decisionActions: paused initiative yields exactly one action, resume-initiative", () => {
  const ctx: DecisionContext = {
    node: null,
    group: null,
    initiative: {
      initiativeId: "ini-1",
      status: "building",
      paused: true,
      publication: null,
    },
    expectedCommit: null,
  };
  const actions = decisionActions(ctx);
  assert.equal(actions.length, 1);
  const a = actions[0]!;
  assert.equal(a.kind, "resume-initiative");
  assert.equal(a.target.type, "initiative");
  assert.equal(a.target.id, "ini-1");
  assert.deepEqual(a.requiresInput, []);
  assert.equal(a.command, "resume initiative --id ini-1");
});

test("decisionActions: landed initiative with publication diverged yields publish, exact --repository/--branch command", () => {
  const ctx: DecisionContext = {
    node: null,
    group: null,
    initiative: {
      initiativeId: "ini-1",
      status: "landed",
      paused: false,
      publication: {
        repositoryId: "repo-1",
        branch: "main",
        state: "diverged",
      },
    },
    expectedCommit: null,
  };
  const actions = decisionActions(ctx);
  assert.equal(actions.length, 1);
  const a = actions[0]!;
  assert.equal(a.kind, "publish");
  assert.equal(a.target.type, "repository");
  assert.equal(a.target.id, "repo-1");
  assert.equal(
    a.command,
    "publish repository --repository repo-1 --branch main",
  );
});

test("decisionActions: landed initiative with publication published yields no actions", () => {
  const ctx: DecisionContext = {
    node: null,
    group: null,
    initiative: {
      initiativeId: "ini-1",
      status: "landed",
      paused: false,
      publication: {
        repositoryId: "repo-1",
        branch: "main",
        state: "published",
      },
    },
    expectedCommit: null,
  };
  assert.deepEqual(decisionActions(ctx), []);
});

test("decisionActions: building initiative yields no actions regardless of publication", () => {
  const ctx: DecisionContext = {
    node: null,
    group: null,
    initiative: {
      initiativeId: "ini-1",
      status: "building",
      paused: false,
      publication: {
        repositoryId: "repo-1",
        branch: "main",
        state: "unpublished",
      },
    },
    expectedCommit: null,
  };
  assert.deepEqual(decisionActions(ctx), []);
});

test("decisionActions: precedence — paused outranks publish", () => {
  const ctx: DecisionContext = {
    node: null,
    group: null,
    initiative: {
      initiativeId: "ini-1",
      status: "landed",
      paused: true,
      publication: {
        repositoryId: "repo-1",
        branch: "main",
        state: "unpublished",
      },
    },
    expectedCommit: null,
  };
  const actions = decisionActions(ctx);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, "resume-initiative");
});

// ---------------------------------------------------------------------------
// Projection equivalence — table-driven over every rule-table row
// ---------------------------------------------------------------------------

test("projection equivalence: every nodeAction row equals decisionActions(node-only)[0] ?? null", () => {
  const rows: NodeActionFacts[] = [
    // rule 1
    {
      taskId: "t",
      status: "failed",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    // rule 2
    {
      taskId: "t",
      status: "awaiting_confirmation",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    // rule 3
    {
      taskId: "t",
      status: "pending",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: true,
      deadDependencyId: "d",
    },
    // rule 4
    {
      taskId: "t",
      status: "completed",
      objectiveId: "o",
      objectiveStatus: "awaiting_confirmation",
      blockedForever: false,
      deadDependencyId: null,
    },
    // rule 5 (AMENDED: completed + conflict -> retry targeting objective)
    {
      taskId: "t",
      status: "completed",
      objectiveId: "o",
      objectiveStatus: "conflict",
      blockedForever: false,
      deadDependencyId: null,
    },
    // else: null
    {
      taskId: "t",
      status: "pending",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    {
      taskId: "t",
      status: "running",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    {
      taskId: "t",
      status: "discarded",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
  ];
  for (const f of rows) {
    const projected = nodeAction(f);
    const tableDriven =
      decisionActions({
        node: f,
        group: null,
        initiative: null,
        expectedCommit: null,
      })[0] ?? null;
    assert.deepEqual(
      projected,
      tableDriven,
      `nodeAction vs decisionActions disagreement for status=${f.status}, objectiveStatus=${f.objectiveStatus}, blockedForever=${f.blockedForever}, deadDependencyId=${f.deadDependencyId}`,
    );
  }
});

test("projection equivalence: every groupAction row equals decisionActions(group-only)[0] ?? null", () => {
  const rows: GroupActionFacts[] = [
    { objectiveId: "o", status: "building" },
    { objectiveId: "o", status: "awaiting_confirmation" },
    { objectiveId: "o", status: "conflict" },
    { objectiveId: "o", status: "integrated" },
    { objectiveId: "o", status: "discarded" },
    { objectiveId: "o", status: undefined },
  ];
  for (const f of rows) {
    const projected = groupAction(f);
    const tableDriven =
      decisionActions({
        node: null,
        group: f,
        initiative: null,
        expectedCommit: null,
      })[0] ?? null;
    assert.deepEqual(
      projected,
      tableDriven,
      `groupAction vs decisionActions disagreement for status=${f.status}`,
    );
  }
});

test("projection equivalence: every initiativeAction row equals decisionActions(initiative-only)[0] ?? null", () => {
  const rows: InitiativeActionFacts[] = [
    // rule 1: paused
    { initiativeId: "i", status: "building", paused: true, publication: null },
    { initiativeId: "i", status: "landed", paused: true, publication: null },
    // precedence: paused outranks publish
    {
      initiativeId: "i",
      status: "landed",
      paused: true,
      publication: { repositoryId: "r", branch: "b", state: "unpublished" },
    },
    // rule 2: landed + unpublished/diverged
    {
      initiativeId: "i",
      status: "landed",
      paused: false,
      publication: { repositoryId: "r", branch: "b", state: "unpublished" },
    },
    {
      initiativeId: "i",
      status: "landed",
      paused: false,
      publication: { repositoryId: "r", branch: "b", state: "diverged" },
    },
    // rule 3: else -> null
    {
      initiativeId: "i",
      status: "landed",
      paused: false,
      publication: { repositoryId: "r", branch: "b", state: "published" },
    },
    {
      initiativeId: "i",
      status: "building",
      paused: false,
      publication: { repositoryId: "r", branch: "b", state: "unpublished" },
    },
    { initiativeId: "i", status: "building", paused: false, publication: null },
    {
      initiativeId: "i",
      status: "discarded",
      paused: false,
      publication: null,
    },
  ];
  for (const f of rows) {
    const projected = initiativeAction(f);
    const tableDriven =
      decisionActions({
        node: null,
        group: null,
        initiative: f,
        expectedCommit: null,
      })[0] ?? null;
    assert.deepEqual(
      projected,
      tableDriven,
      `initiativeAction vs decisionActions disagreement for status=${f.status}, paused=${f.paused}, publication=${JSON.stringify(f.publication)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// initiativeAction — full table
// ---------------------------------------------------------------------------

test("initiativeAction: paused true → resume-initiative (asserted for status building and landed)", () => {
  for (const status of ["building", "landed"] as const) {
    const facts: InitiativeActionFacts = {
      initiativeId: "ini-1",
      status,
      paused: true,
      publication: null,
    };
    const action = initiativeAction(facts);
    assert.ok(action !== null);
    assert.equal(action.kind, "resume-initiative");
    assert.equal(action.target.type, "initiative");
    assert.equal(action.target.id, "ini-1");
    assert.equal(action.command, "resume initiative --id ini-1");
  }
});

test("initiativeAction: precedence — paused true + landed + unpublished → resume-initiative, not publish", () => {
  const facts: InitiativeActionFacts = {
    initiativeId: "ini-1",
    status: "landed",
    paused: true,
    publication: {
      repositoryId: "repo-1",
      branch: "main",
      state: "unpublished",
    },
  };
  const action = initiativeAction(facts);
  assert.ok(action !== null);
  assert.equal(action.kind, "resume-initiative");
});

test("initiativeAction: landed + publication unpublished → publish, exact --repository/--branch command", () => {
  const facts: InitiativeActionFacts = {
    initiativeId: "ini-1",
    status: "landed",
    paused: false,
    publication: {
      repositoryId: "repo-1",
      branch: "main",
      state: "unpublished",
    },
  };
  const action = initiativeAction(facts);
  assert.ok(action !== null);
  assert.equal(action.kind, "publish");
  assert.equal(action.target.type, "repository");
  assert.equal(action.target.id, "repo-1");
  assert.equal(
    action.command,
    "publish repository --repository repo-1 --branch main",
  );
});

test("initiativeAction: landed + publication diverged → publish", () => {
  const facts: InitiativeActionFacts = {
    initiativeId: "ini-1",
    status: "landed",
    paused: false,
    publication: {
      repositoryId: "repo-1",
      branch: "main",
      state: "diverged",
    },
  };
  const action = initiativeAction(facts);
  assert.ok(action !== null);
  assert.equal(action.kind, "publish");
});

test("initiativeAction: landed + publication published → null", () => {
  const facts: InitiativeActionFacts = {
    initiativeId: "ini-1",
    status: "landed",
    paused: false,
    publication: { repositoryId: "repo-1", branch: "main", state: "published" },
  };
  assert.equal(initiativeAction(facts), null);
});

test("initiativeAction: building + publication unpublished → null", () => {
  const facts: InitiativeActionFacts = {
    initiativeId: "ini-1",
    status: "building",
    paused: false,
    publication: {
      repositoryId: "repo-1",
      branch: "main",
      state: "unpublished",
    },
  };
  assert.equal(initiativeAction(facts), null);
});

test("initiativeAction: publication null → null", () => {
  const facts: InitiativeActionFacts = {
    initiativeId: "ini-1",
    status: "landed",
    paused: false,
    publication: null,
  };
  assert.equal(initiativeAction(facts), null);
});

// ---------------------------------------------------------------------------
// Closed vocabulary — six kinds, no resolve-conflict
// ---------------------------------------------------------------------------

test("closed vocabulary: every Action kind returned by the three functions is in the six-kind literal, and the literal contains no 'resolve-conflict'", () => {
  const EXPECTED_KINDS: ActionKind[] = [
    "retry",
    "approve",
    "reject",
    "publish",
    "resume-initiative",
    "remove-dependency",
  ];
  assert.equal(EXPECTED_KINDS.length, 6, "exactly six kinds");
  assert.ok(
    !EXPECTED_KINDS.includes("resolve-conflict" as ActionKind),
    "the literal must not contain 'resolve-conflict'",
  );

  // Sweep every rule row through the three functions and collect the kinds.
  const allActions: Action[] = [];

  // nodeAction sweep
  const nodeRows: NodeActionFacts[] = [
    {
      taskId: "t",
      status: "failed",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    {
      taskId: "t",
      status: "awaiting_confirmation",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    {
      taskId: "t",
      status: "pending",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: true,
      deadDependencyId: "d",
    },
    {
      taskId: "t",
      status: "completed",
      objectiveId: "o",
      objectiveStatus: "awaiting_confirmation",
      blockedForever: false,
      deadDependencyId: null,
    },
    {
      taskId: "t",
      status: "completed",
      objectiveId: "o",
      objectiveStatus: "conflict",
      blockedForever: false,
      deadDependencyId: null,
    },
    {
      taskId: "t",
      status: "pending",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    {
      taskId: "t",
      status: "running",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    {
      taskId: "t",
      status: "discarded",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
  ];
  for (const f of nodeRows) {
    const a = nodeAction(f);
    if (a !== null) allActions.push(a);
  }

  // groupAction sweep
  const groupRows: GroupActionFacts[] = [
    { objectiveId: "o", status: "building" },
    { objectiveId: "o", status: "awaiting_confirmation" },
    { objectiveId: "o", status: "conflict" },
    { objectiveId: "o", status: "integrated" },
    { objectiveId: "o", status: "discarded" },
  ];
  for (const f of groupRows) {
    const a = groupAction(f);
    if (a !== null) allActions.push(a);
  }

  // initiativeAction sweep
  const initiativeRows: InitiativeActionFacts[] = [
    { initiativeId: "i", status: "building", paused: true, publication: null },
    {
      initiativeId: "i",
      status: "landed",
      paused: false,
      publication: { repositoryId: "r", branch: "b", state: "unpublished" },
    },
    {
      initiativeId: "i",
      status: "landed",
      paused: false,
      publication: { repositoryId: "r", branch: "b", state: "diverged" },
    },
  ];
  for (const f of initiativeRows) {
    const a = initiativeAction(f);
    if (a !== null) allActions.push(a);
  }

  // also sweep decisionActions with expectedCommit to include the `reject` kind
  const ctxs: DecisionContext[] = [
    {
      node: null,
      group: { objectiveId: "o", status: "awaiting_confirmation" },
      initiative: null,
      expectedCommit: "abc",
    },
    {
      node: null,
      group: { objectiveId: "o", status: "conflict" },
      initiative: null,
      expectedCommit: "abc",
    },
  ];
  for (const c of ctxs) {
    for (const a of decisionActions(c)) allActions.push(a);
  }

  assert.ok(
    allActions.length > 0,
    "sweep should have produced at least one action",
  );
  for (const a of allActions) {
    assert.ok(
      EXPECTED_KINDS.includes(a.kind),
      `action kind '${a.kind}' is not in the closed vocabulary`,
    );
  }
});

// ---------------------------------------------------------------------------
// Story 4 — task-level reject producer + decisionKindLabel
// ---------------------------------------------------------------------------

test("(017-S4-failure-verdicts) decisionActions: a failed node yields kinds [retry, reject], retry command 'retry task --id t'", () => {
  const ctx: DecisionContext = {
    node: {
      taskId: "t",
      status: "failed",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    group: null,
    initiative: null,
    expectedCommit: null,
  };
  const actions = decisionActions(ctx);
  assert.deepEqual(
    actions.map((a) => a.kind),
    ["retry", "reject"],
  );
  assert.equal(actions[0]?.command, "retry task --id t");
});

test("(017-S4-failed-reject-has-yes) decisionActions: the failed node's reject action ends with --resolution discard --yes and requires only reason", () => {
  const ctx: DecisionContext = {
    node: {
      taskId: "t",
      status: "failed",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    group: null,
    initiative: null,
    expectedCommit: null,
  };
  const actions = decisionActions(ctx);
  const reject = actions[1];
  assert.ok(reject !== undefined);
  assert.equal(reject.kind, "reject");
  assert.equal(reject.target.type, "task");
  assert.equal(reject.target.id, "t");
  assert.deepEqual(reject.requiresInput, ["reason"]);
  assert.equal(reject.command, "reject task --id t --resolution discard --yes");
});

test("(017-S4-awaiting-task-reject-no-command) decisionActions: an awaiting_confirmation node's reject action omits command and requires resolution + reason", () => {
  const ctx: DecisionContext = {
    node: {
      taskId: "t",
      status: "awaiting_confirmation",
      objectiveId: "o",
      objectiveStatus: "building",
      blockedForever: false,
      deadDependencyId: null,
    },
    group: null,
    initiative: null,
    expectedCommit: null,
  };
  const actions = decisionActions(ctx);
  assert.deepEqual(
    actions.map((a) => a.kind),
    ["approve", "reject"],
  );
  const reject = actions[1];
  assert.ok(reject !== undefined);
  assert.equal(reject.target.type, "task");
  assert.equal(reject.target.id, "t");
  assert.deepEqual(reject.requiresInput, ["resolution", "reason"]);
  assert.equal(
    "command" in reject,
    false,
    "reject on an awaiting_confirmation task has a genuine human choice of --resolution, so no command can be printed",
  );
});

test("(017-S4-kind-labels) decisionKindLabel: each of the five labels is produced by its condition, and null otherwise", () => {
  const cases: Array<{ ctx: DecisionContext; want: DecisionKindLabel | null }> =
    [
      {
        ctx: {
          node: {
            taskId: "t",
            status: "awaiting_confirmation",
            objectiveId: "o",
            objectiveStatus: "building",
            blockedForever: false,
            deadDependencyId: null,
          },
          group: null,
          initiative: null,
          expectedCommit: null,
        },
        want: "task-review",
      },
      {
        ctx: {
          node: {
            taskId: "t",
            status: "failed",
            objectiveId: "o",
            objectiveStatus: "building",
            blockedForever: false,
            deadDependencyId: null,
          },
          group: null,
          initiative: null,
          expectedCommit: null,
        },
        want: "operational-failure",
      },
      {
        ctx: {
          node: null,
          group: { objectiveId: "o", status: "conflict" },
          initiative: null,
          expectedCommit: null,
        },
        want: "objective-conflict",
      },
      {
        ctx: {
          node: null,
          group: { objectiveId: "o", status: "awaiting_confirmation" },
          initiative: null,
          expectedCommit: null,
        },
        want: "objective-candidate",
      },
      {
        ctx: {
          node: null,
          group: null,
          initiative: {
            initiativeId: "i",
            status: "landed",
            paused: false,
            publication: {
              repositoryId: "r",
              branch: "b",
              state: "unpublished",
            },
          },
          expectedCommit: null,
        },
        want: "publication",
      },
      {
        ctx: {
          node: {
            taskId: "t",
            status: "pending",
            objectiveId: "o",
            objectiveStatus: "building",
            blockedForever: false,
            deadDependencyId: null,
          },
          group: null,
          initiative: null,
          expectedCommit: null,
        },
        want: null,
      },
    ];
  for (const { ctx, want } of cases) {
    assert.equal(
      decisionKindLabel(ctx),
      want,
      `decisionKindLabel mismatch for ${JSON.stringify(ctx)}`,
    );
  }
});

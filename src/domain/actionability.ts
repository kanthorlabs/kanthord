import type { TaskStatus } from "./task.ts";
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";

// ---------------------------------------------------------------------------
// Action shape — the closed vocabulary and the only object `decisionActions`
// (and the three projections below) may return.
// ---------------------------------------------------------------------------

export type ActionKind =
  | "retry"
  | "approve"
  | "reject"
  | "publish"
  | "resume-initiative"
  | "remove-dependency";

export interface ActionTarget {
  type: "task" | "objective" | "repository" | "initiative";
  id: string;
}

export interface Action {
  kind: ActionKind;
  target: ActionTarget;
  /** Second operand, e.g. the dead dependency `remove-dependency` must drop. */
  targetDependencyId?: string;
  requiresInput: string[];
  /** Present ONLY when every value is already known. */
  command?: string;
}

// ---------------------------------------------------------------------------
// Facts carried into the rule table. Each projection supplies only its own
// facts; the others stay null.
// ---------------------------------------------------------------------------

export interface NodeActionFacts {
  taskId: string;
  status: TaskStatus;
  objectiveId: string;
  objectiveStatus: ObjectiveStatus | undefined;
  blockedForever: boolean;
  /** First dependency whose edge can never clear, else null. */
  deadDependencyId: string | null;
}

export interface GroupActionFacts {
  objectiveId: string;
  status: ObjectiveStatus | undefined;
}

export interface InitiativeActionFacts {
  initiativeId: string;
  status: InitiativeStatus | undefined;
  paused: boolean;
  publication: {
    repositoryId: string;
    branch: string;
    state: "unpublished" | "published" | "diverged";
  } | null;
}

export interface DecisionContext {
  node: NodeActionFacts | null;
  group: GroupActionFacts | null;
  initiative: InitiativeActionFacts | null;
  /**
   * The objective's candidate OID. EPIC 012 makes `--expected-commit` REQUIRED
   * on every objective verdict, so an objective command is only complete when
   * this is known. The three projections below always pass `null`, because
   * their facts types do not carry it.
   */
  expectedCommit: string | null;
}

// ---------------------------------------------------------------------------
// Internal builders. Each `command` is the CLI invocation WITHOUT the
// `kanthord ` prefix and WITHOUT `--json`.
// `command` and `targetDependencyId` are OMITTED entirely when absent — never
// set to undefined — so that `"command" in action` is `false` for actions that
// need a missing operand.
// ---------------------------------------------------------------------------

function actionRetryTask(taskId: string): Action {
  return {
    kind: "retry",
    target: { type: "task", id: taskId },
    requiresInput: [],
    command: `retry task --id ${taskId}`,
  };
}

function actionApproveTask(taskId: string): Action {
  return {
    kind: "approve",
    target: { type: "task", id: taskId },
    requiresInput: [],
    command: `approve task --id ${taskId}`,
  };
}

function actionRemoveDependency(
  taskId: string,
  deadDependencyId: string,
): Action {
  return {
    kind: "remove-dependency",
    target: { type: "task", id: taskId },
    targetDependencyId: deadDependencyId,
    requiresInput: [],
    command: `remove dependency --task ${taskId} --dependency ${deadDependencyId}`,
  };
}

function actionApproveObjectiveViaNode(objectiveId: string): Action {
  // The node-scoped approve of an awaiting_confirmation objective never
  // knows the candidate OID, and `approve objective` requires
  // `--expected-commit`, so a command here would always fail. Match the
  // group row 1 shape: omit `command` and require `expectedCommit`.
  return {
    kind: "approve",
    target: { type: "objective", id: objectiveId },
    requiresInput: ["expectedCommit"],
  };
}

function actionApproveObjectiveFromGroup(
  objectiveId: string,
  expectedCommit: string | null,
): Action {
  if (expectedCommit === null) {
    return {
      kind: "approve",
      target: { type: "objective", id: objectiveId },
      requiresInput: ["expectedCommit"],
    };
  }
  return {
    kind: "approve",
    target: { type: "objective", id: objectiveId },
    requiresInput: [],
    command: `approve objective --id ${objectiveId} --expected-commit ${expectedCommit}`,
  };
}

function actionRetryObjectiveFromGroup(
  objectiveId: string,
  expectedCommit: string | null,
): Action {
  if (expectedCommit === null) {
    return {
      kind: "retry",
      target: { type: "objective", id: objectiveId },
      requiresInput: ["expectedCommit", "note"],
    };
  }
  return {
    kind: "retry",
    target: { type: "objective", id: objectiveId },
    requiresInput: ["note"],
    command: `retry objective --id ${objectiveId} --expected-commit ${expectedCommit}`,
  };
}

function actionRejectObjectiveFromGroup(
  objectiveId: string,
  expectedCommit: string | null,
): Action {
  if (expectedCommit === null) {
    return {
      kind: "reject",
      target: { type: "objective", id: objectiveId },
      requiresInput: ["expectedCommit", "reason"],
    };
  }
  return {
    kind: "reject",
    target: { type: "objective", id: objectiveId },
    requiresInput: ["reason"],
    command: `reject objective --id ${objectiveId} --expected-commit ${expectedCommit} --resolution discard --yes`,
  };
}

function actionResumeInitiative(initiativeId: string): Action {
  return {
    kind: "resume-initiative",
    target: { type: "initiative", id: initiativeId },
    requiresInput: [],
    command: `resume initiative --id ${initiativeId}`,
  };
}

function actionPublishRepository(repositoryId: string, branch: string): Action {
  return {
    kind: "publish",
    target: { type: "repository", id: repositoryId },
    requiresInput: [],
    command: `publish repository --repository ${repositoryId} --branch ${branch}`,
  };
}

// ---------------------------------------------------------------------------
// Group row — ordered [constructive, destructive]. Returns [] for every
// status outside {awaiting_confirmation, conflict} so the caller can fall
// through to the initiative rules.
// ---------------------------------------------------------------------------

function groupActions(
  objectiveId: string,
  status: ObjectiveStatus | undefined,
  expectedCommit: string | null,
): Action[] {
  if (status === "awaiting_confirmation") {
    return [
      actionApproveObjectiveFromGroup(objectiveId, expectedCommit),
      actionRejectObjectiveFromGroup(objectiveId, expectedCommit),
    ];
  }
  if (status === "conflict") {
    return [
      actionRetryObjectiveFromGroup(objectiveId, expectedCommit),
      actionRejectObjectiveFromGroup(objectiveId, expectedCommit),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Initiative row — paused outranks publish.
// ---------------------------------------------------------------------------

function initiativeActions(initiative: InitiativeActionFacts): Action[] {
  if (initiative.paused === true) {
    return [actionResumeInitiative(initiative.initiativeId)];
  }
  if (
    initiative.status === "landed" &&
    initiative.publication !== null &&
    (initiative.publication.state === "unpublished" ||
      initiative.publication.state === "diverged")
  ) {
    return [
      actionPublishRepository(
        initiative.publication.repositoryId,
        initiative.publication.branch,
      ),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// The single rule table. Node rules are tried first (in the order below);
// failing every node rule, group rules; failing those, initiative rules.
// `nodeAction` / `groupAction` / `initiativeAction` below are one-liner
// projections of this function — see the three `nodeAction`/`groupAction`/
// `initiativeAction` exports at the bottom of the file.
// ---------------------------------------------------------------------------

export function decisionActions(context: DecisionContext): Action[] {
  // -- Node rules --
  if (context.node !== null) {
    const node = context.node;
    // rule 1: failed
    if (node.status === "failed") {
      return [actionRetryTask(node.taskId)];
    }
    // rule 2: awaiting_confirmation
    if (node.status === "awaiting_confirmation") {
      return [actionApproveTask(node.taskId)];
    }
    // rule 3: pending + blockedForever + deadDependencyId
    if (
      node.status === "pending" &&
      node.blockedForever === true &&
      node.deadDependencyId !== null
    ) {
      return [actionRemoveDependency(node.taskId, node.deadDependencyId)];
    }
    // rule 4: completed + objective awaiting_confirmation
    if (
      node.status === "completed" &&
      node.objectiveStatus === "awaiting_confirmation"
    ) {
      return [actionApproveObjectiveViaNode(node.objectiveId)];
    }
    // rule 5: completed + objective conflict — nodeAction returns the FIRST
    // action of the conflict group, which is the retry.
    if (node.status === "completed" && node.objectiveStatus === "conflict") {
      return groupActions(node.objectiveId, "conflict", context.expectedCommit);
    }
  }

  // -- Group rules --
  if (context.group !== null) {
    const actions = groupActions(
      context.group.objectiveId,
      context.group.status,
      context.expectedCommit,
    );
    if (actions.length > 0) return actions;
  }

  // -- Initiative rules --
  if (context.initiative !== null) {
    const actions = initiativeActions(context.initiative);
    if (actions.length > 0) return actions;
  }

  return [];
}

// ---------------------------------------------------------------------------
// The three projections. Each is the single-expression delegation prescribed
// by the Story — no `if`, no template literal, no second rule table. A second
// rule table inside any of them is caught by the table-driven equivalence
// tests in `actionability.test.ts`.
// ---------------------------------------------------------------------------

export function nodeAction(facts: NodeActionFacts): Action | null {
  return (
    decisionActions({
      node: facts,
      group: null,
      initiative: null,
      expectedCommit: null,
    })[0] ?? null
  );
}

export function groupAction(facts: GroupActionFacts): Action | null {
  return (
    decisionActions({
      node: null,
      group: facts,
      initiative: null,
      expectedCommit: null,
    })[0] ?? null
  );
}

export function initiativeAction(facts: InitiativeActionFacts): Action | null {
  return (
    decisionActions({
      node: null,
      group: null,
      initiative: facts,
      expectedCommit: null,
    })[0] ?? null
  );
}

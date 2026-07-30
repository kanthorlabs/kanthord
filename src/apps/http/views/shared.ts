export interface ActionView {
  readonly kind: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly targetDependencyId?: string;
  readonly requiresInput: readonly string[];
  readonly command?: string;
  readonly [key: string]: unknown;
}

export interface ActionResult {
  readonly kind: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly targetDependencyId?: string;
  readonly requiresInput: readonly string[];
  readonly command?: string;
}

export function actionView(result: ActionResult): ActionView {
  return {
    kind: result.kind,
    target: { type: result.target.type, id: result.target.id },
    ...(result.targetDependencyId !== undefined
      ? { targetDependencyId: result.targetDependencyId }
      : {}),
    requiresInput: [...result.requiresInput],
    ...(result.command !== undefined ? { command: result.command } : {}),
  };
}

export function nullableActionView(
  result: ActionResult | null,
): ActionView | null {
  return result === null ? null : actionView(result);
}

export interface UnsatisfiedEdgeView {
  readonly id: string;
  readonly neverSatisfies: boolean;
  readonly [key: string]: unknown;
}

export function unsatisfiedEdgeView(result: {
  readonly id: string;
  readonly neverSatisfies: boolean;
}): UnsatisfiedEdgeView {
  return { id: result.id, neverSatisfies: result.neverSatisfies };
}

export interface EventView {
  readonly id: string;
  readonly type: string;
  readonly taskId?: string;
  readonly objectiveId?: string;
  readonly initiativeId?: string;
  readonly repositoryId?: string;
  readonly payload?: Record<string, string>;
  readonly [key: string]: unknown;
}

export interface EventResult {
  readonly id: string;
  readonly type: string;
  readonly taskId?: string;
  readonly objectiveId?: string;
  readonly initiativeId?: string;
  readonly repositoryId?: string;
  readonly payload?: Record<string, string>;
}

export function eventView(result: EventResult): EventView {
  return {
    id: result.id,
    type: result.type,
    ...(result.taskId !== undefined ? { taskId: result.taskId } : {}),
    ...(result.objectiveId !== undefined
      ? { objectiveId: result.objectiveId }
      : {}),
    ...(result.initiativeId !== undefined
      ? { initiativeId: result.initiativeId }
      : {}),
    ...(result.repositoryId !== undefined
      ? { repositoryId: result.repositoryId }
      : {}),
    ...(result.payload !== undefined ? { payload: { ...result.payload } } : {}),
  };
}

export type RepositoryAuthView =
  | { readonly kind: "ambient" }
  | { readonly kind: "https-token"; readonly credentialId: string }
  | { readonly kind: "ssh-agent" };

export function repositoryAuthView(auth: {
  readonly kind: string;
  readonly credentialId?: string;
}): RepositoryAuthView {
  if (auth.kind === "https-token" && auth.credentialId !== undefined) {
    return { kind: "https-token", credentialId: auth.credentialId };
  }
  if (auth.kind === "ssh-agent") {
    return { kind: "ssh-agent" };
  }
  return { kind: "ambient" };
}

export interface TaskResultView {
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly baseCommit: string | null;
  readonly proposalCommit: string | null;
  readonly commitSha: string | null;
  readonly summary: string | null;
  readonly reason: string | null;
  readonly rejectionResolution: string | null;
  readonly rejectionReason: string | null;
  readonly evidence: ReadonlyArray<{
    readonly command: string;
    readonly exitCode: number;
    readonly output: string;
  }> | null;
  readonly [key: string]: unknown;
}

export function taskResultView(result: {
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly baseCommit: string | null;
  readonly proposalCommit: string | null;
  readonly commitSha: string | null;
  readonly summary: string | null;
  readonly reason: string | null;
  readonly rejectionResolution: string | null;
  readonly rejectionReason: string | null;
  readonly evidence: ReadonlyArray<{
    readonly command: string;
    readonly exitCode: number;
    readonly output: string;
  }> | null;
}): TaskResultView {
  return {
    workspace: result.workspace,
    branch: result.branch,
    baseCommit: result.baseCommit,
    proposalCommit: result.proposalCommit,
    commitSha: result.commitSha,
    summary: result.summary,
    reason: result.reason,
    rejectionResolution: result.rejectionResolution,
    rejectionReason: result.rejectionReason,
    evidence:
      result.evidence === null
        ? null
        : result.evidence.map((e) => ({
            command: e.command,
            exitCode: e.exitCode,
            output: e.output,
          })),
  };
}

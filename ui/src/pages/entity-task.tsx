// Story 01 — EntityTaskPage: reads params, uses chain hook, renders workspace.
// Story 05 — five tabs: Summary, Instructions & AC, Dependencies, Result, Landing.
import type { ReactElement } from "react";
import { useParams, Link } from "react-router-dom";

import { useTaskChain } from "@/app/entity-chain";
import { ActionInventory } from "@/components/action-inventory";
import { EntityWorkspace } from "@/components/entity-workspace";
import { EntityStatus } from "@/lib/status-display";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
  TableBody,
} from "@/components/ui/table";
import { siblingTaskHref } from "@/lib/entity-scope";

// --- DependencyId (decision 6: link only when in same objective) ---

function DependencyId({
  id,
  projectId,
  initiativeId,
  objectiveId,
  siblingIds,
}: {
  readonly id: string;
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly siblingIds: readonly string[] | undefined;
}): ReactElement {
  const href = siblingTaskHref({
    projectId,
    initiativeId,
    objectiveId,
    taskId: id,
    siblingIds,
  });
  return href === null ? (
    <code data-testid="dependency-id" data-task-id={id}>
      {id}
    </code>
  ) : (
    <Link data-testid="dependency-id" data-task-id={id} to={href}>
      <code>{id}</code>
    </Link>
  );
}

// --- Summary panel ---

function TaskSummary({
  task,
  projectId,
  initiativeId,
  objectiveId,
  siblingIds,
}: {
  readonly task: NonNullable<ReturnType<typeof useTaskChain>["task"]>;
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly siblingIds: readonly string[] | undefined;
}): ReactElement {
  return (
    <>
      <dl>
        <dt className="font-medium">Status</dt>
        <dd>
          <EntityStatus axis="task" value={task.status} />
        </dd>

        <dt className="font-medium">Agent</dt>
        <dd>
          {task.agent !== undefined ? (
            <span data-testid="task-agent">{task.agent}</span>
          ) : (
            <span data-testid="empty-agent">Not specified.</span>
          )}
        </dd>

        <dt className="font-medium">Note</dt>
        <dd>
          {task.note !== undefined ? (
            <p data-testid="task-note">{task.note}</p>
          ) : (
            <span data-testid="empty-task-note">Not specified.</span>
          )}
        </dd>

        <dt className="font-medium">Downstream</dt>
        <dd>
          <span data-testid="task-downstream">{task.downstream}</span>
        </dd>
      </dl>

      {task.abandoning === true && (
        <p data-testid="task-abandoning">
          This task is being abandoned. Its run is revoked but the status is
          still {task.status}.
        </p>
      )}

      {task.blockedForever === true && (
        <section data-testid="task-blocked-forever">
          <p>
            This task can never run: at least one dependency will never be
            satisfied.
          </p>
          {task.waiting
            .filter((w) => w.neverSatisfies)
            .map((w) => (
              <DependencyId
                key={w.id}
                id={w.id}
                projectId={projectId}
                initiativeId={initiativeId}
                objectiveId={objectiveId}
                siblingIds={siblingIds}
              />
            ))}
        </section>
      )}

      <ActionInventory action={task.action} />
    </>
  );
}

// --- Instructions & AC panel ---

function TaskInstructions({
  task,
}: {
  readonly task: NonNullable<ReturnType<typeof useTaskChain>["task"]>;
}): ReactElement {
  const hasAc = task.ac !== undefined && task.ac.length > 0;
  const hasVerification =
    task.verification !== undefined && task.verification.length > 0;
  const hasContext =
    task.context !== undefined && Object.keys(task.context).length > 0;

  return (
    <>
      <section>
        <h3 className="font-medium">Instructions</h3>
        {task.instructions !== undefined ? (
          <pre data-testid="task-instructions">{task.instructions}</pre>
        ) : (
          <p data-testid="empty-instructions">Not specified.</p>
        )}
      </section>

      <section>
        <h3 className="font-medium">Acceptance criteria</h3>
        {hasAc ? (
          <ul data-testid="task-ac">
            {task.ac!.map((entry, i) => (
              <li key={i}>{entry}</li>
            ))}
          </ul>
        ) : (
          <p data-testid="empty-ac">Not specified.</p>
        )}
      </section>

      <section>
        <h3 className="font-medium">Verification</h3>
        {hasVerification ? (
          <ul data-testid="task-verification">
            {task.verification!.map((entry, i) => (
              <li key={i}>{entry}</li>
            ))}
          </ul>
        ) : (
          <p data-testid="empty-verification">Not specified.</p>
        )}
      </section>

      <section>
        <h3 className="font-medium">Context</h3>
        {hasContext ? (
          <dl data-testid="task-context">
            {Object.keys(task.context!).map((key) => (
              <div key={key}>
                <dt className="font-medium">{key}</dt>
                <dd>{task.context![key]}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p data-testid="empty-context">Not specified.</p>
        )}
      </section>
    </>
  );
}

// --- Dependencies panel ---

function TaskDependencies({
  task,
  projectId,
  initiativeId,
  objectiveId,
  siblingIds,
}: {
  readonly task: NonNullable<ReturnType<typeof useTaskChain>["task"]>;
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly siblingIds: readonly string[] | undefined;
}): ReactElement {
  const hasDeps =
    task.dependencyStatus !== undefined && task.dependencyStatus.length > 0;

  return (
    <>
      <section data-testid="task-dependency-status">
        {hasDeps ? (
          <Table data-testid="dependency-table">
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {task.dependencyStatus!.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <DependencyId
                      id={d.id}
                      projectId={projectId}
                      initiativeId={initiativeId}
                      objectiveId={objectiveId}
                      siblingIds={siblingIds}
                    />
                  </TableCell>
                  <TableCell>
                    <EntityStatus axis="task" value={d.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p data-testid="empty-task-dependencies">No dependencies.</p>
        )}
      </section>

      <section data-testid="task-waiting">
        {task.waiting.length === 0 ? (
          <p data-testid="empty-waiting">Nothing is blocking this task.</p>
        ) : (
          task.waiting.map((w) => (
            <div key={w.id}>
              <DependencyId
                id={w.id}
                projectId={projectId}
                initiativeId={initiativeId}
                objectiveId={objectiveId}
                siblingIds={siblingIds}
              />
              {w.neverSatisfies === true && (
                <p data-testid="waiting-never">
                  This dependency can never be satisfied: it is discarded or
                  permanently blocked.
                </p>
              )}
            </div>
          ))
        )}
      </section>
    </>
  );
}

// --- Result panel ---

function TaskResult({
  task,
}: {
  readonly task: NonNullable<ReturnType<typeof useTaskChain>["task"]>;
}): ReactElement {
  if (task.result === null) {
    return (
      <p data-testid="empty-result">No result yet — this task has not run.</p>
    );
  }

  const r = task.result;
  const evidence =
    r.evidence !== null && r.evidence.length > 0 ? r.evidence : null;

  return (
    <>
      <dl>
        <dt className="font-medium">Workspace</dt>
        <dd>
          <span data-testid="result-workspace">{r.workspace ?? "—"}</span>
        </dd>
        <dt className="font-medium">Branch</dt>
        <dd>
          <span data-testid="result-branch">{r.branch ?? "—"}</span>
        </dd>
        <dt className="font-medium">Base commit</dt>
        <dd>
          <span data-testid="result-base-commit">{r.baseCommit ?? "—"}</span>
        </dd>
        <dt className="font-medium">Proposal commit</dt>
        <dd>
          <span data-testid="result-proposal-commit">
            {r.proposalCommit ?? "—"}
          </span>
        </dd>
        <dt className="font-medium">Commit SHA</dt>
        <dd>
          <span data-testid="result-commit-sha">{r.commitSha ?? "—"}</span>
        </dd>
        <dt className="font-medium">Summary</dt>
        <dd>
          <span data-testid="result-summary">{r.summary ?? "—"}</span>
        </dd>
        <dt className="font-medium">Reason</dt>
        <dd>
          <span data-testid="result-reason">{r.reason ?? "—"}</span>
        </dd>
        <dt className="font-medium">Rejection resolution</dt>
        <dd>
          <span data-testid="result-rejection-resolution">
            {r.rejectionResolution ?? "—"}
          </span>
        </dd>
        <dt className="font-medium">Rejection reason</dt>
        <dd>
          <span data-testid="result-rejection-reason">
            {r.rejectionReason ?? "—"}
          </span>
        </dd>
      </dl>

      {evidence !== null ? (
        evidence.map((e, i) => (
          <section key={i} data-testid="evidence-entry">
            <code data-testid="evidence-command">{e.command}</code>
            <span data-testid="evidence-exit-code">{e.exitCode}</span>
            <pre data-testid="evidence-output">{e.output}</pre>
          </section>
        ))
      ) : (
        <p data-testid="empty-evidence">No evidence recorded.</p>
      )}
    </>
  );
}

// --- Landing panel ---

function TaskLanding({
  task,
}: {
  readonly task: NonNullable<ReturnType<typeof useTaskChain>["task"]>;
}): ReactElement {
  if (task.landingCandidate === null) {
    return <p data-testid="empty-landing">No candidate yet.</p>;
  }

  const lc = task.landingCandidate;
  return (
    <dl>
      <dt className="font-medium">State</dt>
      <dd>
        <span data-testid="landing-state">{lc.state}</span>
      </dd>
      <dt className="font-medium">Base SHA</dt>
      <dd>
        <code data-testid="landing-base-sha">{lc.baseSHA}</code>
      </dd>
      <dt className="font-medium">Candidate SHA</dt>
      <dd>
        <code data-testid="landing-candidate-sha">{lc.candidateSHA}</code>
      </dd>
      <dt className="font-medium">Target</dt>
      <dd>
        <code data-testid="landing-target">{lc.target}</code>
      </dd>
    </dl>
  );
}

// --- page ---

export function EntityTaskPage(): ReactElement {
  const { projectId, initiativeId, objectiveId, taskId } = useParams<{
    projectId: string;
    initiativeId: string;
    objectiveId: string;
    taskId: string;
  }>();
  const { gate, task, segments, siblingTaskIds } = useTaskChain({
    projectId: projectId!,
    initiativeId: initiativeId!,
    objectiveId: objectiveId!,
    taskId: taskId!,
  });

  const tabs =
    task !== undefined
      ? [
          {
            value: "summary",
            label: "Summary",
            panel: (
              <TaskSummary
                task={task}
                projectId={projectId!}
                initiativeId={initiativeId!}
                objectiveId={objectiveId!}
                siblingIds={siblingTaskIds}
              />
            ),
          },
          {
            value: "instructions",
            label: "Instructions & AC",
            panel: <TaskInstructions task={task} />,
          },
          {
            value: "dependencies",
            label: "Dependencies",
            panel: (
              <TaskDependencies
                task={task}
                projectId={projectId!}
                initiativeId={initiativeId!}
                objectiveId={objectiveId!}
                siblingIds={siblingTaskIds}
              />
            ),
          },
          {
            value: "result",
            label: "Result",
            panel: <TaskResult task={task} />,
          },
          {
            value: "landing",
            label: "Landing",
            panel: <TaskLanding task={task} />,
          },
        ]
      : [];

  return (
    <EntityWorkspace
      projectId={projectId!}
      segments={segments}
      gate={gate}
      kindLabel="Task"
      name={task?.title ?? ""}
      tabs={tabs}
    />
  );
}

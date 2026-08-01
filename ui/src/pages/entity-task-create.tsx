// Story 06 — EntityTaskCreatePage: full-page form for task creation.
// Decision 8: full-page form, not a Sheet.
// Decision 9: task create body contracts — no `paused`, no `after`.
import type { ReactElement } from "react";
import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useObjectiveChain } from "@/app/entity-chain";
import { AsyncBoundary } from "@/components/async-boundary";
import { ScopeMismatch } from "@/components/scope-mismatch";
import { ProjectShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ApiError, createTask } from "@/lib/api-client";
import { fetchTasks } from "@/lib/api-client";
import { taskKeys } from "@/lib/query-keys";
import { invalidateFor } from "@/lib/invalidation";
import type { TaskDraft } from "@/lib/task-create-body";
import { EMPTY_TASK_DRAFT, taskCreateBody } from "@/lib/task-create-body";

// --- Ordered list helpers ---

function OrderedListSection({
  label,
  items,
  onAdd,
  onRemove,
  onUp,
  onDown,
  onUpdate,
  containerTestId,
  addTestId,
  buttonPrefix,
  inputId,
}: {
  readonly label: string;
  readonly items: readonly string[];
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly onUp: (index: number) => void;
  readonly onDown: (index: number) => void;
  readonly onUpdate: (index: number, value: string) => void;
  readonly containerTestId: string;
  readonly addTestId: string;
  readonly buttonPrefix: string;
  readonly inputId: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={addTestId}
          onClick={onAdd}
        >
          Add
        </Button>
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-center gap-2"
          data-testid={containerTestId}
          data-index={i}
        >
          <Input
            data-testid={inputId}
            value={item}
            onChange={(e) => onUpdate(i, e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-testid={`${buttonPrefix}-up`}
            onClick={() => onUp(i)}
            disabled={i === 0}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-testid={`${buttonPrefix}-down`}
            onClick={() => onDown(i)}
            disabled={i === items.length - 1}
          >
            ↓
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-testid={`${buttonPrefix}-remove`}
            onClick={() => onRemove(i)}
          >
            ×
          </Button>
        </div>
      ))}
    </div>
  );
}

// --- Context key-value list ---

function ContextKeyValueSection({
  items,
  onAdd,
  onRemove,
  onUpdateKey,
  onUpdateValue,
}: {
  readonly items: readonly { readonly key: string; readonly value: string }[];
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly onUpdateKey: (index: number, key: string) => void;
  readonly onUpdateValue: (index: number, value: string) => void;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Context</label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="context-add"
          onClick={onAdd}
        >
          Add
        </Button>
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-center gap-2"
          data-testid="context-row"
          data-index={i}
        >
          <Input
            data-testid="context-key"
            placeholder="Key"
            value={item.key}
            onChange={(e) => onUpdateKey(i, e.target.value)}
          />
          <Input
            data-testid="context-value"
            placeholder="Value"
            value={item.value}
            onChange={(e) => onUpdateValue(i, e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-testid="context-remove"
            onClick={() => onRemove(i)}
          >
            ×
          </Button>
        </div>
      ))}
    </div>
  );
}

// --- The page ---

export function EntityTaskCreatePage(): ReactElement {
  const { projectId, initiativeId, objectiveId } = useParams<{
    projectId: string;
    initiativeId: string;
    objectiveId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { gate, segments } = useObjectiveChain({
    projectId: projectId!,
    initiativeId: initiativeId!,
    objectiveId: objectiveId!,
  });

  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Dependency picker: fetch initiative tasks in server order.
  const tasksQuery = useQuery({
    queryKey: taskKeys.list(initiativeId!),
    queryFn: ({ signal }) => fetchTasks(initiativeId!, undefined, { signal }),
    staleTime: Infinity,
  });

  // Gate handling: scope mismatch or missing objective → no form.
  if (gate !== null) {
    return (
      <ProjectShell projectId={projectId!} segments={segments}>
        {gate.kind === "mismatch" ? (
          <ScopeMismatch info={gate.info} />
        ) : (
          <AsyncBoundary
            state={gate.state}
            what={gate.what}
            message={gate.message}
          />
        )}
      </ProjectShell>
    );
  }

  const disabled = draft.title.trim() === "" || submitting;

  const handleAcAdd = () => setDraft((d) => ({ ...d, ac: [...d.ac, ""] }));
  const handleAcRemove = (i: number) =>
    setDraft((d) => ({ ...d, ac: d.ac.filter((_, j) => j !== i) }));
  const handleAcUp = (i: number) => {
    if (i === 0) return;
    setDraft((d) => {
      const arr = [...d.ac];
      [arr[i - 1], arr[i]] = [arr[i]!, arr[i - 1]!];
      return { ...d, ac: arr };
    });
  };
  const handleAcDown = (i: number) =>
    setDraft((d) => {
      if (i >= d.ac.length - 1) return d;
      const arr = [...d.ac];
      [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
      return { ...d, ac: arr };
    });
  const handleAcUpdate = (i: number, value: string) =>
    setDraft((d) => ({ ...d, ac: d.ac.map((v, j) => (j === i ? value : v)) }));

  const handleVerificationAdd = () =>
    setDraft((d) => ({ ...d, verification: [...d.verification, ""] }));
  const handleVerificationRemove = (i: number) =>
    setDraft((d) => ({
      ...d,
      verification: d.verification.filter((_, j) => j !== i),
    }));
  const handleVerificationUp = (i: number) => {
    if (i === 0) return;
    setDraft((d) => {
      const arr = [...d.verification];
      [arr[i - 1], arr[i]] = [arr[i]!, arr[i - 1]!];
      return { ...d, verification: arr };
    });
  };
  const handleVerificationDown = (i: number) =>
    setDraft((d) => {
      if (i >= d.verification.length - 1) return d;
      const arr = [...d.verification];
      [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
      return { ...d, verification: arr };
    });
  const handleVerificationUpdate = (i: number, value: string) =>
    setDraft((d) => ({
      ...d,
      verification: d.verification.map((v, j) => (j === i ? value : v)),
    }));

  const handleContextAdd = () =>
    setDraft((d) => ({
      ...d,
      context: [...d.context, { key: "", value: "" }],
    }));
  const handleContextRemove = (i: number) =>
    setDraft((d) => ({ ...d, context: d.context.filter((_, j) => j !== i) }));
  const handleContextUpdateKey = (i: number, key: string) =>
    setDraft((d) => ({
      ...d,
      context: d.context.map((r, j) => (j === i ? { ...r, key } : r)),
    }));
  const handleContextUpdateValue = (i: number, value: string) =>
    setDraft((d) => ({
      ...d,
      context: d.context.map((r, j) => (j === i ? { ...r, value } : r)),
    }));

  const handleDependencyToggle = (taskId: string) => {
    setDraft((d) => {
      const selected = new Set(d.dependencies);
      if (selected.has(taskId)) {
        selected.delete(taskId);
      } else {
        selected.add(taskId);
      }
      return {
        ...d,
        dependencies: (tasksQuery.data ?? [])
          .filter((t) => selected.has(t.id))
          .map((t) => t.id),
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    const body = taskCreateBody(draft);
    void createTask(objectiveId!, body)
      .then(async (created) => {
        await invalidateFor(queryClient, "task.create", {
          projectId: projectId!,
          initiativeId: initiativeId!,
        });
        navigate(
          `/project/${projectId}/initiative/${initiativeId}/objective/${objectiveId}/task/${created.data.id}`,
        );
      })
      .catch((err) => {
        submittedRef.current = false;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("An unexpected error occurred.");
        }
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  const createPageSegments = [...segments, "New task"];

  return (
    <ProjectShell projectId={projectId!} segments={createPageSegments}>
      <form
        data-testid="create-task-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 max-w-2xl"
      >
        {error !== null && (
          <p data-testid="create-task-error" role="alert" data-role="danger">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="task-title" className="text-sm font-medium">
            Title
          </label>
          <Input
            id="task-title"
            data-testid="task-title"
            required
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="task-instructions" className="text-sm font-medium">
            Instructions
          </label>
          <Textarea
            id="task-instructions"
            data-testid="task-instructions"
            value={draft.instructions}
            onChange={(e) =>
              setDraft((d) => ({ ...d, instructions: e.target.value }))
            }
          />
        </div>

        <OrderedListSection
          label="Acceptance criteria"
          items={draft.ac}
          onAdd={handleAcAdd}
          onRemove={handleAcRemove}
          onUp={handleAcUp}
          onDown={handleAcDown}
          onUpdate={handleAcUpdate}
          containerTestId="ac-row"
          addTestId="ac-add"
          buttonPrefix="ac"
          inputId="ac-input"
        />

        <OrderedListSection
          label="Verification"
          items={draft.verification}
          onAdd={handleVerificationAdd}
          onRemove={handleVerificationRemove}
          onUp={handleVerificationUp}
          onDown={handleVerificationDown}
          onUpdate={handleVerificationUpdate}
          containerTestId="verification-row"
          addTestId="verification-add"
          buttonPrefix="verification"
          inputId="verification-input"
        />

        <ContextKeyValueSection
          items={draft.context}
          onAdd={handleContextAdd}
          onRemove={handleContextRemove}
          onUpdateKey={handleContextUpdateKey}
          onUpdateValue={handleContextUpdateValue}
        />

        <div
          className="flex flex-col gap-2"
          data-testid="task-dependency-picker"
        >
          <label className="text-sm font-medium">Dependencies</label>
          {tasksQuery.data && tasksQuery.data.length > 0 ? (
            tasksQuery.data.map((t) => (
              <label
                key={t.id}
                className="flex items-center gap-2"
                data-testid="task-dependency-option"
                data-task-id={t.id}
              >
                <Checkbox
                  checked={draft.dependencies.includes(t.id)}
                  onCheckedChange={() => handleDependencyToggle(t.id)}
                />
                <span className="text-sm">{t.title}</span>
              </label>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No tasks available.</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="task-agent" className="text-sm font-medium">
            Agent
          </label>
          <Input
            id="task-agent"
            data-testid="task-agent"
            value={draft.agent}
            onChange={(e) => setDraft((d) => ({ ...d, agent: e.target.value }))}
          />
          <p
            data-testid="task-agent-hint"
            className="text-xs text-muted-foreground"
          >
            Free text — the daemon validates the agent name. There is no agent
            list API yet.
          </p>
        </div>

        <Button
          type="submit"
          data-testid="create-task-submit"
          disabled={disabled}
        >
          {submitting ? "Creating…" : "Create task"}
        </Button>
      </form>
    </ProjectShell>
  );
}

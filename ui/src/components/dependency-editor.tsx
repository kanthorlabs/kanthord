// ui/src/components/dependency-editor.tsx — dependency add/remove on all three aggregates.
// Story 07: no If-Match, no useEditSession, no DangerConfirm, no AlertDialog, no toast.

import { useState, useCallback } from "react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ApiError, addDependency, removeDependency } from "@/lib/api-client";
import type { DependencyKind } from "@/lib/api-client";
import { dependencyErrorMessage } from "@/lib/write-errors";

export interface DependencyCandidate {
  readonly id: string;
  readonly label: string;
}

export interface DependencyEditorProps {
  readonly kind: DependencyKind;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly dependencies: readonly string[];
  readonly candidates: readonly DependencyCandidate[];
  readonly labelOf: (id: string) => string;
  readonly onWritten: () => void | Promise<void>;
}

export function DependencyEditor({
  kind,
  sourceId,
  sourceLabel,
  dependencies,
  candidates,
  labelOf,
  onWritten,
}: DependencyEditorProps): ReactElement {
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const options = candidates.filter(
    (c) => c.id !== sourceId && !dependencies.includes(c.id),
  );

  const handleAdd = useCallback(
    async (optionId: string) => {
      setError(null);
      try {
        await addDependency(kind, sourceId, optionId);
        setAddOpen(false);
        await onWritten();
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err);
        } else {
          throw err;
        }
      }
    },
    [kind, sourceId, onWritten],
  );

  const handleRemove = useCallback(
    async (depId: string) => {
      setConfirmingId(null);
      setError(null);
      try {
        await removeDependency(kind, sourceId, depId);
        await onWritten();
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err);
        } else {
          throw err;
        }
      }
    },
    [kind, sourceId, onWritten],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="dependency-add"
            >
              Add dependency
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <div className="flex flex-col gap-1">
              {options.map((opt) => (
                <Button
                  key={opt.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="dependency-option"
                  data-option-id={opt.id}
                  {...(kind === "task" ? { "data-task-id": opt.id } : {})}
                  onClick={() => handleAdd(opt.id)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {dependencies.length > 0 && (
        <ul className="flex flex-col gap-1">
          {dependencies.map((depId) => (
            <li key={depId} className="flex items-center gap-2">
              {confirmingId === depId ? (
                <span
                  data-testid="dependency-remove-confirm"
                  className="flex items-center gap-2"
                >
                  <span>
                    Remove {labelOf(depId)} from {sourceLabel}?
                  </span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRemove(depId)}
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="dependency-remove-cancel"
                    onClick={() => setConfirmingId(null)}
                  >
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="dependency-remove"
                  data-dependency-id={depId}
                  onClick={() => setConfirmingId(depId)}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p
          data-testid="dependency-error"
          role="alert"
          data-role="danger"
          data-code={error.code}
        >
          {dependencyErrorMessage(error)}
        </p>
      )}

      <p data-testid="dependency-precondition-note">
        Dependency edits are not version-checked. They apply immediately.
      </p>
    </div>
  );
}

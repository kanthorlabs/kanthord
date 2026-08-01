import { useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { createObjective, ApiError } from "@/lib/api-client";
import { invalidateFor } from "@/lib/invalidation";

export interface CreateObjectiveProps {
  readonly projectId: string;
  readonly initiativeId: string;
}

export function CreateObjective({
  projectId,
  initiativeId,
}: CreateObjectiveProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();
  const submittedRef = useRef(false);
  const clickRef = useRef(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!clickRef.current) return; // React 19 commit-phase guard
    clickRef.current = false;
    const currentValue = name.trim();
    if (currentValue === "" || submitting || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    void createObjective(initiativeId, currentValue)
      .then(async () => {
        setName("");
        await invalidateFor(client, "objective.create", {
          projectId,
          initiativeId,
        });
        setOpen(false);
      })
      .catch((err: unknown) => {
        submittedRef.current = false;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError(String(err));
        }
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      submittedRef.current = false;
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button data-testid="create-objective">New objective</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>New objective</SheetTitle>
        </SheetHeader>
        <form
          data-testid="create-objective-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 p-4"
        >
          <Input
            data-testid="create-objective-name"
            placeholder="Objective name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            data-testid="create-objective-submit"
            type="submit"
            disabled={submitting || name.trim() === ""}
            onClick={() => {
              clickRef.current = true;
            }}
          >
            Create
          </Button>
          {error !== null && (
            <p
              data-testid="create-objective-error"
              role="alert"
              data-role="danger"
            >
              {error}
            </p>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}

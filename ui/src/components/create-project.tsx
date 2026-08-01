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
import { createProject, ApiError } from "@/lib/api-client";
import { invalidateFor } from "@/lib/invalidation";

export function CreateProject(): ReactElement {
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
    void createProject(currentValue)
      .then(async () => {
        setName("");
        await invalidateFor(client, "project.create", {});
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
        <Button data-testid="create-project">New project</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>New project</SheetTitle>
        </SheetHeader>
        <form
          data-testid="create-project-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 p-4"
        >
          <Input
            data-testid="create-project-name"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            data-testid="create-project-submit"
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
              data-testid="create-project-error"
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

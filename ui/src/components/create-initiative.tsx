import { useState } from "react";
import type { ReactElement } from "react";
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
import { createInitiative, ApiError } from "@/lib/api-client";
import { invalidateFor } from "@/lib/invalidation";

export interface CreateInitiativeProps {
  readonly projectId: string;
}

export function CreateInitiative({
  projectId,
}: CreateInitiativeProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();

  async function doSubmit() {
    const currentValue = name.trim();
    if (currentValue === "" || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await createInitiative(projectId, currentValue);
      setName("");
      setOpen(false);
      await invalidateFor(client, "initiative.create", { projectId });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSubmit();
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button data-testid="create-initiative">New initiative</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>New initiative</SheetTitle>
        </SheetHeader>
        <form
          data-testid="create-initiative-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 p-4"
        >
          <Input
            data-testid="create-initiative-name"
            placeholder="Initiative name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            data-testid="create-initiative-submit"
            type="submit"
            disabled={submitting || name.trim() === ""}
          >
            Create
          </Button>
          {error !== null && (
            <p
              data-testid="create-initiative-error"
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

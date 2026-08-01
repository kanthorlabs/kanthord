import { useCallback, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AsyncBoundary } from "@/components/async-boundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ConflictPanel, ClientDefectNotice } from "@/components/conflict-panel";
import {
  renameInitiative,
  fetchInitiativeWithEtag,
  ApiError,
} from "@/lib/api-client";
import type { InitiativeDetailDto } from "@/lib/dto";
import { useEditSession } from "@/lib/edit-session";
import { invalidateFor } from "@/lib/invalidation";
import { initiativeKeys } from "@/lib/query-keys";

export interface RenameInitiativeProps {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly name: string;
}

export function RenameInitiative({
  projectId,
  initiativeId,
  name,
}: RenameInitiativeProps): ReactElement {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();

  const onSaved = useCallback(
    async (saved: { data: InitiativeDetailDto }) => {
      client.setQueryData(initiativeKeys.detail(initiativeId), saved.data);
      await invalidateFor(client, "initiative.rename", {
        projectId,
        id: initiativeId,
      });
    },
    [client, projectId, initiativeId],
  );

  const session = useEditSession<InitiativeDetailDto, string>({
    load: () => fetchInitiativeWithEtag(initiativeId),
    toDraft: (i) => i.name,
    save: (draft, ifMatch) =>
      renameInitiative(initiativeId, draft.trim(), ifMatch),
    onSaved,
  });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        session.open();
      } else {
        session.close();
      }
    },
    [session],
  );

  const handleSubmit = useCallback(
    (e: FormEvent): void => {
      e.preventDefault();
      if (
        session.status === "submitting" ||
        session.status === "loading" ||
        session.status === "rearming"
      )
        return;
      if (typeof session.draft === "string" && session.draft.trim() === "")
        return;
      session.submit();
    },
    [session],
  );

  const draftBlank = session.draft === null || session.draft.trim() === "";
  const busy =
    session.status === "submitting" ||
    session.status === "loading" ||
    session.status === "rearming";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button
          data-testid="rename-open"
          variant="ghost"
          size="sm"
          aria-label={`Rename ${name}`}
        >
          Rename
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Rename initiative</SheetTitle>
        </SheetHeader>
        {session.status === "missing" ? (
          <AsyncBoundary state="missing" what="initiative" />
        ) : (
          <form
            data-testid="rename-form"
            onSubmit={handleSubmit}
            className="flex flex-col gap-4 p-4"
          >
            <Input
              data-testid="rename-input"
              value={session.draft ?? ""}
              onChange={(e) => {
                session.setDraft(e.target.value);
              }}
              disabled={busy}
            />
            {(session.status === "editing" ||
              session.status === "submitting" ||
              session.status === "conflict" ||
              session.status === "error") && (
              <Button
                data-testid="rename-submit"
                type="submit"
                disabled={busy || draftBlank}
              >
                Save
              </Button>
            )}
            {session.status === "conflict" &&
              session.base !== null &&
              session.draft !== null &&
              session.current !== null && (
                <ConflictPanel
                  base={session.base.data}
                  draft={session.draft}
                  current={session.current}
                  describe={(v) => (typeof v === "string" ? v : v.name)}
                  onReload={session.reload}
                  reloading={false}
                />
              )}
            {session.status === "client-defect" &&
              session.error instanceof ApiError && (
                <ClientDefectNotice requestId={session.error.requestId} />
              )}
            {session.status === "error" && (
              <p data-testid="rename-error" role="alert">
                {session.error?.message ?? "Unknown error"}
              </p>
            )}
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

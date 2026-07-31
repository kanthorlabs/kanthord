// Story 06 — Disabled action inventory, driven by the server's `action`.
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { CommandHandoff } from "@/components/command-handoff";
import type { ActionDto } from "@/lib/dto";

/**
 * Action kinds whose control a LATER UI epic owns, mapped to that epic. This is
 * a statement about what this UI has built, NOT a client-side mirror of the
 * daemon's route table: "a route exists" and "the browser can drive it" are
 * different properties, and only the second one decides what renders.
 *
 * `remove-dependency` is here because `DELETE /api/task/:id/dependency/:dependencyId`
 * exists (`src/apps/http/routes.ts:838-850`, index.md F9) and EPIC 026.4 wires
 * it. 026.4 removes its own entry when it does.
 */
export const ACTION_KINDS_DEFERRED_TO_LATER_EPICS: Readonly<
  Record<string, string>
> = {
  "remove-dependency": "026.4",
};

/** `src/domain/actionability.ts:9-15`. */
export const ACTION_KIND_LABEL: Readonly<Record<string, string>> = {
  retry: "Retry",
  approve: "Approve",
  reject: "Reject",
  publish: "Publish",
  "resume-initiative": "Resume initiative",
  "remove-dependency": "Remove dependency",
};

const REASON =
  "The daemon has no HTTP action for this yet — run it from the CLI.";

export interface ActionInventoryProps {
  readonly action: ActionDto | null;
}

export function ActionInventory({
  action,
}: ActionInventoryProps): ReactElement | null {
  // 1. action === null → return null (no control rendered)
  if (action === null) return null;

  // 2. action.kind in ACTION_KINDS_DEFERRED_TO_LATER_EPICS → return null
  if (action.kind in ACTION_KINDS_DEFERRED_TO_LATER_EPICS) return null;

  // 3. otherwise render the disabled control
  return (
    <section
      data-testid="disabled-action"
      data-action-kind={action.kind}
      data-target-type={action.target.type}
      data-target-id={action.target.id}
      className="flex flex-col gap-2 rounded-md border p-3 text-sm"
    >
      <Button type="button" disabled data-testid="disabled-action-button">
        {ACTION_KIND_LABEL[action.kind] ?? action.kind}
      </Button>
      <p data-testid="disabled-action-reason">{REASON}</p>
      {action.requiresInput.length > 0 && (
        <p data-testid="disabled-action-requires">
          It needs: {action.requiresInput.join(", ")}.
        </p>
      )}
      {"command" in action && action.command !== undefined ? (
        <CommandHandoff command={action.command} reason={REASON} />
      ) : (
        <p data-testid="no-command">
          The daemon did not supply a command for this action.
        </p>
      )}
    </section>
  );
}

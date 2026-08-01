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
 */
export const ACTION_KINDS_DEFERRED_TO_LATER_EPICS: Readonly<
  Record<string, string>
> = {};

/**
 * Action kinds driven entirely by the UI (e.g. dependency editor). These
 * rows are skipped in the action inventory because the UI renders its own
 * controls for them elsewhere.
 */
export const ACTION_KINDS_DRIVEN_BY_UI: ReadonlySet<string> = new Set([
  "remove-dependency",
]);

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

  // 3. action.kind in ACTION_KINDS_DRIVEN_BY_UI → return null
  if (ACTION_KINDS_DRIVEN_BY_UI.has(action.kind)) return null;

  // 4. otherwise render the disabled control
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

import type { ReactElement } from "react";
import { ROLE_CLASS } from "@/lib/status-role";

// --- ConflictPanel (EPIC 026, decision 2) ---

export interface ConflictPanelProps<T, D> {
  readonly base: T;
  readonly draft: D;
  readonly current: T;
  readonly describe: (value: T | D) => string;
  readonly onReload: () => void;
  readonly reloading: boolean;
}

export function ConflictPanel<T, D>(
  props: ConflictPanelProps<T, D>,
): ReactElement {
  const { base, draft, current, describe, onReload, reloading } = props;

  return (
    <div
      data-testid="conflict"
      role="alert"
      data-role="attention"
      className={ROLE_CLASS.attention}
    >
      <p>Someone else changed this while you were editing.</p>
      <div data-testid="conflict-base">
        <span>Was </span>
        {describe(base)}
      </div>
      <div data-testid="conflict-draft">
        <span>Your change </span>
        {describe(draft)}
      </div>
      <div data-testid="conflict-current">
        <span>Now on the server </span>
        {describe(current)}
      </div>
      <button
        data-testid="conflict-reload"
        onClick={onReload}
        disabled={reloading}
      >
        Load the current version
      </button>
    </div>
  );
}

// --- ClientDefectNotice (EPIC 026, decision 3) ---

export interface ClientDefectNoticeProps {
  readonly requestId: string | undefined;
}

export function ClientDefectNotice(
  props: ClientDefectNoticeProps,
): ReactElement {
  const { requestId } = props;

  return (
    <div
      data-testid="client-defect"
      role="alert"
      data-role="danger"
      className={ROLE_CLASS.danger}
    >
      The app sent an edit without a version. This is a bug in this screen, not
      a conflict.
      {requestId !== undefined && (
        <code data-testid="client-defect-request-id">{requestId}</code>
      )}
    </div>
  );
}

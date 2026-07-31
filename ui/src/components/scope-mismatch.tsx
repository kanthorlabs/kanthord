// Story 01 — ScopeMismatch: renders a scope violation with a sentence and optional link.
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import type { ScopeLevel, ScopeMismatchInfo } from "@/lib/entity-scope";
import { ROLE_CLASS } from "@/lib/status-role";
import { cn } from "@/lib/utils";

const SENTENCES: Record<Exclude<ScopeLevel, "chain">, string> = {
  initiative: "This initiative exists, but not in this project.",
  objective: "This objective exists, but not in this initiative.",
  task: "This task exists, but not under this objective.",
  "resource-type": "This resource exists, but it is not of this type.",
  "resource-project": "This resource exists, but not in this project.",
};

const chainSentence = (what: string) =>
  `This URL names a ${what} that does not exist.`;

export interface ScopeMismatchProps {
  readonly info: ScopeMismatchInfo;
}

export function ScopeMismatch({ info }: ScopeMismatchProps): ReactElement {
  const sentence =
    info.level === "chain" ? chainSentence(info.what) : SENTENCES[info.level];
  return (
    <div
      data-testid="scope-mismatch"
      data-level={info.level}
      data-role="attention"
      className={cn(
        "flex flex-col gap-2 rounded-md border p-4 text-sm",
        ROLE_CLASS.attention,
      )}
    >
      <p data-testid="scope-mismatch-sentence">{sentence}</p>
      {info.actual !== null && (
        <p>
          It belongs to{" "}
          <code data-testid="scope-mismatch-actual">{info.actual}</code>, not{" "}
          <code data-testid="scope-mismatch-expected">{info.expected}</code>.
        </p>
      )}
      {info.correctHref !== null && (
        <Link data-testid="scope-mismatch-link" to={info.correctHref}>
          Open this {info.what} at its real location
        </Link>
      )}
    </div>
  );
}

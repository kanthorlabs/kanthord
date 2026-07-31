// Story 03 — DetailPane: read-only side pane showing a row's fields.
// Decision 9: no input, no submit, no destructive control.
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface DetailRow {
  readonly label: string;
  readonly value: ReactNode;
}

export interface DetailPaneProps {
  readonly title: string;
  readonly rows: readonly DetailRow[];
  readonly onClose: () => void;
  readonly children?: ReactNode;
}

export function DetailPane({
  title,
  rows,
  onClose,
  children,
}: DetailPaneProps): ReactElement {
  return (
    <aside data-testid="detail-pane" aria-label={title}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </aside>
  );
}

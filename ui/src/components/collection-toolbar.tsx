// Story 03 — CollectionToolbar: single search input for a W1 collection.
// Decision 8: no create, sort, or filter controls — just the search input.
import type { ReactElement, ReactNode } from "react";
import { Input } from "@/components/ui/input";

export interface CollectionToolbarProps {
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly actions?: ReactNode;
}

export function CollectionToolbar({
  placeholder,
  value,
  onChange,
  actions,
}: CollectionToolbarProps): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Input
        data-testid="collection-search"
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1"
      />
      {actions}
    </div>
  );
}

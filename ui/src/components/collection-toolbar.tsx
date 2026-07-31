// Story 03 — CollectionToolbar: single search input for a W1 collection.
// Decision 8: no create, sort, or filter controls — just the search input.
import type { ReactElement } from "react";
import { Input } from "@/components/ui/input";

export interface CollectionToolbarProps {
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
}

export function CollectionToolbar({
  placeholder,
  value,
  onChange,
}: CollectionToolbarProps): ReactElement {
  return (
    <Input
      data-testid="collection-search"
      placeholder={placeholder}
      aria-label={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

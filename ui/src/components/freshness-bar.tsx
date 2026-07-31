// S6 — FreshnessBar: prop-driven, no clock, explicit "not updated yet" for null.
// Decision 9: required updatedAt (null = "not updated yet"), required onRefresh,
// refreshing disables the control.
import type { ReactElement } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface FreshnessBarProps {
  readonly updatedAt: Date | null;
  readonly onRefresh: () => void;
  readonly refreshing?: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function FreshnessBar({
  updatedAt,
  onRefresh,
  refreshing = false,
}: FreshnessBarProps): ReactElement {
  const label =
    updatedAt === null
      ? "not updated yet"
      : `Updated ${pad(updatedAt.getHours())}:${pad(updatedAt.getMinutes())}`;

  return (
    <div data-testid="freshness-bar" className="flex items-center gap-2">
      <span
        data-testid="freshness-updated"
        className="text-sm text-muted-foreground"
      >
        {label}
      </span>
      <Button
        data-testid="freshness-refresh"
        variant="ghost"
        size="icon-xs"
        type="button"
        aria-label="Refresh"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RefreshCw className="size-3" />
      </Button>
    </div>
  );
}

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { locators } from "@/locators";

interface PageFreshnessProps {
  fetchedAt: Date;
  onRefresh: () => Promise<void>;
}

export function PageFreshness({ fetchedAt, onRefresh }: PageFreshnessProps) {
  const [pending, setPending] = useState(false);
  const updatedAt = `${String(fetchedAt.getHours()).padStart(2, "0")}:${String(fetchedAt.getMinutes()).padStart(2, "0")}`;

  async function handleRefresh() {
    setPending(true);
    try {
      await onRefresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span data-testid={locators.pageFreshness.updated} className="text-sm text-muted-foreground">
        Updated {updatedAt}
      </span>
      <Button
        variant="outline"
        size="sm"
        data-testid={locators.pageFreshness.refresh}
        disabled={pending}
        onClick={() => void handleRefresh()}
      >
        {pending && (
          <Loader2
            aria-hidden="true"
            className="animate-spin size-4"
            data-testid={locators.pageFreshness.spinner}
          />
        )}
        Refresh
      </Button>
    </div>
  );
}

/**
 * InboxItemView — deep-link item view for /inbox/:id (Story 003 T1).
 *
 * Receives the full list of known InboxItemVM objects from the parent (Inbox)
 * and reads the :id route param to select the matching item.
 *
 * Explicit states (daily-usage Input 5 — no silent redirects):
 *   - Open item  → item root with evidence (diff → DiffPane; text → text)
 *   - Resolved   → explicit resolved state (locators.inbox.item.resolvedState)
 *   - Expired    → explicit expired state  (locators.inbox.item.expiredState)
 *   - Not found  → explicit missing state  (locators.inbox.item.missingState)
 *
 * Diff evidence renders the DiffPane composite (DESIGN §5).
 * Text evidence renders as displayed content.
 *
 * Locator placement follows DESIGN §8.
 */
import { useParams } from "react-router-dom";
import { DiffPane } from "@/components/DiffPane";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { InboxItemVM } from "@/inbox/inbox-vm";
import { locators } from "@/locators";

interface InboxItemViewProps {
  items: InboxItemVM[];
}

export function InboxItemView({ items }: InboxItemViewProps) {
  const { id } = useParams<{ id: string }>();
  const item = items.find((i) => i.id === id);

  // Missing item — id does not match any known item
  if (!item) {
    return (
      <Alert data-testid={locators.inbox.item.missingState}>
        <AlertDescription>
          Inbox item not found.
        </AlertDescription>
      </Alert>
    );
  }

  // Resolved item — explicit state, not a redirect
  if (item.status === "resolved") {
    return (
      <Alert data-testid={locators.inbox.item.resolvedState}>
        <AlertDescription>
          This item has been resolved.
        </AlertDescription>
      </Alert>
    );
  }

  // Expired item — explicit state
  if (item.status === "expired") {
    return (
      <Alert data-testid={locators.inbox.item.expiredState}>
        <AlertDescription>
          This item has expired.
        </AlertDescription>
      </Alert>
    );
  }

  // Open item — render evidence
  return (
    <div data-testid={locators.inbox.item.root} className="flex flex-col gap-4">
      <h2 className="text-foreground text-lg font-semibold">{item.summary}</h2>
      <div data-testid={locators.inbox.item.evidence}>
        {item.evidence.kind === "diff" ? (
          <DiffPane files={item.evidence.files} />
        ) : (
          <p className="text-muted-foreground text-sm">{item.evidence.text}</p>
        )}
      </div>
    </div>
  );
}

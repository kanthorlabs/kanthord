/**
 * Respond — inline classification confirm + Next-open-item flow (Story 003 T2).
 *
 * Interaction contract (honest-classification Input 1 + daily-usage Inputs 1 & 4):
 *
 *   INITIAL STATE — inline, no modal:
 *     "Accept suggested: <category>" primary button → direct respond call.
 *     "Override" secondary trigger → reveals the category select + submit.
 *
 *   OVERRIDE STATE:
 *     Category select trigger (locators.inbox.respond.categorySelectTrigger).
 *     Submit button disabled until a category is selected (client-side guard;
 *     belt-and-braces with the server's ConnectError on a category-less call).
 *
 *   POST-SUCCESS STATE (daily-usage Input 4):
 *     Success state element (locators.inbox.respond.successState).
 *     "Next open item" (primary) — navigates to the next open item under the
 *     current deterministic sort (escalation-first, then id alphabetically).
 *     "Back to inbox" (secondary) — navigates to /inbox.
 *     NO auto-navigate — the operator decides.
 *
 * ConnectError from the server renders as a typed api error element
 * (locators.inbox.respond.apiError) — belt and braces with the client guard.
 *
 * Locator placement follows DESIGN §8.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConnectError } from "@connectrpc/connect";
import { Loader2 } from "lucide-react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sortInboxItems } from "@/inbox/inbox-vm";
import type { InboxItemVM } from "@/inbox/inbox-vm";
import { locators } from "@/locators";

// Interaction categories from the Epic 017 contract.
const CATEGORIES = ["approval", "clarification", "correction", "takeover"];

interface RespondProps {
  /** The item being responded to. */
  item: InboxItemVM;
  /** All currently open items (for Next-open-item computation). */
  openItems: InboxItemVM[];
  onSuccess?: () => void | Promise<void>;
}

type Mode = "initial" | "override";
type ResponseState = "idle" | "submitting" | "success" | "error";

export function Respond({ item, openItems, onSuccess }: RespondProps) {
  const client = useDaemonClient();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("initial");
  const [overrideCategory, setOverrideCategory] = useState("");
  const [responseState, setResponseState] = useState<ResponseState>("idle");
  const [apiError, setApiError] = useState<string | null>(null);
  const [submittedNextItem, setSubmittedNextItem] = useState<InboxItemVM | null>(null);

  // ---------------------------------------------------------------------------
  // Next-open-item — deterministic per the shared sort
  // ---------------------------------------------------------------------------
  const sortedOpen = sortInboxItems(openItems);
  const currentIndex = sortedOpen.findIndex((i) => i.id === item.id);
  const nextItem =
    currentIndex >= 0 && currentIndex < sortedOpen.length - 1
      ? sortedOpen[currentIndex + 1]
      : null;

  // ---------------------------------------------------------------------------
  // Respond helpers
  // ---------------------------------------------------------------------------
  async function callRespond(confirmedCategory: string) {
    const nextItemAtSubmit = nextItem ?? null;
    setResponseState("submitting");
    setApiError(null);
    try {
      if (item.kind === "approval") {
        await client.respondToApproval({
          id: item.id,
          approve: true,
          reason: "",
          confirmedCategory,
        });
      } else {
        await client.respondToEscalation({
          id: item.id,
          response: "",
          confirmedCategory,
        });
      }
      setSubmittedNextItem(nextItemAtSubmit);
      await onSuccess?.();
      setResponseState("success");
    } catch (err) {
      setResponseState("error");
      if (err instanceof ConnectError) {
        setApiError(err.message);
      } else {
        setApiError(String(err));
      }
    }
  }

  function handleAccept() {
    void callRespond(item.suggestedCategory);
  }

  function handleOverrideSubmit() {
    if (!overrideCategory) return;
    void callRespond(overrideCategory);
  }

  // ---------------------------------------------------------------------------
  // POST-SUCCESS STATE
  // ---------------------------------------------------------------------------
  if (responseState === "success") {
    return (
      <div
        data-testid={locators.inbox.respond.successState}
        className="flex flex-col gap-3"
      >
        <p className="text-muted-foreground text-sm">Response recorded.</p>
        <div className="flex gap-2">
          {submittedNextItem && (
            <Button
              data-testid={locators.inbox.respond.nextOpenItem}
              onClick={() => navigate(`/inbox/${submittedNextItem.id}`)}
            >
              Next open item
            </Button>
          )}
          {!submittedNextItem && (
            <Button
              data-testid={locators.inbox.respond.nextOpenItem}
              variant="outline"
              disabled
            >
              Next open item
            </Button>
          )}
          <Button
            variant="outline"
            data-testid={locators.inbox.respond.backToInbox}
            onClick={() => navigate("/inbox")}
          >
            Back to inbox
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // INITIAL / OVERRIDE / ERROR STATE
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-3">
      {/* API error (belt and braces) */}
      {apiError !== null && (
        <Alert variant="destructive" data-testid={locators.inbox.respond.apiError}>
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      )}

      {/* Accept button — always visible (no modal, honest-classification Input 1) */}
      <Button
        data-testid={locators.inbox.respond.acceptButton}
        disabled={responseState === "submitting" || !item.suggestedCategory}
        onClick={handleAccept}
      >
        {responseState === "submitting" && (
          <Loader2 className="animate-spin size-4" />
        )}
        Accept suggested: {item.suggestedCategory}
      </Button>

      {/* Override trigger — reveals the override select */}
      {mode === "initial" && (
        <Button
          variant="outline"
          data-testid={locators.inbox.respond.overrideTrigger}
          onClick={() => setMode("override")}
        >
          Override
        </Button>
      )}

      {/* Override mode — category select + submit */}
      {mode === "override" && (
        <div className="flex flex-col gap-2">
          <Select value={overrideCategory} onValueChange={setOverrideCategory}>
            <SelectTrigger
              data-testid={locators.inbox.respond.categorySelectTrigger}
            >
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem
                  key={cat}
                  value={cat}
                  data-testid={locators.inbox.respond.categorySelectItem(cat)}
                >
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            data-testid={locators.inbox.respond.submitButton}
            disabled={!overrideCategory || responseState === "submitting"}
            onClick={handleOverrideSubmit}
          >
            {responseState === "submitting" && (
              <Loader2 className="animate-spin size-4" />
            )}
            Submit
          </Button>
        </div>
      )}
    </div>
  );
}

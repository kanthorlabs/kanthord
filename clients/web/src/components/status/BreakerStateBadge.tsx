/**
 * BreakerStateBadge — DESIGN §4 domain badge for circuit-breaker states.
 *
 * Domain → Tone → BadgeVariant two-step mapping (DESIGN §4 §P4 pattern,
 * mirroring ApprovalStateBadge):
 *   closed    → success  → success      (circuit healthy/normal)
 *   open      → danger   → destructive  (circuit tripped/budget exceeded)
 *   half-open → warning  → warning      (circuit testing recovery)
 *   unknown   → neutral  → secondary    (fallback for any unrecognised state)
 *
 * Never maps domain states to colours inline in a feature file (DESIGN §4).
 */
import { Badge } from "@/components/ui/badge";
import { TONE_BADGE_VARIANT } from "@/design/status";
import type { Tone } from "@/design/status";
import { locators } from "@/locators";

// S1: explicit Tone map — variant derived via TONE_BADGE_VARIANT two-step (§4)
const BREAKER_STATE_TONE: Record<string, Tone> = {
  closed: "success",
  open: "danger",
  "half-open": "warning",
};

export function BreakerStateBadge({ state }: { state: string }) {
  const tone = BREAKER_STATE_TONE[state] ?? "neutral";
  const variant = TONE_BADGE_VARIANT[tone];

  return (
    <Badge
      data-testid={locators.status.breakerStateBadge}
      variant={variant}
    >
      {state}
    </Badge>
  );
}

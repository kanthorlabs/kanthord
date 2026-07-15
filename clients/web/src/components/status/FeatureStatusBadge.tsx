/**
 * FeatureStatusBadge — DESIGN §4 domain badge for feature lifecycle states.
 *
 * Domain → Tone → BadgeVariant mapping (DESIGN §4):
 *   pending  → neutral  → secondary
 *   running  → info     → default
 *   done     → success  → success
 *   error    → danger   → destructive
 *   halted   → warning  → warning
 *   unknown  → neutral  → secondary   (fallback)
 *
 * Never maps domain states to colours inline in a feature file (DESIGN §4).
 */
import { Badge } from "@/components/ui/badge";
import { TONE_BADGE_VARIANT } from "@/design/status";
import type { BadgeVariant } from "@/design/status";
import { locators } from "@/locators";

const FEATURE_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: TONE_BADGE_VARIANT.neutral,
  running: TONE_BADGE_VARIANT.info,
  done: TONE_BADGE_VARIANT.success,
  error: TONE_BADGE_VARIANT.danger,
  halted: TONE_BADGE_VARIANT.warning,
};

function featureStatusVariant(status: string): BadgeVariant {
  return FEATURE_STATUS_VARIANT[status] ?? TONE_BADGE_VARIANT.neutral;
}

export function FeatureStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      data-testid={locators.status.featureBadge}
      variant={featureStatusVariant(status)}
    >
      {status}
    </Badge>
  );
}

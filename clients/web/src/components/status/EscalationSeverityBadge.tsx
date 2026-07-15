/**
 * EscalationSeverityBadge — DESIGN §4 domain badge for escalation items.
 *
 * Rendering rules (daily-usage Input 2):
 *   type "unclassified-artifact-change" → visually distinct badge
 *     (locators.status.unclassifiedBadge, secondary variant — noisy-by-design
 *     so it never buries real escalations in the inbox list).
 *   all other types → standard severity badge (locators.status.severityBadge):
 *     severity "high"    → danger tone  → destructive variant
 *     severity "medium"  → warning tone → warning variant
 *     severity "low"     → info tone    → default variant
 *     severity "" or unknown → neutral tone → secondary variant
 *
 * Semantic tokens only (DESIGN §3). Domain state never mapped inline in a
 * feature file (DESIGN §4).
 */
import { Badge } from "@/components/ui/badge";
import { TONE_BADGE_VARIANT } from "@/design/status";
import type { Tone } from "@/design/status";
import { locators } from "@/locators";

const SEVERITY_TONE: Record<string, Tone> = {
  high: "danger",
  medium: "warning",
  low: "info",
};

function severityVariant(severity: string) {
  const tone: Tone = SEVERITY_TONE[severity] ?? "neutral";
  return TONE_BADGE_VARIANT[tone];
}

interface EscalationSeverityBadgeProps {
  type: string;
  severity: string;
}

export function EscalationSeverityBadge({
  type,
  severity,
}: EscalationSeverityBadgeProps) {
  if (type === "unclassified-artifact-change") {
    return (
      <Badge
        data-testid={locators.status.unclassifiedBadge}
        variant="secondary"
      >
        {type}
      </Badge>
    );
  }

  return (
    <Badge
      data-testid={locators.status.severityBadge}
      variant={severityVariant(severity)}
    >
      {severity}
    </Badge>
  );
}

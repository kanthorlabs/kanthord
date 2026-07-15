/**
 * Visual vocabulary (DESIGN §4) — Tone union and its mapping to Badge variants.
 * No domain knowledge lives here; domain mappings belong beside their composite.
 *
 * Badge variants available in the vendored badge.tsx:
 *   default | secondary | destructive | outline | ghost | link
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

// The badge variant values come from the vendored badge.tsx cva definition.
export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "outline"
  | "ghost"
  | "link";

/**
 * Maps each Tone to its badge variant (DESIGN §4).
 *
 *  neutral  → secondary   (muted/gray, no emphasis)
 *  info     → default     (primary/action color = informational)
 *  success  → success     (green success token)
 *  warning  → warning     (amber warning token)
 *  danger   → destructive (error/danger red)
 */
export const TONE_BADGE_VARIANT: Record<Tone, BadgeVariant> = {
  neutral: "secondary",
  info: "default",
  success: "success",
  warning: "warning",
  danger: "destructive",
};

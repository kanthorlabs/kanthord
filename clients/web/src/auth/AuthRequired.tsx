/**
 * AuthRequired — the DESIGN §7 auth-required screen (Story 001 T4b).
 *
 * Renders when an unauthenticated session attempts to reach any protected
 * surface. Shows no feature or surface data — only the auth prompt.
 * Selection via locators.auth.required (DESIGN §8).
 */
import { locators } from "@/locators";

export function AuthRequired() {
  return (
    <div
      data-testid={locators.auth.required}
      className="flex min-h-screen flex-col items-center justify-center gap-4"
    >
      <p className="text-muted-foreground">
        Authentication required. Please sign in to continue.
      </p>
    </div>
  );
}

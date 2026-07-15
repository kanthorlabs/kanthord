/**
 * ListPage template — DESIGN §6 page template for list surfaces.
 * Slots: title / toolbar / content (+ the §7 state slots via DataStates).
 * The content region carries overflow-x-auto so wide tables scroll inside
 * the container — the page body never scrolls horizontally (DESIGN §6).
 */
import type { ReactNode } from "react";
import { DataStates } from "@/components/DataStates";
import { locators } from "@/locators";

interface ListPageProps {
  /** Page title rendered in the title slot. */
  title: string;
  /** Optional toolbar slot (action buttons, filters). */
  toolbar?: ReactNode;
  /** Loading state — delegates to DataStates (DESIGN §7). */
  loading?: boolean;
  /** Empty state with caller-supplied wording (DESIGN §7). */
  empty?: { message: string };
  /** Error state (DESIGN §7 destructive-variant Alert). */
  error?: { message: string };
  /** Page body — only rendered when no state is active. */
  children?: ReactNode;
}

export function ListPage({
  title,
  toolbar,
  loading,
  empty,
  error,
  children,
}: ListPageProps) {
  const isStateActive = (loading === true) || empty !== undefined || error !== undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Title slot */}
      <div
        data-testid={locators.listPage.title}
        className="text-foreground text-xl font-semibold"
      >
        {title}
      </div>

      {/* Toolbar slot — only rendered when toolbar is supplied */}
      {toolbar !== undefined && (
        <div data-testid={locators.listPage.toolbar} className="flex items-center gap-2">
          {toolbar}
        </div>
      )}

      {/* Content area: state slots XOR children */}
      {isStateActive ? (
        <DataStates loading={loading} empty={empty} error={error} />
      ) : (
        <div
          data-testid={locators.listPage.content}
          className="overflow-x-auto"
        >
          {children}
        </div>
      )}
    </div>
  );
}

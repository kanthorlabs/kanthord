/**
 * ListPage template — DESIGN §6 page template for list surfaces.
 * Slots: title / toolbar / content (+ the §7 state slots via DataStates).
 * The content region carries overflow-x-auto so wide tables scroll inside
 * the container — the page body never scrolls horizontally (DESIGN §6).
 */
import type { ReactNode } from "react";
import { DataStates } from "@/components/DataStates";
import { PageFreshness } from "@/components/PageFreshness";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  refreshError?: { message: string };
  fetchedAt?: Date;
  onRefresh?: () => Promise<void>;
  /** Page body — only rendered when no state is active. */
  children?: ReactNode;
}

export function ListPage({
  title,
  toolbar,
  loading,
  empty,
  error,
  refreshError,
  fetchedAt,
  onRefresh,
  children,
}: ListPageProps) {
  const isStateActive = (loading === true) || empty !== undefined || error !== undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Title slot */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          data-testid={locators.listPage.title}
          className="text-foreground text-xl font-semibold"
        >
          {title}
        </div>
        {fetchedAt !== undefined && onRefresh !== undefined && (
          <PageFreshness fetchedAt={fetchedAt} onRefresh={onRefresh} />
        )}
      </div>

      {/* Toolbar slot — only rendered when toolbar is supplied */}
      {toolbar !== undefined && (
        <div data-testid={locators.listPage.toolbar} className="flex items-center gap-2">
          {toolbar}
        </div>
      )}

      {refreshError !== undefined && (
        <Alert variant="destructive"><AlertDescription>{refreshError.message}</AlertDescription></Alert>
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

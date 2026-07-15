/**
 * Shared state components (DESIGN §7).
 * Renders the applicable state — loading, empty, or error — via the
 * vendored skeleton / empty / alert primitives. All state containers carry
 * registry locators (DESIGN §8).
 */
import { Skeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { locators } from "@/locators";

interface DataStatesProps {
  /** Render three skeleton blocks (DESIGN §7 loading pattern). */
  loading?: boolean;
  /** Render the Empty primitive with caller-supplied wording. */
  empty?: { message: string };
  /** Render a destructive Alert with the error message. */
  error?: { message: string };
}

/**
 * DataStates — renders exactly one state container or nothing.
 * Priority: loading → empty → error.
 */
export function DataStates({ loading, empty, error }: DataStatesProps) {
  if (loading) {
    return (
      <div data-testid={locators.dataStates.loading} className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (empty) {
    return (
      <Empty data-testid={locators.dataStates.empty}>
        {empty.message}
      </Empty>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" data-testid={locators.dataStates.error}>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }

  return null;
}

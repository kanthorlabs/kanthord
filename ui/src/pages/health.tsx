// EPIC 026 S4 — the health card. This is what replaces the retired inline
// `UI_SHELL_HTML`: it reads /healthz through the one transport seam and renders
// the daemon version, which is the DOM proof curl cannot give.
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Health {
  readonly status: string;
  readonly version: string;
}

export function HealthPage() {
  const health = useQuery({
    queryKey: ["healthz"],
    queryFn: () => apiGet<Health>("/healthz"),
  });

  return (
    <main className="mx-auto flex min-h-svh max-w-xl items-center p-6">
      <Card className="w-full" data-testid="health-card">
        <CardHeader>
          <CardTitle>kanthord</CardTitle>
          <CardDescription>Daemon health</CardDescription>
        </CardHeader>
        <CardContent>
          {health.isPending ? (
            <Skeleton className="h-6 w-32" data-testid="health-loading" />
          ) : health.isError ? (
            <p className="text-destructive text-sm" role="alert">
              {health.error.message}
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">status</dt>
              <dd data-testid="health-status">{health.data.status}</dd>
              <dt className="text-muted-foreground">version</dt>
              <dd data-testid="health-version">{health.data.version}</dd>
            </dl>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

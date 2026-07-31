// S6 — OperationsPage: health card as a real query, wired to FreshnessBar.
// Replaces the EPIC 026 HealthPage. Renders its own GlobalShell so the
// FreshnessBar lands in the header slot.
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";

import { GlobalShell } from "@/components/shell";
import { FreshnessBar } from "@/components/freshness-bar";
import { AsyncBoundary } from "@/components/async-boundary";
import { healthQueryOptions } from "@/lib/queries";
import { asyncStateOf } from "@/lib/async-state";
import { StatusChip } from "@/components/status-chip";
import type { ReadinessCheckStatus } from "@/lib/status-role";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function OperationsPage(): ReactElement {
  const health = useQuery(healthQueryOptions());
  const state = asyncStateOf(health);
  const updatedAt = health.isSuccess ? new Date(health.dataUpdatedAt) : null;

  return (
    <GlobalShell
      freshness={
        <FreshnessBar
          updatedAt={updatedAt}
          onRefresh={() => void health.refetch()}
          refreshing={health.isFetching}
        />
      }
    >
      <div className="mx-auto flex max-w-xl items-center p-6">
        <Card className="w-full" data-testid="health-card">
          <CardHeader>
            <CardTitle>kanthord</CardTitle>
            <CardDescription>Daemon health</CardDescription>
          </CardHeader>
          <CardContent>
            <AsyncBoundary
              state={state}
              what="health"
              message={
                health.error instanceof Error ? health.error.message : undefined
              }
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">status</dt>
                <dd>
                  <StatusChip
                    axis="readiness"
                    value={
                      (health.data?.status ?? "ok") as ReadinessCheckStatus
                    }
                  />
                </dd>
                <dt className="text-muted-foreground">version</dt>
                <dd data-testid="health-version">{health.data?.version}</dd>
              </dl>
            </AsyncBoundary>
          </CardContent>
        </Card>
      </div>
    </GlobalShell>
  );
}

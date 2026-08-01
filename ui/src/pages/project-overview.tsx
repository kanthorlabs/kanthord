// Story 04 — ProjectOverviewPage: initiative cards, decisions, digest, truncated state.
// Decision 4: three sections in fixed order, lanes unrendered.
// Decision 5: hasMore renders digest-truncated.
// Decision 6: decision rows link to entity, no act control.
// Decision 8: no write controls.
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AsyncBoundary } from "@/components/async-boundary";
import { CreateInitiative } from "@/components/create-initiative";
import { FreshnessBar } from "@/components/freshness-bar";
import { StatusChip } from "@/components/status-chip";
import { CommandHandoff } from "@/components/command-handoff";
import { fetchProjectOverview } from "@/lib/api-client";
import { projectKeys, invalidateOverview } from "@/lib/query-keys";
import { asyncStateOf } from "@/lib/async-state";
import { useVisibilityPoll } from "@/lib/polling";
import type { DecisionDto } from "@/lib/dto";

// --- helpers ---

function decisionHref(d: DecisionDto, projectId: string): string {
  if (d.taskId) {
    return `#/project/${projectId}/initiative/${d.initiativeId}/objective/${d.objectiveId}/task/${d.taskId}`;
  }
  if (d.objectiveId) {
    return `#/project/${projectId}/initiative/${d.initiativeId}/objective/${d.objectiveId}`;
  }
  return `#/project/${projectId}/initiative/${d.initiativeId}`;
}

function decisionLabel(d: DecisionDto): string {
  if (d.taskId) return `task ${d.taskId}`;
  if (d.objectiveId) return `objective ${d.objectiveId}`;
  return `initiative ${d.initiativeId}`;
}

// --- component ---

export function ProjectOverviewPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const projectId = id!;

  const query = useQuery({
    queryKey: projectKeys.overview(projectId),
    queryFn: ({ signal }) => fetchProjectOverview(projectId, { signal }),
  });

  const queryClient = useQueryClient();
  const poll = useVisibilityPoll({
    signal: query.data?.digest.latest ?? null,
    probe: (abort) =>
      fetchProjectOverview(projectId, { signal: abort }).then(
        (o) => o.digest.latest,
      ),
    onChange: () => {
      void invalidateOverview(queryClient, projectId);
    },
    resetKey: projectId,
  });

  const state = asyncStateOf(query, {
    isEmpty: (data) =>
      data.initiatives.length === 0 &&
      data.decisions.length === 0 &&
      data.digest.totalCount === 0,
  });

  const updatedAt =
    query.dataUpdatedAt === 0 ? null : new Date(query.dataUpdatedAt);

  return (
    <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Overview</h1>
        <FreshnessBar
          updatedAt={updatedAt}
          onRefresh={() => {
            void query.refetch();
          }}
          refreshing={query.isFetching}
        />
      </div>

      {poll.error !== null && (
        <p data-testid="poll-error" role="status">
          {poll.error.message}
        </p>
      )}

      {query.data && <CreateInitiative projectId={projectId} />}

      <AsyncBoundary
        state={state}
        what="project overview"
        message={query.error instanceof Error ? query.error.message : undefined}
      >
        {query.data && (
          <>
            {/* 1. Initiatives section */}
            <section aria-label="Initiatives">
              {query.data.initiatives.length === 0 ? (
                <AsyncBoundary state="empty" what="initiatives" />
              ) : (
                query.data.initiatives.map((i) => (
                  <article
                    key={i.id}
                    data-testid="overview-initiative-card"
                    data-initiative-id={i.id}
                    className="mb-4 rounded-md border p-4"
                  >
                    <h2 className="text-lg font-semibold">{i.name}</h2>
                    <StatusChip axis="initiative" value={i.status} />
                    {i.paused && <span className="ml-2 text-sm">paused</span>}
                    {i.needsHuman && (
                      <span className="ml-2 text-sm">needs human</span>
                    )}
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      {(
                        [
                          ["pending", "count-pending"],
                          ["running", "count-running"],
                          ["completed", "count-completed"],
                          ["failed", "count-failed"],
                          [
                            "awaiting_confirmation",
                            "count-awaiting-confirmation",
                          ],
                          ["discarded", "count-discarded"],
                        ] as const
                      ).map(([key, testId]) => (
                        <div key={key}>
                          <dt className="capitalize">
                            {key.replace(/_/g, " ")}
                          </dt>
                          <dd data-testid={testId}>{i.taskCounts[key]}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))
              )}
              <Link
                to={`/project/${projectId}/graph`}
                className="mt-2 text-sm text-muted-foreground underline"
              >
                Lanes are on the graph
              </Link>
            </section>

            {/* 2. Decisions section */}
            <section data-testid="overview-decisions" className="mt-6">
              <h2 className="mb-2 text-lg font-semibold">Decisions</h2>
              {query.data.decisions.length === 0 ? (
                <AsyncBoundary state="empty" what="decisions" />
              ) : (
                <div className="space-y-2">
                  {query.data.decisions.map((d, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-4 rounded-md border p-3 text-sm"
                    >
                      <span className="font-medium">{d.action.kind}</span>
                      <span className="text-muted-foreground">
                        downstream {d.downstream}
                      </span>
                      <span className="text-muted-foreground">
                        {d.actionableSince === null
                          ? "—"
                          : new Date(d.actionableSince).toISOString()}
                      </span>
                      <Link
                        to={decisionHref(d, projectId)}
                        className="underline"
                      >
                        {decisionLabel(d)}
                      </Link>
                      {d.action.command && (
                        <CommandHandoff
                          command={d.action.command}
                          reason="This action requires the CLI."
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 3. Digest section */}
            <section data-testid="overview-digest" className="mt-6">
              <h2 className="mb-2 text-lg font-semibold">Activity</h2>
              <p className="text-sm text-muted-foreground">
                {query.data.digest.totalCount} events
              </p>
              <div className="mt-2 space-y-1">
                {query.data.digest.events.map((e) => (
                  <div key={e.id} className="text-sm">
                    <span className="font-mono text-xs">{e.id}</span>{" "}
                    <span className="text-muted-foreground">{e.type}</span>
                  </div>
                ))}
              </div>
              {query.data.digest.hasMore && (
                <div data-testid="digest-truncated">
                  <AsyncBoundary state="truncated" what="digest" />
                </div>
              )}
            </section>
          </>
        )}
      </AsyncBoundary>
    </main>
  );
}

/**
 * FeatureList — features list surface (Story 001 T1).
 *
 * Reads the daemon client via useDaemonClient() from DaemonClientProvider.
 * Renders loading / error via ListPage state slots (DataStates, DESIGN §7).
 * Renders an explicit feature-scoped empty state (locators.features.list.empty)
 * so the E2E and component tests can distinguish "no features" from the
 * shared DataStates empty (DESIGN §8 area-scoped locators).
 *
 * Rows carry locators.features.list.row — one per feature.
 * Status column renders via FeatureStatusBadge (DESIGN §4 domain badge).
 */
import { useState, useEffect } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { ListPage } from "@/components/templates/ListPage";
import { FeatureStatusBadge } from "@/components/status/FeatureStatusBadge";
import { Empty } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { locators } from "@/locators";

type Feature = Awaited<ReturnType<DaemonClient["listFeatures"]>>["features"][number];

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; features: readonly Feature[] };

export function FeatureList() {
  const client = useDaemonClient();
  const [state, setState] = useState<ListState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    client
      .listFeatures({})
      .then((res) => {
        if (!cancelled) {
          setState({ status: "data", features: res.features });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <ListPage
      title="Features"
      loading={state.status === "loading"}
      error={
        state.status === "error"
          ? { message: state.message }
          : undefined
      }
    >
      {state.status === "data" &&
        (state.features.length === 0 ? (
          <Empty data-testid={locators.features.list.empty}>
            No features found.
          </Empty>
        ) : (
          <Table data-testid={locators.features.list.table}>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.features.map((feature) => (
                <TableRow
                  key={feature.featureId}
                  data-testid={locators.features.list.row}
                >
                  <TableCell>{feature.featureId}</TableCell>
                  <TableCell>
                    <FeatureStatusBadge status={feature.status} />
                  </TableCell>
                  <TableCell>{feature.phase}</TableCell>
                  <TableCell>{feature.progressSummary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
    </ListPage>
  );
}

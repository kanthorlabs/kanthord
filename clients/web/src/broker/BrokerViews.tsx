/**
 * BrokerOpsView — broker operations surface (Story 005 T1).
 * BrokerVerbsView — verb registry surface (Story 005 T1).
 *
 * BrokerOpsView: calls listBrokerOperations and groups results into three
 * distinctly identified containers — in-flight, pending, and expiring.
 * Each row shows the op state (lifecycle) and correlation (reconciliation
 * reference). Loading / error via ListPage DataStates; area-scoped empty state.
 *
 * BrokerVerbsView: calls listBrokerVerbs and renders each verb with its tier.
 * Read-only by design (DESIGN §6) — no input, textarea, or contentEditable.
 * Loading / error via ListPage DataStates; area-scoped empty state.
 */
import { useState, useEffect } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { ListPage } from "@/components/templates/ListPage";
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

type BrokerOp = Awaited<ReturnType<DaemonClient["listBrokerOperations"]>>["operations"][number];
type BrokerVerb = Awaited<ReturnType<DaemonClient["listBrokerVerbs"]>>["verbs"][number];

// ---------------------------------------------------------------------------
// BrokerOpsView
// ---------------------------------------------------------------------------

type OpsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; operations: readonly BrokerOp[] };

export function BrokerOpsView() {
  const client = useDaemonClient();
  const [state, setState] = useState<OpsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    client
      .listBrokerOperations({})
      .then((res) => {
        if (!cancelled) {
          setState({ status: "data", operations: res.operations });
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
      title="Broker Operations"
      loading={state.status === "loading"}
      error={state.status === "error" ? { message: state.message } : undefined}
    >
      {state.status === "data" && <BrokerOpsContent operations={state.operations} />}
    </ListPage>
  );
}

function BrokerOpsContent({
  operations,
}: {
  operations: readonly BrokerOp[];
}) {
  if (operations.length === 0) {
    return (
      <Empty data-testid={locators.broker.ops.empty}>
        No broker operations.
      </Empty>
    );
  }

  const inFlightOps = operations.filter((op) => !op.expiring && op.state === "in_flight");
  const pendingOps = operations.filter((op) => !op.expiring && op.state === "pending");
  const expiringOps = operations.filter((op) => op.expiring);

  return (
    <div data-testid={locators.broker.ops.table} className="flex flex-col gap-4">
      {inFlightOps.length > 0 && (
        <div data-testid={locators.broker.ops.groupInFlight}>
          <div className="text-foreground mb-2 font-medium text-sm">In-Flight</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead>Correlation</TableHead>
                <TableHead>Verb</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inFlightOps.map((op) => (
                <TableRow key={op.opId} data-testid={locators.broker.ops.row}>
                  <TableCell>{op.state}</TableCell>
                  <TableCell>{op.correlation}</TableCell>
                  <TableCell>{op.verb}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {pendingOps.length > 0 && (
        <div data-testid={locators.broker.ops.groupPending}>
          <div className="text-foreground mb-2 font-medium text-sm">Pending</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead>Correlation</TableHead>
                <TableHead>Verb</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingOps.map((op) => (
                <TableRow key={op.opId} data-testid={locators.broker.ops.row}>
                  <TableCell>{op.state}</TableCell>
                  <TableCell>{op.correlation}</TableCell>
                  <TableCell>{op.verb}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {expiringOps.length > 0 && (
        <div data-testid={locators.broker.ops.groupExpiring}>
          <div className="text-foreground mb-2 font-medium text-sm">Expiring</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead>Correlation</TableHead>
                <TableHead>Verb</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expiringOps.map((op) => (
                <TableRow key={op.opId} data-testid={locators.broker.ops.row}>
                  <TableCell>{op.state}</TableCell>
                  <TableCell>{op.correlation}</TableCell>
                  <TableCell>{op.verb}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BrokerVerbsView
// ---------------------------------------------------------------------------

type VerbsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; verbs: readonly BrokerVerb[] };

export function BrokerVerbsView() {
  const client = useDaemonClient();
  const [state, setState] = useState<VerbsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    client
      .listBrokerVerbs({})
      .then((res) => {
        if (!cancelled) {
          setState({ status: "data", verbs: res.verbs });
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
      title="Verb Registry"
      loading={state.status === "loading"}
      error={state.status === "error" ? { message: state.message } : undefined}
    >
      {state.status === "data" &&
        (state.verbs.length === 0 ? (
          <Empty data-testid={locators.broker.verbs.empty}>
            No verbs registered.
          </Empty>
        ) : (
          <Table data-testid={locators.broker.verbs.table}>
            <TableHeader>
              <TableRow>
                <TableHead>Verb</TableHead>
                <TableHead>Tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.verbs.map((v) => (
                <TableRow key={v.verb} data-testid={locators.broker.verbs.row}>
                  <TableCell>{v.verb}</TableCell>
                  <TableCell>{v.tier}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
    </ListPage>
  );
}

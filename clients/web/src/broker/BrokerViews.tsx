import type { DaemonClient } from "@/lib/client";
import { ListPage } from "@/components/templates/ListPage";
import { Empty } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { locators } from "@/locators";

type BrokerOp = Awaited<ReturnType<DaemonClient["listBrokerOperations"]>>["operations"][number];
type BrokerVerb = Awaited<ReturnType<DaemonClient["listBrokerVerbs"]>>["verbs"][number];

export interface BrokerOpsViewProps {
  loading?: boolean;
  error?: { message: string };
  refreshError?: { message: string };
  operations?: readonly BrokerOp[];
  fetchedAt?: Date;
  onRefresh?: () => Promise<void>;
}

export interface BrokerVerbsViewProps {
  loading?: boolean;
  error?: { message: string };
  verbs?: readonly BrokerVerb[];
}

export function BrokerOpsView(props: BrokerOpsViewProps = {}) {
  const { loading, error, refreshError, operations = [], fetchedAt, onRefresh } = props;
  const inFlightOps = operations.filter((op) => !op.expiring && op.state === "in_flight");
  const pendingOps = operations.filter((op) => !op.expiring && op.state === "pending");
  const expiringOps = operations.filter((op) => op.expiring);
  const groups = [
    [inFlightOps, locators.broker.ops.groupInFlight, "In-Flight"],
    [pendingOps, locators.broker.ops.groupPending, "Pending"],
    [expiringOps, locators.broker.ops.groupExpiring, "Expiring"],
  ] as const;

  return (
    <ListPage title="Broker Operations" loading={loading} error={error} refreshError={refreshError} fetchedAt={fetchedAt} onRefresh={onRefresh}>
      {!loading && error === undefined && (operations.length === 0 ? (
        <Empty data-testid={locators.broker.ops.empty}>No broker operations.</Empty>
      ) : (
        <div data-testid={locators.broker.ops.table} className="flex flex-col gap-4">
          {groups.map(([group, locator, title]) => group.length > 0 && (
            <div key={title} data-testid={locator}>
              <div className="text-foreground mb-2 font-medium text-sm">{title}</div>
              <Table>
                <TableHeader><TableRow><TableHead>State</TableHead><TableHead>Correlation</TableHead><TableHead>Verb</TableHead></TableRow></TableHeader>
                <TableBody>{group.map((op) => (
                  <TableRow key={op.opId} data-testid={locators.broker.ops.row}>
                    <TableCell>{op.state}</TableCell><TableCell>{op.correlation}</TableCell><TableCell>{op.verb}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          ))}
        </div>
      ))}
    </ListPage>
  );
}

export function BrokerVerbsView(props: BrokerVerbsViewProps = {}) {
  const { loading, error, verbs = [] } = props;
  return (
    <ListPage title="Verb Registry" loading={loading} error={error}>
      {!loading && error === undefined && (verbs.length === 0 ? (
        <Empty data-testid={locators.broker.verbs.empty}>No verbs registered.</Empty>
      ) : (
        <Table data-testid={locators.broker.verbs.table}>
          <TableHeader><TableRow><TableHead>Verb</TableHead><TableHead>Tier</TableHead></TableRow></TableHeader>
          <TableBody>{verbs.map((verb) => (
            <TableRow key={verb.verb} data-testid={locators.broker.verbs.row}>
              <TableCell>{verb.verb}</TableCell><TableCell>{verb.tier}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      ))}
    </ListPage>
  );
}

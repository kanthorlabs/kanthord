/**
 * Inbox — escalation/approval inbox list surface (Story 003 T1).
 *
 * Fetches open items via listInboxItems, adapts each through toInboxItemVM,
 * applies the deterministic sort (escalation-first, then id alphabetically),
 * and renders the list with per-row EscalationSeverityBadge (DESIGN §4).
 *
 * Features:
 *   - Loading / error states via ListPage (DESIGN §7)
 *   - Explicit empty state with locators.inbox.list.empty
 *   - Scannable type-badge per row (daily-usage Input 2)
 *   - Deterministic default sort
 *   - Simple type filter that narrows the visible rows
 *
 * Locator placement follows DESIGN §8.
 */
import { useState, useEffect } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { ListPage } from "@/components/templates/ListPage";
import { EscalationSeverityBadge } from "@/components/status/EscalationSeverityBadge";
import { Empty } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toInboxItemVM, sortInboxItems } from "@/inbox/inbox-vm";
import type { InboxItemVM } from "@/inbox/inbox-vm";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Component state
// ---------------------------------------------------------------------------

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; items: InboxItemVM[] };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Inbox() {
  const client = useDaemonClient();
  const [state, setState] = useState<State>({ status: "loading" });
  const [selectedType, setSelectedType] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .listInboxItems({})
      .then((res) => {
        if (!cancelled) {
          // The adapter passes through extended fields when present (N2 design)
          // and defaults them when absent (current bare proto).
          const vms = res.items.map((item) =>
            toInboxItemVM(item as Parameters<typeof toInboxItemVM>[0])
          );
          setState({ status: "data", items: vms });
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

  // Derived: sort + filter (computed from data state)
  const sortedItems =
    state.status === "data" ? sortInboxItems(state.items) : [];
  const filteredItems =
    selectedType !== null
      ? sortedItems.filter((i) => i.type === selectedType)
      : sortedItems;
  const uniqueTypes = [
    ...new Set(sortedItems.map((i) => i.type).filter((t) => t !== "")),
  ];

  // ---------------------------------------------------------------------------
  // Type filter — vendored Select (B1, DESIGN §2)
  // ---------------------------------------------------------------------------
  // Sentinel value for the "show all" option — Radix Select requires non-empty string values.
  const ALL_TYPES_SENTINEL = "__all__";

  const typeFilterUI = (
    <Select
      value={selectedType ?? ALL_TYPES_SENTINEL}
      onValueChange={(val) =>
        setSelectedType(val === ALL_TYPES_SENTINEL ? null : val)
      }
    >
      <SelectTrigger
        size="sm"
        data-testid={locators.inbox.list.typeFilter}
      >
        <SelectValue placeholder="All types" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_TYPES_SENTINEL}>
          All types
        </SelectItem>
        {uniqueTypes.map((type) => (
          <SelectItem
            key={type}
            value={type}
            data-testid={locators.inbox.list.typeFilterItem(type)}
          >
            {type}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <ListPage
      title="Inbox"
      toolbar={typeFilterUI}
      loading={state.status === "loading"}
      error={
        state.status === "error" ? { message: state.message } : undefined
      }
    >
      {state.status === "data" &&
        (filteredItems.length === 0 ? (
          <Empty data-testid={locators.inbox.list.empty}>
            No open items.
          </Empty>
        ) : (
          <Table data-testid={locators.inbox.list.table}>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Feature</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Severity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item) => (
                <TableRow
                  key={item.id}
                  data-testid={locators.inbox.list.row}
                >
                  <TableCell>{item.id}</TableCell>
                  <TableCell>{item.kind}</TableCell>
                  <TableCell>{item.featureId}</TableCell>
                  <TableCell>{item.summary}</TableCell>
                  <TableCell>
                    <EscalationSeverityBadge
                      type={item.type}
                      severity={item.severity}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
    </ListPage>
  );
}

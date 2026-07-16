/**
 * Inbox — escalation/approval inbox list surface (Story 003 T1).
 *
 * Receives items adapted by InboxContainer,
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
import { useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";
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
import { sortInboxItems } from "@/inbox/inbox-vm";
import type { InboxItemVM } from "@/inbox/inbox-vm";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Component state
// ---------------------------------------------------------------------------

export interface InboxProps {
  loading?: boolean;
  error?: { message: string };
  refreshError?: { message: string };
  items?: InboxItemVM[];
  fetchedAt?: Date;
  onRefresh?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Inbox(props: InboxProps = {}) {
  const { loading, error, refreshError, items = [], fetchedAt, onRefresh } = props;
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Derived: sort + filter (computed from data state)
  const sortedItems = sortInboxItems(items);
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
      loading={loading}
      error={error}
      refreshError={refreshError}
      fetchedAt={fetchedAt}
      onRefresh={onRefresh}
    >
      {!loading && error === undefined &&
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
                  <TableCell><InboxItemLink id={item.id} /></TableCell>
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

function InboxItemLink({ id }: { id: string }) {
  const inRouter = useInRouterContext();
  const href = `/inbox/${encodeURIComponent(id)}`;
  const testId = locators.inbox.list.itemLink(id);

  if (!inRouter) {
    return <a href={href} data-testid={testId}>{id}</a>;
  }

  return <Link to={href} data-testid={testId}>{id}</Link>;
}

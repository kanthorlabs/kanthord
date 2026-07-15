/**
 * RepoSlots — repo slots surface (Story 005 T2).
 *
 * Receives slots from RepoSlotsContainer and renders each as a table row showing:
 * repo, strategy, held leases, and active sessions.
 * Empty fixture renders an explicit area-scoped empty state.
 * Loading / error via ListPage DataStates (DESIGN §7).
 */
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

type SlotInfo = Awaited<ReturnType<DaemonClient["listSlots"]>>["slots"][number];

export interface RepoSlotsProps {
  loading?: boolean;
  error?: { message: string };
  slots?: readonly SlotInfo[];
}

export function RepoSlots(props: RepoSlotsProps = {}) {
  const { loading, error, slots = [] } = props;
  return (
    <ListPage
      title="Repo Slots"
      loading={loading}
      error={error}
    >
      {!loading && error === undefined &&
        (slots.length === 0 ? (
          <Empty data-testid={locators.slots.empty}>
            No repo slots registered.
          </Empty>
        ) : (
          <Table data-testid={locators.slots.table}>
            <TableHeader>
              <TableRow>
                <TableHead>Repo</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Held Leases</TableHead>
                <TableHead>Active Sessions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.map((slot) => (
                <TableRow key={slot.name} data-testid={locators.slots.row}>
                  <TableCell>{slot.repo}</TableCell>
                  <TableCell>{slot.strategy}</TableCell>
                  <TableCell>{slot.heldLeases.join(", ")}</TableCell>
                  <TableCell>{slot.activeSessions.join(", ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
    </ListPage>
  );
}

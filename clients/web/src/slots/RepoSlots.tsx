/**
 * RepoSlots — repo slots surface (Story 005 T2).
 *
 * Calls listSlots and renders each SlotInfo as a table row showing:
 * repo, strategy, held leases, and active sessions.
 * Empty fixture renders an explicit area-scoped empty state.
 * Loading / error via ListPage DataStates (DESIGN §7).
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

type SlotInfo = Awaited<ReturnType<DaemonClient["listSlots"]>>["slots"][number];

type SlotsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; slots: readonly SlotInfo[] };

export function RepoSlots() {
  const client = useDaemonClient();
  const [state, setState] = useState<SlotsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    client
      .listSlots({})
      .then((res) => {
        if (!cancelled) {
          setState({ status: "data", slots: res.slots });
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
      title="Repo Slots"
      loading={state.status === "loading"}
      error={state.status === "error" ? { message: state.message } : undefined}
    >
      {state.status === "data" &&
        (state.slots.length === 0 ? (
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
              {state.slots.map((slot) => (
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

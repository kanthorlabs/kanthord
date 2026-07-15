import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { ApprovalActions } from "@/approvals/ApprovalActions";
import { toApprovalItemVM } from "@/approvals/approval-vm";
import { DataStates } from "@/components/DataStates";
import { InboxItemView } from "@/inbox/InboxItemView";
import { Respond } from "@/inbox/Respond";
import { sortInboxItems, toInboxItemVM } from "@/inbox/inbox-vm";
import type { InboxItemVM } from "@/inbox/inbox-vm";
import type { DaemonClient } from "@/lib/client";

type InboxItem = NonNullable<Awaited<ReturnType<DaemonClient["getInboxItem"]>>["item"]>;
type CurrentItem = { raw: InboxItem; vm: InboxItemVM };
type ItemState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; current?: CurrentItem; openItems: InboxItemVM[] };

export function InboxItemContainer({
  onInboxChanged,
}: {
  onInboxChanged?: () => void | Promise<void>;
}) {
  const client = useDaemonClient();
  const { id } = useParams<{ id: string }>();
  const requestVersion = useRef(0);
  const [state, setState] = useState<ItemState>(() =>
    id === undefined ? { status: "error", message: "Inbox item id is required." } : { status: "loading" },
  );

  const refresh = useCallback(async (showLoading: boolean) => {
    if (id === undefined) {
      setState({ status: "error", message: "Inbox item id is required." });
      return;
    }

    const version = ++requestVersion.current;
    if (showLoading) setState({ status: "loading" });
    try {
      const [itemResult, listResult] = await Promise.all([
        client.getInboxItem({ id }),
        client.listInboxItems({}),
      ]);
      if (version !== requestVersion.current) return;

      const raw = itemResult.item;
      const openItems = sortInboxItems(
        listResult.items.map(toInboxItemVM).filter((item) => item.status === "open"),
      );
      setState({
        status: "data",
        current: raw === undefined ? undefined : { raw, vm: toInboxItemVM(raw) },
        openItems,
      });
    } catch (reason: unknown) {
      if (version === requestVersion.current) {
        setState({ status: "error", message: String(reason) });
      }
      throw reason;
    }
  }, [client, id]);

  useEffect(() => {
    void refresh(true).catch(() => undefined);
    return () => {
      requestVersion.current += 1;
    };
  }, [refresh]);

  if (state.status === "loading") return <DataStates loading />;
  if (state.status === "error") return <DataStates error={{ message: state.message }} />;
  if (state.current === undefined) return <InboxItemView items={[]} />;

  const { raw, vm } = state.current;
  const handleMutationSuccess = async () => {
    await refresh(false);
    await onInboxChanged?.();
  };
  return (
    <div className="flex flex-col gap-4">
      <InboxItemView items={[vm]} />
      {vm.kind === "approval" ? (
        <ApprovalActions vm={toApprovalItemVM(raw)} onSuccess={handleMutationSuccess} />
      ) : (
        <Respond key={vm.id} item={vm} openItems={state.openItems} onSuccess={handleMutationSuccess} />
      )}
    </div>
  );
}
